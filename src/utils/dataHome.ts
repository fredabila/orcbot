import os from 'os';
import path from 'path';

export function getOrcBotDataHome(): string {
    return path.resolve(process.env.ORCBOT_DATA_DIR || path.join(os.homedir(), '.orcbot'));
}

export function resolveDataHomePath(...segments: string[]): string {
    return path.join(getOrcBotDataHome(), ...segments);
}