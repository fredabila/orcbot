import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const originalText = readFileSync(packageJsonPath, 'utf8');
const pkg = JSON.parse(originalText);

const publishArgs = ['publish', '--access', 'public', ...process.argv.slice(2)];

try {
  pkg.name = 'orcbot';
  delete pkg.publishConfig;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  execFileSync('npm', publishArgs, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
} finally {
  writeFileSync(packageJsonPath, originalText, 'utf8');
}