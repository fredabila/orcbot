import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import { v4 as uuidv4 } from 'uuid';

/**
 * SaaS Provisioner - Automates the deployment of a new customer's bot instance.
 */
async function provision() {
    const args = process.argv.slice(2);
    const params = {
        customerName: getArg(args, '--customer'),
        blueprint: getArg(args, '--blueprint') || 'researcher',
        token: getArg(args, '--token'),
        userId: getArg(args, '--id'),
    };

    if (!params.customerName || !params.token || !params.userId) {
        console.error('Usage: npx ts-node saas/provision.ts --customer <Name> --token <BotToken> --id <UserId> [--blueprint researcher|architect|assistant]');
        process.exit(1);
    }

    const agentId = `saas_${params.customerName.toLowerCase().replace(/\s+/g, '_')}_${uuidv4().slice(0, 8)}`;
    const baseDir = path.join(os.homedir(), '.orcbot', 'orchestrator', 'instances', agentId);
    
    console.log(`
🚀 Provisioning SaaS Bot for ${params.customerName}...`);
    console.log(`📂 Creating isolated directory: ${baseDir}`);

    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }

    // 1. Load Blueprint
    const blueprintSource = path.join(process.cwd(), 'saas', 'blueprints', params.blueprint);
    if (!fs.existsSync(blueprintSource)) {
        console.error(`Error: Blueprint "${params.blueprint}" not found at ${blueprintSource}`);
        process.exit(1);
    }

    // 2. Copy Blueprint Files (IDENTITY.md)
    fs.copyFileSync(path.join(blueprintSource, 'IDENTITY.md'), path.join(baseDir, 'IDENTITY.md'));
    console.log(`📄 Loaded Identity: ${params.blueprint}`);

    // 3. Create Custom Config
    const config = {
        agentId: agentId,
        agentName: `${params.customerName}'s ${params.blueprint.charAt(0).toUpperCase() + params.blueprint.slice(1)}`,
        agentRole: params.blueprint,
        telegramToken: params.token,
        allowWorkerChannels: true,
        adminUsers: {
            telegram: [params.userId]
        },
        safeMode: params.blueprint === 'architect' ? false : true,
        sudoMode: params.blueprint === 'architect' ? true : false,
        modelName: 'gemini-2.0-flash', // Default to fast/cheap for SaaS
        systemPromptSuffix: `

CUSTOMER_CONTEXT: This bot is owned and managed by ${params.customerName}. Always prioritize their goals.`
    };

    fs.writeFileSync(path.join(baseDir, 'orcbot.config.yaml'), yaml.stringify(config));
    console.log(`⚙️  Configured: orcbot.config.yaml (Locked to User: ${params.userId})`);

    // 4. Update Orchestrator Registry (Optional but helpful for visibility)
    console.log(`
✅ SUCCESS: SaaS Bot "${agentId}" is ready!`);
    console.log(`
Next steps:`);
    console.log(`1. Run 'orcbot agent start ${agentId}' to activate.`);
    console.log(`2. The customer can now message their bot at @YourBotHandle.`);
}

function getArg(args: string[], key: string): string | null {
    const idx = args.indexOf(key);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

provision().catch(console.error);
