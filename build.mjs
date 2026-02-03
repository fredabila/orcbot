import * as esbuild from 'esbuild';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// Recursively find all .ts files in src/
function getEntryPoints(dir, files = []) {
    for (const file of readdirSync(dir)) {
        const path = join(dir, file);
        if (statSync(path).isDirectory()) {
            getEntryPoints(path, files);
        } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
            files.push(path);
        }
    }
    return files;
}

const entryPoints = getEntryPoints('src');

console.log(`Building ${entryPoints.length} files...`);
const start = Date.now();

await esbuild.build({
    entryPoints,
    outdir: 'dist',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: false,
    bundle: false,
    // Preserve directory structure
    outbase: 'src',
});

console.log(`✓ Build completed in ${Date.now() - start}ms`);
