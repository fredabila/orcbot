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

    public async pullModel(name: string): Promise<boolean> {
        logger.info(`OllamaHelper: Pulling model ${name}...`);
        try {
            const response = await fetch(`${this.apiUrl}/api/pull`, {
                method: 'POST',
                body: JSON.stringify({ name, stream: false })
            });
            return response.ok;
        } catch (e) {
            logger.error(`OllamaHelper: Failed to pull model ${name}: ${e}`);
            return false;
        }
    }
}
