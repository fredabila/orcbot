import { execSync, spawn } from 'child_process';
import { logger } from './logger';
import fs from 'fs';
import os from 'os';
import path from 'path';

export class OllamaHelper {
    private apiUrl: string;

    constructor(apiUrl: string = 'http://localhost:11434') {
        this.apiUrl = apiUrl;
    }

    public async isInstalled(): Promise<boolean> {
        try {
            if (process.platform === 'win32') {
                execSync('where ollama', { stdio: 'ignore' });
            } else {
                execSync('which ollama', { stdio: 'ignore' });
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    public async isRunning(): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiUrl}/api/tags`);
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    public startServer(): void {
        logger.info('OllamaHelper: Starting Ollama server...');
        const logPath = path.join(os.homedir(), '.orcbot', 'ollama.log');
        const out = fs.openSync(logPath, 'a');
        const err = fs.openSync(logPath, 'a');

        const child = spawn('ollama', ['serve'], {
            detached: true,
            stdio: ['ignore', out, err]
        });
        child.unref();
    }

    public async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.apiUrl}/api/tags`);
            if (!response.ok) return [];
            const data = await response.json() as any;
            return (data.models || []).map((m: any) => m.name);
        } catch (e) {
            return [];
        }
    }

    public async listRunningModels(): Promise<Array<{ name: string, size: number, digest: string }>> {
        try {
            const response = await fetch(`${this.apiUrl}/api/ps`);
            if (!response.ok) return [];
            const data = await response.json() as any;
            return (data.models || []).map((m: any) => ({
                name: m.name,
                size: m.size,
                digest: m.digest
            }));
        } catch (e) {
            return [];
        }
    }

    public async pullModel(name: string, onProgress?: (status: string, completed?: number, total?: number) => void): Promise<boolean> {
        logger.info(`OllamaHelper: Pulling model ${name}...`);
        try {
            const response = await fetch(`${this.apiUrl}/api/pull`, {
                method: 'POST',
                body: JSON.stringify({ name, stream: true })
            });

            if (!response.ok) return false;

            const reader = response.body?.getReader();
            if (!reader) {
                // Fallback for environments without streaming fetch body
                const data = await response.json() as any;
                return data.status === 'success';
            }

            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (onProgress && json.status) {
                            onProgress(json.status, json.completed, json.total);
                        }
                    } catch (e) {
                        // Ignore partial JSON
                    }
                }
            }
            return true;
        } catch (e) {
            logger.error(`OllamaHelper: Failed to pull model ${name}: ${e}`);
            return false;
        }
    }

    /**
     * Open the browser to the Ollama download page.
     */
    public openDownloadPage(): void {
        const url = 'https://ollama.com/download';
        try {
            if (process.platform === 'win32') {
                spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' }).unref();
            } else if (process.platform === 'darwin') {
                spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
            } else {
                spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
            }
        } catch (e) {
            logger.error(`OllamaHelper: Failed to open download page: ${e}`);
        }
    }
}
