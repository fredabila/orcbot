import os from 'os';
import process from 'process';

export interface EnvironmentInfo {
    platform: string;
    release: string;
    arch: string;
    cpuCount: number;
    cpuModel: string;
    totalMemoryGB: string;
    freeMemoryGB: string;
    nodeVersion: string;
    uptimeDays: string;
    loadAvg: number[];
    isDocker: boolean;
    shell: string;
}

export class Environment {
    public static getInfo(): EnvironmentInfo {
        const isWindows = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        const platformName = isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux';
        
        const cpus = os.cpus();
        const cpuCount = cpus.length;
        const cpuModel = cpuCount > 0 ? cpus[0].model : 'unknown';
        
        const totalMemoryGB = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1);
        const freeMemoryGB = (os.freemem() / (1024 * 1024 * 1024)).toFixed(1);
        
        const uptimeDays = (os.uptime() / 86400).toFixed(1);
        const loadAvg = os.loadavg();
        
        // Detect Docker
        const isDocker = Environment.detectDocker();
        
        let shell = isWindows ? 'PowerShell' : (process.env.SHELL || '/bin/sh');

        return {
            platform: platformName,
            release: os.release(),
            arch: os.arch(),
            cpuCount,
            cpuModel,
            totalMemoryGB,
            freeMemoryGB,
            nodeVersion: process.version,
            uptimeDays,
            loadAvg,
            isDocker,
            shell
        };
    }

    private static detectDocker(): boolean {
        try {
            // Check for .dockerenv file
            if (require('fs').existsSync('/.dockerenv')) {
                return true;
            }
            // Check /proc/self/cgroup for "docker"
            const cgroup = require('fs').readFileSync('/proc/self/cgroup', 'utf8');
            return cgroup.includes('docker');
        } catch {
            return false;
        }
    }

    public static getSystemPromptSnippet(): string {
        const info = Environment.getInfo();
        const isWindows = info.platform === 'Windows';
        
        // Resolve orcbot data home for agent awareness
        const orcbotDataHome = process.env.ORCBOT_DATA_DIR || require('path').join(require('os').homedir(), '.orcbot');

        let prompt = `SYSTEM ENVIRONMENT:
- Platform: ${info.platform} (${info.release}, ${info.arch})
- CPU: ${info.cpuCount}x ${info.cpuModel}
- RAM: ${info.totalMemoryGB}GB total (${info.freeMemoryGB}GB free)
- Load Average: ${info.loadAvg.map(l => l.toFixed(2)).join(', ')} (1m, 5m, 15m)
- Node.js: ${info.nodeVersion}
- System Uptime: ${info.uptimeDays} days
- Docker: ${info.isDocker ? 'Yes' : 'No'}
- Default Shell: ${info.shell}
- OrcBot Data Home: ${orcbotDataHome}

WORKFLOW OPTIMIZATION:
- If RAM is low (< 1GB free), favor streaming or chunked operations for large files.
- If CPU load is high (> 2.0), prioritize essential tasks and avoid heavy parallelization.
- **Internal Storage**: Use 'OrcBot Data Home' for your internal scratchpad, generated scripts, and persistent plugin data.
- **Working Files**: When creating temporary scripts (e.g. for Python/Node), prefer subdirectories within 'OrcBot Data Home'.
- Use your environment knowledge to inform the user if a requested task is likely to fail due to resource constraints.
- You are encouraged to "complain" (provide feedback in reasoning) if the environment is severely constrained for the task at hand.

`;

        if (isWindows) {
            prompt += `
- CRITICAL (Windows): All run_command calls execute in PowerShell, NOT cmd.exe.
  - Use PowerShell cmdlets (Get-ChildItem, Get-Command, Test-Path, etc.)
  - Use Start-MpScan for Windows Defender scans
  - Use Get-Process, Stop-Process, Get-Service, Start-Service
  - Use Invoke-WebRequest (NOT curl on older systems)
  - Path format: C:\\path\\to\\file or C:/path/to/file
  - Command chaining: Use semicolons (;)`;
        } else {
            prompt += `
- Shell style: Bash/Zsh
- Path format: /path/to/file
- Standard Unix commands available (ls, cat, mkdir, echo, etc.)
- Command chaining: Use && or ;`;
        }

        return prompt;
    }
}
