import path from 'path';

export interface BrowserScratchpadTarget {
    scriptsDir: string;
    scriptPath: string;
    isNamedScript: boolean;
}

export function resolveBrowserScratchpadTarget(dataHome: string, filename?: string): BrowserScratchpadTarget {
    const scriptsDir = path.join(dataHome, 'browser-scripts');

    if (!filename) {
        return {
            scriptsDir,
            scriptPath: path.join(dataHome, 'browser-scratchpad.js'),
            isNamedScript: false
        };
    }

    const safeFilename = path.basename(String(filename).trim());
    if (!safeFilename || !safeFilename.endsWith('.js')) {
        throw new Error('Filename must end with .js');
    }

    return {
        scriptsDir,
        scriptPath: path.join(scriptsDir, safeFilename),
        isNamedScript: true
    };
}