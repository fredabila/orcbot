import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

export class SQLiteAdapter {
    private db: Database.Database;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.initialize();
    }

    private initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        type TEXT,
        content TEXT,
        metadata TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
        logger.info('SQLite database initialized');
    }

    public save(id: string, type: string, content: string, metadata: any) {
        const stmt = this.db.prepare(
            'INSERT OR REPLACE INTO memory (id, type, content, metadata) VALUES (?, ?, ?, ?)'
        );
        stmt.run(id, type, content, JSON.stringify(metadata));
    }

    public get(id: string) {
        const stmt = this.db.prepare('SELECT * FROM memory WHERE id = ?');
        const row = stmt.get(id) as any;
        if (row && row.metadata) {
            row.metadata = JSON.parse(row.metadata);
        }
        return row;
    }

    public queryByType(type: string) {
        const stmt = this.db.prepare('SELECT * FROM memory WHERE type = ? ORDER BY timestamp DESC');
        return stmt.all(type).map((row: any) => {
            if (row.metadata) {
                row.metadata = JSON.parse(row.metadata);
            }
            return row;
        });
    }
}
