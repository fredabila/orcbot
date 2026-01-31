import fs from 'fs';
import { logger } from '../utils/logger';

export class JSONAdapter {
    private filePath: string;
    private cache: any = null;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.initialize();
    }

    private initialize() {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2));
            logger.info(`JSON fallback storage created at ${this.filePath}`);
            this.cache = {};
        } else {
            this.read(); // Load into cache
        }
    }

    public save(key: string, value: any) {
        if (!this.cache) this.read();
        this.cache[key] = value;
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
        } catch (error) {
            logger.error(`Error writing JSON storage to ${this.filePath}: ${error}`);
        }
    }

    public get(key: string) {
        if (!this.cache) this.read();
        return this.cache[key];
    }

    private read() {
        try {
            const content = fs.readFileSync(this.filePath, 'utf-8');
            this.cache = JSON.parse(content);
            return this.cache;
        } catch (error) {
            logger.error(`Error reading JSON storage from ${this.filePath}: ${error}`);
            this.cache = this.cache || {};
            return this.cache;
        }
    }
}
