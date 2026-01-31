import fs from 'fs';
import { logger } from '../utils/logger';

export class JSONAdapter {
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.initialize();
    }

    private initialize() {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2));
            logger.info(`JSON fallback storage created at ${this.filePath}`);
        }
    }

    public save(key: string, value: any) {
        const data = this.read();
        data[key] = value;
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    }

    public get(key: string) {
        const data = this.read();
        return data[key];
    }

    private read() {
        try {
            const content = fs.readFileSync(this.filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            logger.error(`Error reading JSON storage: ${error}`);
            return {};
        }
    }
}
