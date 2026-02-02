import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface WorkerProfileData {
    handle: string;
    displayName: string;
    email?: string;
    password?: string; // Encrypted
    bio?: string;
    avatarUrl?: string;
    websites: { name: string; url: string; username?: string }[];
    createdAt: string;
    updatedAt: string;
}

const ENCRYPTION_KEY_LENGTH = 32;
const IV_LENGTH = 16;

export class WorkerProfileManager {
    private profilePath: string;
    private profile: WorkerProfileData | null = null;
    private encryptionKey: Buffer;

    constructor(dataDir?: string) {
        const baseDir = dataDir || path.join(os.homedir(), '.orcbot');
        this.profilePath = path.join(baseDir, 'worker-profile.json');

        // Derive a machine-specific encryption key
        const keySource = `orcbot-worker-${os.hostname()}-${os.userInfo().username}`;
        this.encryptionKey = crypto.createHash('sha256').update(keySource).digest();

        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.profilePath)) {
                const raw = fs.readFileSync(this.profilePath, 'utf-8');
                this.profile = JSON.parse(raw);
                logger.info('WorkerProfile: Loaded existing profile');
            }
        } catch (e) {
            logger.warn(`WorkerProfile: Failed to load profile: ${e}`);
            this.profile = null;
        }
    }

    private save(): void {
        try {
            const dir = path.dirname(this.profilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2));
            logger.info('WorkerProfile: Saved profile');
        } catch (e) {
            logger.error(`WorkerProfile: Failed to save: ${e}`);
        }
    }

    private encrypt(text: string): string {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    private decrypt(encrypted: string): string {
        try {
            const [ivHex, encryptedText] = encrypted.split(':');
            if (!ivHex || !encryptedText) return '';
            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch {
            return '';
        }
    }

    public exists(): boolean {
        return this.profile !== null;
    }

    public get(): WorkerProfileData | null {
        return this.profile;
    }

    public getDecryptedPassword(): string {
        if (!this.profile?.password) return '';
        return this.decrypt(this.profile.password);
    }

    public create(handle: string, displayName: string): WorkerProfileData {
        this.profile = {
            handle,
            displayName,
            websites: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.save();
        return this.profile;
    }

    public update(updates: Partial<Omit<WorkerProfileData, 'createdAt' | 'updatedAt' | 'password'>>): WorkerProfileData | null {
        if (!this.profile) return null;
        Object.assign(this.profile, updates, { updatedAt: new Date().toISOString() });
        this.save();
        return this.profile;
    }

    public setEmail(email: string): void {
        if (!this.profile) return;
        this.profile.email = email;
        this.profile.updatedAt = new Date().toISOString();
        this.save();
    }

    public setPassword(plainPassword: string): void {
        if (!this.profile) return;
        this.profile.password = this.encrypt(plainPassword);
        this.profile.updatedAt = new Date().toISOString();
        this.save();
    }

    public addWebsite(name: string, url: string, username?: string): void {
        if (!this.profile) return;
        this.profile.websites.push({ name, url, username });
        this.profile.updatedAt = new Date().toISOString();
        this.save();
    }

    public removeWebsite(name: string): boolean {
        if (!this.profile) return false;
        const idx = this.profile.websites.findIndex(w => w.name.toLowerCase() === name.toLowerCase());
        if (idx === -1) return false;
        this.profile.websites.splice(idx, 1);
        this.profile.updatedAt = new Date().toISOString();
        this.save();
        return true;
    }

    public delete(): void {
        this.profile = null;
        if (fs.existsSync(this.profilePath)) {
            fs.unlinkSync(this.profilePath);
            logger.info('WorkerProfile: Deleted profile');
        }
    }

    public getSummary(): string {
        if (!this.profile) return 'No worker profile configured.';
        const lines = [
            `Handle: ${this.profile.handle}`,
            `Display Name: ${this.profile.displayName}`,
            `Email: ${this.profile.email || '(not set)'}`,
            `Password: ${this.profile.password ? '(set)' : '(not set)'}`,
            `Bio: ${this.profile.bio || '(not set)'}`,
            `Websites: ${this.profile.websites.length > 0 ? this.profile.websites.map(w => w.name).join(', ') : '(none)'}`,
            `Created: ${this.profile.createdAt}`,
        ];
        return lines.join('\n');
    }
}
