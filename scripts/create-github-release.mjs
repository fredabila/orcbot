import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = String(packageJson.version || '').trim();

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: npm run release:github [-- --tag=v1.2.3] [--title="v1.2.3"] [--notes="Release notes"]');
    console.log('Creates the git tag from the current package version if needed, pushes it, and publishes a GitHub Release.');
    process.exit(0);
}

if (!version) {
    console.error('package.json is missing a version.');
    process.exit(1);
}

const tagName = process.argv.find(arg => arg.startsWith('--tag='))?.slice('--tag='.length) || `v${version}`;
const title = process.argv.find(arg => arg.startsWith('--title='))?.slice('--title='.length) || tagName;
const notes = process.argv.find(arg => arg.startsWith('--notes='))?.slice('--notes='.length);

function run(command, args, options = {}) {
    return execFileSync(command, args, {
        cwd: repoRoot,
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        encoding: 'utf8'
    });
}

function commandExists(command) {
    try {
        run(command, ['--version'], { capture: true });
        return true;
    } catch {
        return false;
    }
}

if (!commandExists('git')) {
    console.error('git is required to create a release.');
    process.exit(1);
}

if (!commandExists('gh')) {
    console.error('GitHub CLI (gh) is required to create and publish the GitHub Release.');
    console.error('Install gh and authenticate with `gh auth login`, then rerun this command.');
    process.exit(1);
}

try {
    const status = run('git', ['status', '--porcelain'], { capture: true }).trim();
    if (status) {
        console.error('Refusing to create a release from a dirty working tree. Commit or stash changes first.');
        process.exit(1);
    }

    const existingTag = run('git', ['tag', '--list', tagName], { capture: true }).trim();
    if (!existingTag) {
        run('git', ['tag', tagName]);
        console.log(`Created git tag ${tagName}`);
    } else {
        console.log(`Git tag ${tagName} already exists locally`);
    }

    run('git', ['push', 'origin', 'HEAD']);
    run('git', ['push', 'origin', tagName]);

    const releaseViewArgs = ['release', 'view', tagName];
    const releaseExists = (() => {
        try {
            run('gh', releaseViewArgs, { capture: true });
            return true;
        } catch {
            return false;
        }
    })();

    if (releaseExists) {
        console.log(`GitHub release ${tagName} already exists. The publish workflow should already be attached to it.`);
        process.exit(0);
    }

    const releaseArgs = ['release', 'create', tagName, '--title', title, '--verify-tag'];
    if (notes) {
        releaseArgs.push('--notes', notes);
    } else {
        releaseArgs.push('--generate-notes');
    }

    run('gh', releaseArgs);
    console.log(`Published GitHub release ${tagName}. The package publish workflow should start automatically.`);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create GitHub release: ${message}`);
    process.exit(1);
}