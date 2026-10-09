import path from 'path';
import inquirer from 'inquirer';
import { OllamaHelper } from '../../utils/OllamaHelper';
import { isPiTuiAvailable } from '../../core/PiTuiRenderer';
import { DEFAULT_MODEL_IDS } from '../../config/modelDefaults';
import { renderScreenHeader } from '../ui/Header';
import {
    box,
    statusDot,
    dim,
    bold,
    cyan,
    green,
    yellow,
    red,
    gray,
    c,
    waitKeyPress,
    brightCyan,
    brightGreen,
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';

/**
 * Root AI Models & Providers screen controller.
 */
export async function showModelsMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('AI Models & Providers');

    const currentProvider = agent.config.get('llmProvider') || 'auto';
    const currentModel = agent.config.get('modelName') || '(default)';
    const hasOpenAI = !!agent.config.get('openaiApiKey');
    const hasGoogle = !!agent.config.get('googleApiKey');
    const hasOpenRouter = !!agent.config.get('openrouterApiKey');
    const hasNvidia = !!agent.config.get('nvidiaApiKey');
    const hasAnthropic = !!agent.config.get('anthropicApiKey');
    const hasBedrock = !!agent.config.get('bedrockAccessKeyId');
    const ollamaUrl = agent.config.get('ollamaApiUrl') || 'http://localhost:11434';
    const ollamaHelper = new OllamaHelper(ollamaUrl);
    const hasOllama = await ollamaHelper.isRunning();
    const piAiEnabled = agent.config.get('usePiAI') !== false; // true by default

    console.log('');
    const piTuiStatus = isPiTuiAvailable() ? green('installed') : gray('not installed');
    const modelLines = [
        `${dim('Provider')}  ${brightCyan(bold(currentProvider.toUpperCase()))}`,
        `${dim('Model')}     ${bold(currentModel)}`,
        `${dim('pi-ai')}     ${piAiEnabled ? green('enabled (primary)') : gray('disabled (legacy mode)')}`,
        `${dim('pi-tui')}    ${piTuiStatus}`,
    ];
    box(modelLines, { title: 'ACTIVE MODEL', width: 52 });

    console.log('');
    const providerLines = [
        `${statusDot(hasOpenAI, '')}  ${bold('OpenAI')}       ${hasOpenAI ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasOpenRouter, '')}  ${bold('OpenRouter')}   ${hasOpenRouter ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasOllama, '')}  ${bold('Ollama')}       ${hasOllama ? green('Online') : gray('Offline')}`,
        `${statusDot(hasGoogle, '')}  ${bold('Google')}       ${hasGoogle ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasNvidia, '')}  ${bold('NVIDIA')}       ${hasNvidia ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasAnthropic, '')}  ${bold('Anthropic')}    ${hasAnthropic ? green('Key set') : gray('Not configured')}`,
        `${statusDot(hasBedrock, '')}  ${bold('AWS Bedrock')}  ${hasBedrock ? green('Keys set') : gray('Not configured')}`,
    ];
    box(providerLines, { title: 'PROVIDERS', width: 52 });
    console.log('');

    const { provider } = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: cyan('Select provider to configure:'),
            choices: [
                { name: `   ${bold('Model & Provider Setup')} ${dim(`(current: ${currentProvider} · 15+ providers)`)}`, value: 'pi_ai' },
                new inquirer.Separator(dim('  ─── Per-Provider Config ──────────')),
                { name: `  ${statusDot(hasOpenAI, '')} OpenAI ${dim('(GPT-4, etc.)')}`, value: 'openai' },
                { name: `  ${statusDot(hasOpenRouter, '')} OpenRouter ${dim('(multi-model gateway)')}`, value: 'openrouter' },
                { name: `  ${statusDot(hasOllama, '')} Ollama ${dim('(local models)')}`, value: 'ollama' },
                { name: `  ${statusDot(hasGoogle, '')} Google ${dim('(Gemini Pro/Flash)')}`, value: 'google' },
                { name: `  ${statusDot(hasNvidia, '')} NVIDIA ${dim('(AI models)')}`, value: 'nvidia' },
                { name: `  ${statusDot(hasAnthropic, '')} Anthropic ${dim('(Claude)')}`, value: 'anthropic' },
                { name: `  ${statusDot(hasBedrock, '')} AWS Bedrock ${dim('(foundation models)')}`, value: 'bedrock' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (provider === 'back') return showMainMenu();

    if (provider === 'pi_ai') {
        await showPiAIConfig(ctx);
    } else if (provider === 'openai') {
        await showOpenAIConfig(ctx);
    } else if (provider === 'openrouter') {
        await showOpenRouterConfig(ctx);
    } else if (provider === 'ollama') {
        await showOllamaMenu(ctx);
    } else if (provider === 'google') {
        await showGeminiConfig(ctx);
    } else if (provider === 'nvidia') {
        await showNvidiaConfig(ctx);
    } else if (provider === 'anthropic') {
        await showAnthropicConfig(ctx);
    } else if (provider === 'bedrock') {
        await showBedrockConfig(ctx);
    }
}

export async function showOllamaMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    renderScreenHeader('Ollama / Local Models');

    const ollamaUrl = agent.config.get('ollamaApiUrl') || 'http://localhost:11434';
    const helper = new OllamaHelper(ollamaUrl);

    const isInstalled = await helper.isInstalled();
    const isRunning = await helper.isRunning();
    const localModels = isRunning ? await helper.listModels() : [];
    const runningModels = isRunning ? await helper.listRunningModels() : [];
    const currentModel = agent.config.get('modelName');
    const currentProvider = agent.config.get('llmProvider');

    console.log('');
    const statusLines = [
        `${dim('Status')}     ${isRunning ? green('● ONLINE') : red('○ OFFLINE')}`,
        `${dim('Installed')}  ${isInstalled ? green('Yes') : yellow('No (Download below)')}`,
        `${dim('URL')}        ${ollamaUrl}`,
    ];
    if (isRunning && runningModels.length > 0) {
        statusLines.push(`${dim('Active')}     ${green(runningModels.map(m => m.name.split(':')[0]).join(', '))}`);
    }
    box(statusLines, { title: 'OLLAMA STATUS', width: 52, color: isRunning ? c.brightGreen : c.brightRed });

    if (!isRunning && !isInstalled) {
        console.log(yellow('\n   Ollama is not detected on your system.'));
        console.log(dim('  To use local models, please download Ollama and install it first.'));
    } else if (!isRunning) {
        console.log(yellow('\n   Ollama is installed but the server is not running.'));
        console.log(dim('  Select "Start Ollama Server" below to launch it.'));
    }

    if (isRunning && localModels.length > 0) {
        console.log('');
        const modelLines = localModels.map(m =>
            `${m === currentModel && currentProvider === 'ollama' ? brightGreen('●') : gray('○')} ${m}`
        );
        box(modelLines, { title: 'LOCAL MODELS', width: 52 });
    }

    console.log('');
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Ollama Management:'),
            choices: [
                { name: `   ${bold('Set as Primary Provider')}`, value: 'set_primary', disabled: !isRunning },
                { name: `   ${bold('Select Local Model')}`, value: 'select_model', disabled: !isRunning || localModels.length === 0 },
                { name: `    ${bold('Pull New Model')}`, value: 'pull_model', disabled: !isRunning },
                { name: `   ${bold('Start Ollama Server')}`, value: 'start_server', disabled: isRunning },
                { name: `   ${bold('Download Ollama')} ${dim('(ollama.com)')}`, value: 'download' },
                { name: `   ${bold('Refresh Status')}`, value: 'refresh' },
                new inquirer.Separator(dim('  ─── Configuration ────────────────')),
                { name: `    Set API URL ${dim(`(${ollamaUrl})`)}`, value: 'set_url' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu(ctx);
    if (action === 'refresh') return showOllamaMenu(ctx);

    if (action === 'download') {
        if (process.platform === 'linux' || process.platform === 'darwin') {
            console.log(yellow('\n  Running Ollama installation script (requires sudo)...'));
            const success = await helper.installOllama((output) => {
                process.stdout.write(dim(output));
            });
            if (success) {
                console.log(green('\n  ✓ Ollama installed successfully.'));
            } else {
                console.log(red('\n  ✗ Installation failed. You may need to run the command manually:'));
                console.log(cyan('  curl -fsSL https://ollama.com/install.sh | sh'));
            }
        } else {
            console.log(yellow('\n  Opening Ollama download page in your browser...'));
            helper.openDownloadPage();
            console.log(dim('  Once installed, restart OrcBot.'));
        }
        await waitKeyPress();
        return showOllamaMenu(ctx);
    }

    if (action === 'set_primary') {
        agent.config.set('llmProvider', 'ollama');
        console.log(green('\n  ✓ Ollama set as primary provider.'));
        await waitKeyPress();
        return showOllamaMenu(ctx);
    }

    if (action === 'select_model') {
        const { model } = await inquirer.prompt([
            {
                type: 'list',
                name: 'model',
                message: 'Select model to use:',
                choices: localModels.map(m => ({ name: m, value: m }))
            }
        ]);
        agent.config.set('modelName', model);
        agent.config.set('llmProvider', 'ollama');
        console.log(green(`\n  ✓ Active model set to ${model} via Ollama.`));
        await waitKeyPress();
        return showOllamaMenu(ctx);
    }

    if (action === 'pull_model') {
        const { modelName } = await inquirer.prompt([
            {
                type: 'input',
                name: 'modelName',
                message: 'Enter model name to pull (e.g. llama3, mistral):',
                validate: (input: string) => input.length > 0 || 'Please enter a model name.'
            }
        ]);
        console.log(yellow(`\n  Pulling ${modelName}...`));

        const success = await helper.pullModel(modelName, (status, completed, total) => {
            if (completed !== undefined && total !== undefined) {
                const percent = Math.round((completed / total) * 100);
                process.stdout.write(`\r  ${cyan('●')} ${status}: ${percent}% (${Math.round(completed/1024/1024)}MB / ${Math.round(total/1024/1024)}MB)      `);
            } else {
                process.stdout.write(`\r  ${cyan('●')} ${status}...                              `);
            }
        });

        if (success) {
            console.log(green(`\n\n  ✓ Model ${modelName} pulled successfully.`));
        } else {
            console.log(red(`\n\n  ✗ Failed to pull model ${modelName}. Check logs for details.`));
        }
        await waitKeyPress();
        return showOllamaMenu(ctx);
    }

    if (action === 'start_server') {
        helper.startServer();
        console.log(yellow('\n  Starting Ollama server in background...'));
        console.log(dim('  Checking status...'));
        for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 2000));
            if (await helper.isRunning()) {
                console.log(green('  ✓ Ollama is now online!'));
                break;
            }
        }
        await waitKeyPress();
        return showOllamaMenu(ctx);
    }

    if (action === 'set_url') {
        const { url } = await inquirer.prompt([
            {
                type: 'input',
                name: 'url',
                message: 'Enter Ollama API URL:',
                default: ollamaUrl
            }
        ]);
        agent.config.set('ollamaApiUrl', url);
        console.log(green(`\n  ✓ Ollama API URL set to ${url}`));
        await waitKeyPress();
        return showOllamaMenu(ctx);
    }
}

export async function showSelfTrainingMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Self-Training Sidecar');

    const status = agent.getSelfTrainingStatus();
    const lastEval = status.lastEvaluationReport;
    const lastJob = status.lastPreparedJob;
    const lastPromotion = status.lastPromotionRecord;

    console.log('');
    box([
        `${c.white}Enabled${c.reset}      ${status.enabled ? green('Yes') : red('No')}`,
        `${c.white}Train on Idle${c.reset} ${status.trainOnIdle ? green('Yes') : gray('No')}`,
        `${c.white}Accepted${c.reset}     ${brightCyan(String(status.stats.accepted))} ${dim('/ ' + status.stats.total + ' captured')}`,
        `${c.white}Candidates${c.reset}   ${brightCyan(String(status.candidates.length))}`,
        `${c.white}Min Quality${c.reset}  ${bold(String(status.minQualityScore))}`,
        `${c.white}Promote Gate${c.reset} ${bold(String(status.promotionMinAverageScore))} ${status.requireEvalForPromotion ? dim('(eval required)') : dim('(manual)')}`,
        `${c.gray}${'─'.repeat(52)}${c.reset}`,
        `${c.white}Last Job${c.reset}     ${lastJob ? green(lastJob.id) : gray('none')}`,
        `${c.white}Last Eval${c.reset}    ${lastEval ? green(`${lastEval.averageScore} avg / ${lastEval.passRate} pass`) : gray('none')}`,
        `${c.white}Last Promote${c.reset} ${lastPromotion ? green(lastPromotion.modelName) : gray('none')}`,
    ], { title: 'SELF-TRAINING STATUS', width: 58 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Self-Training options:'),
            choices: [
                { name: `   ${bold('View Detailed Status')}`, value: 'status' },
                { name: `   ${bold('Prepare Training Job')}`, value: 'prepare' },
                { name: `   ${bold('Run Evaluation')}`, value: 'eval' },
                { name: `   ${bold('Build Launch Plan')}`, value: 'plan' },
                { name: `   ${bold('Launch Training Job')}`, value: 'launch', disabled: !status.lastPreparedJob },
                new inquirer.Separator(dim('  ─── Candidate Lifecycle ───────────')),
                { name: `    ${bold('Register Candidate Model')}`, value: 'register' },
                { name: `   ${bold('Promote Candidate Model')}`, value: 'promote', disabled: status.candidates.length === 0 },
                new inquirer.Separator(dim('  ─── Settings ─────────────────────')),
                { name: `    ${bold('Configure Self-Training')}`, value: 'config' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    if (action === 'status') {
        console.log('');
        console.log(JSON.stringify(status, null, 2));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    if (action === 'prepare') {
        console.log('');
        console.log(JSON.stringify(agent.prepareSelfTrainingJob(), null, 2));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    if (action === 'eval') {
        const { limit, provider, modelName } = await inquirer.prompt([
            { type: 'input', name: 'limit', message: 'Sample size (leave blank for configured default):', default: '' },
            { type: 'input', name: 'provider', message: 'Provider override (leave blank for default):', default: '' },
            { type: 'input', name: 'modelName', message: 'Model override (leave blank for active model):', default: '' },
        ]);
        const report = await agent.runSelfTrainingEvaluation({
            limit: limit ? Number(limit) : undefined,
            provider: provider || undefined,
            modelName: modelName || undefined,
        } as any);
        console.log('');
        console.log(JSON.stringify(report, null, 2));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    if (action === 'plan') {
        const defaults = agent.getSelfTrainingStatus();
        const { commandTemplate, cwd, sessionId } = await inquirer.prompt([
            { type: 'input', name: 'commandTemplate', message: 'Command template override (blank = configured default):', default: '' },
            { type: 'input', name: 'cwd', message: 'Working directory override (blank = default):', default: '' },
            { type: 'input', name: 'sessionId', message: 'Session ID override (blank = auto):', default: '' },
        ]);
        const plan = agent.buildSelfTrainingLaunchPlan({
            commandTemplate: commandTemplate || undefined,
            cwd: cwd || undefined,
            sessionId: sessionId || undefined,
        });
        console.log('');
        console.log(JSON.stringify({ ...plan, paths: defaults.paths }, null, 2));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    if (action === 'launch') {
        const { commandTemplate, cwd, sessionId, dryRun } = await inquirer.prompt([
            { type: 'input', name: 'commandTemplate', message: 'Command template override (blank = configured default):', default: '' },
            { type: 'input', name: 'cwd', message: 'Working directory override (blank = default):', default: '' },
            { type: 'input', name: 'sessionId', message: 'Session ID override (blank = auto):', default: '' },
            { type: 'confirm', name: 'dryRun', message: 'Dry run only?', default: true },
        ]);
        const result = await agent.launchSelfTrainingJob({
            commandTemplate: commandTemplate || undefined,
            cwd: cwd || undefined,
            sessionId: sessionId || undefined,
            dryRun,
        });
        console.log('');
        console.log(JSON.stringify(result, null, 2));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    if (action === 'register') {
        const { modelName, provider, candidateId, jobId, notes } = await inquirer.prompt([
            { type: 'input', name: 'modelName', message: 'Candidate model name:', validate: (value: string) => value.trim().length > 0 || 'Model name is required.' },
            { type: 'input', name: 'provider', message: 'Provider (blank = auto/none):', default: '' },
            { type: 'input', name: 'candidateId', message: 'Candidate ID override (blank = auto):', default: '' },
            { type: 'input', name: 'jobId', message: 'Source job ID (blank = latest prepared job):', default: '' },
            { type: 'input', name: 'notes', message: 'Notes (semicolon-separated):', default: '' },
        ]);
        const result = agent.registerSelfTrainingCandidate({
            modelName: modelName.trim(),
            provider: provider || undefined,
            candidateId: candidateId || undefined,
            jobId: jobId || undefined,
            notes: notes ? String(notes).split(';').map((part: string) => part.trim()).filter(Boolean) : [],
        });
        console.log('');
        console.log(JSON.stringify(result, null, 2));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    if (action === 'promote') {
        const refreshed = agent.getSelfTrainingStatus();
        const { candidateId, dryRun } = await inquirer.prompt([
            {
                type: 'list',
                name: 'candidateId',
                message: 'Select candidate to promote:',
                choices: refreshed.candidates.map((candidate: any) => ({
                    name: `${candidate.modelName} ${dim(`(${candidate.provider || 'auto'})`)} ${candidate.evaluationAverageScore !== undefined ? green(`score ${candidate.evaluationAverageScore}`) : yellow('no eval')}`,
                    value: candidate.id,
                }))
            },
            { type: 'confirm', name: 'dryRun', message: 'Dry run first?', default: true },
        ]);
        const result = agent.promoteSelfTrainingCandidate({ candidateId, dryRun });
        console.log('');
        console.log(JSON.stringify(result, null, 2));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    if (action === 'config') {
        const cfg = agent.getSelfTrainingStatus();
        const { setting } = await inquirer.prompt([
            {
                type: 'list',
                name: 'setting',
                message: 'Select self-training setting:',
                choices: [
                    { name: `Enabled (${String(cfg.enabled)})`, value: 'selfTrainingEnabled' },
                    { name: `Train on Idle (${String(cfg.trainOnIdle)})`, value: 'selfTrainingTrainOnIdle' },
                    { name: `Min Quality Score (${cfg.minQualityScore})`, value: 'selfTrainingMinQualityScore' },
                    { name: `Min Accepted Examples (${cfg.minAcceptedExamples})`, value: 'selfTrainingMinAcceptedExamples' },
                    { name: `Eval Pass Threshold (${cfg.lastEvaluationReport?.passThreshold ?? agent.config.get('selfTrainingEvalPassThreshold')})`, value: 'selfTrainingEvalPassThreshold' },
                    { name: `Promotion Min Average Score (${cfg.promotionMinAverageScore})`, value: 'selfTrainingPromotionMinAverageScore' },
                    { name: `Require Eval For Promotion (${String(cfg.requireEvalForPromotion)})`, value: 'selfTrainingRequireEvalForPromotion' },
                    { name: `Launch Command (${agent.config.get('selfTrainingLaunchCommand') || 'not set'})`, value: 'selfTrainingLaunchCommand' },
                    { name: `Launch Cwd (${agent.config.get('selfTrainingLaunchCwd') || 'not set'})`, value: 'selfTrainingLaunchCwd' },
                    { name: 'Back', value: 'back' },
                ]
            }
        ]);

        if (setting === 'back') {
            return showSelfTrainingMenu(ctx);
        }

        const currentValue = agent.config.get(setting);
        if (typeof currentValue === 'boolean') {
            const { value } = await inquirer.prompt([{ type: 'confirm', name: 'value', message: `Set ${setting}:`, default: currentValue }]);
            agent.config.set(setting, value);
        } else {
            const { value } = await inquirer.prompt([{ type: 'input', name: 'value', message: `Set ${setting}:`, default: currentValue ?? '' }]);
            if (setting === 'selfTrainingLaunchCommand' || setting === 'selfTrainingLaunchCwd') {
                agent.config.set(setting, value || undefined);
            } else {
                agent.config.set(setting, value === '' ? undefined : Number.isFinite(Number(value)) && value.trim() !== '' ? Number(value) : value);
            }
        }

        console.log(green('\nSelf-training setting updated.'));
        await waitKeyPress();
        return showSelfTrainingMenu(ctx);
    }

    return showSelfTrainingMenu(ctx);
}

export async function performPiAIUpdate(): Promise<void> {
    const { execSync } = require('child_process');
    const orcbotDir = path.resolve(__dirname, '..', '..', '..');

    console.log('\nChecking for PI AI Catalog updates...');
    console.log(dim('   This will update the @mariozechner/pi-ai library to get the newest models.\n'));

    try {
        console.log('Fetching latest catalog metadata via bun...');
        execSync('bun update @mariozechner/pi-ai', { cwd: orcbotDir, stdio: 'inherit' });
        console.log(green('\nCatalog update complete!'));
        console.log(dim('   The model list will be refreshed the next time you open the browser.'));
    } catch {
        try {
            execSync('npm update @mariozechner/pi-ai', { cwd: orcbotDir, stdio: 'inherit' });
            console.log(green('\nCatalog update complete!'));
        } catch (e: any) {
            console.log(red(`\nFailed to update catalog: ${e.message}`));
        }
    }

    await waitKeyPress();
}

export async function showPiAIConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    renderScreenHeader('Model & Provider Setup');

    const catalogue = await agent.llm.getPiAICatalogue();

    const piAiEnabled = agent.config.get('usePiAI') !== false;
    const currentModel = agent.config.get('modelName') || DEFAULT_MODEL_IDS.openaiMain;

    // Key lookup per catalogue provider
    const piKeyMap: Record<string, () => string | undefined> = {
        openai: () => agent.config.get('openaiApiKey'),
        google: () => agent.config.get('googleApiKey'),
        openrouter: () => agent.config.get('openrouterApiKey'),
        'amazon-bedrock': () => agent.config.get('bedrockAccessKeyId'),
        groq: () => agent.config.get('groqApiKey'),
        mistral: () => agent.config.get('mistralApiKey'),
        cerebras: () => agent.config.get('cerebrasApiKey'),
        xai: () => agent.config.get('xaiApiKey'),
        huggingface: () => agent.config.get('huggingfaceApiKey'),
        'kimi-coding': () => agent.config.get('kimiApiKey'),
        minimax: () => agent.config.get('minimaxApiKey'),
        'minimax-cn': () => agent.config.get('minimaxApiKey'),
        zai: () => agent.config.get('zaiApiKey'),
        perplexity: () => agent.config.get('perplexityApiKey'),
        deepseek: () => agent.config.get('deepseekApiKey'),
        opencode: () => agent.config.get('opencodeApiKey'),
        anthropic: () => agent.config.get('anthropicApiKey') || (agent.llm.isPiAiLinked('anthropic') ? 'oauth' : undefined),
        'github-copilot': () => agent.llm.isPiAiLinked('github-copilot') ? 'oauth' : undefined,
        'google-antigravity': () => agent.llm.isPiAiLinked('google-antigravity') ? 'oauth' : undefined,
        'google-gemini-cli': () => agent.llm.isPiAiLinked('google-gemini-cli') ? 'oauth' : undefined,
        'openai-codex': () => agent.llm.isPiAiLinked('openai-codex') ? 'oauth' : undefined,
        'azure-openai-responses': () => agent.config.get('openaiApiKey') && agent.config.get('azureEndpoint'),
        'google-vertex': () => agent.config.get('googleProjectId') && agent.config.get('googleLocation'),
    };
    // Config key to store when the user enters a key for a pi-ai provider
    const piConfigKey: Record<string, string> = {
        openai: 'openaiApiKey', google: 'googleApiKey', anthropic: 'anthropicApiKey',
        openrouter: 'openrouterApiKey', 'amazon-bedrock': 'bedrockAccessKeyId',
        groq: 'groqApiKey', mistral: 'mistralApiKey', cerebras: 'cerebrasApiKey', xai: 'xaiApiKey',
        huggingface: 'huggingfaceApiKey', 'kimi-coding': 'kimiApiKey', minimax: 'minimaxApiKey',
        'minimax-cn': 'minimaxApiKey', zai: 'zaiApiKey', perplexity: 'perplexityApiKey',
        deepseek: 'deepseekApiKey', opencode: 'opencodeApiKey',
        'azure-openai-responses': 'openaiApiKey',
        'google-vertex': 'googleProjectId',
    };

    console.log('');
    box([
        `${dim('Status')}   ${piAiEnabled ? green('Enabled (primary transport)') : yellow('Disabled (legacy mode)')}`,
        `${dim('Model')}    ${bold(currentModel)}`,
        `${dim('Providers')} ${cyan(String(Object.keys(catalogue).length))} providers found dynamically`,
    ], { title: 'pi-ai STATUS', width: 58, color: piAiEnabled ? c.green : c.yellow });
    console.log('');

    const currentProvider = agent.config.get('llmProvider');
    const topChoices: any[] = [
        { name: `  ${piAiEnabled ? 'Disable pi-ai' : 'Enable pi-ai'} ${dim('(toggle)')}`, value: 'toggle' },
        { name: `   ${bold('Check for Catalog Updates')} ${dim('(npm update)')}`, value: 'update_catalog' },
        { name: `   ${bold('Auto-detect provider')} ${dim(`(infer from model name)${!currentProvider ? ' ✓ active' : ''}`)}`, value: 'auto_provider' },
        new inquirer.Separator(dim('  ─── Browse & Select Model ────────────')),
        ...Object.entries(catalogue).map(([key, cat]: [string, any]) => {
            const hasKey = !!(piKeyMap[key] ? piKeyMap[key]() : undefined);
            return {
                name: `  ${statusDot(hasKey, '')} ${bold(cat.label.padEnd(32))} ${hasKey ? green('key set') : yellow('no key')}  ${dim(`${cat.models.length} models`)}`,
                value: `cat:${key}`,
            };
        }),
        new inquirer.Separator(dim('  ────────────────────────────────────')),
        { name: dim('  ← Back'), value: 'back' },
    ];

    const { choice } = await inquirer.prompt([{
        type: 'list', name: 'choice',
        message: cyan('pi-ai options:'),
        choices: topChoices,
    }]);

    if (choice === 'back') return showModelsMenu(ctx);

    if (choice === 'toggle') {
        const newVal = !piAiEnabled;
        agent.config.set('usePiAI', newVal);
        console.log(newVal ? green('pi-ai enabled — it will be tried first on every LLM call') : yellow('pi-ai disabled — using legacy provider code directly'));
        await waitKeyPress();
        return showPiAIConfig(ctx);
    }

    if (choice === 'update_catalog') {
        await performPiAIUpdate();
        return showPiAIConfig(ctx);
    }

    if (choice === 'auto_provider') {
        agent.config.set('llmProvider', undefined);
        console.log(green('Provider set to AUTO — will be inferred from model name.'));
        await waitKeyPress();
        return showPiAIConfig(ctx);
    }

    if ((choice as string).startsWith('cat:')) {
        const catKey = (choice as string).slice(4);
        const cat = catalogue[catKey];
        const hasKey = !!(piKeyMap[catKey] ? piKeyMap[catKey]() : undefined);

        const modelChoices = cat.models.map((m: any) => ({
            name: `  ${bold(m.id.padEnd(46))} ${dim(m.note)}`,
            value: m.id,
        }));
        modelChoices.push({ name: dim('    Enter custom model ID...'), value: '__custom__' } as any);
        modelChoices.push({
            name: hasKey
                ? yellow(`   Change / re-authenticate ${cat.label} key`)
                : yellow(`   Set ${cat.label} API key first`),
            value: '__setkey__',
        } as any);
        modelChoices.push({ name: dim('  ← Back'), value: '__back__' } as any);

        const { selectedModel } = await inquirer.prompt([{
            type: 'list', name: 'selectedModel',
            message: cyan(`${cat.label}${hasKey ? '' : yellow('  no key set')} — select model:`),
            choices: modelChoices,
        }]);

        if (selectedModel === '__back__') return showPiAIConfig(ctx);

        if (selectedModel === '__setkey__') {
            const oauthProvider = ['github-copilot', 'google-antigravity', 'google-gemini-cli', 'openai-codex', 'opencode'].includes(catKey);

            if (oauthProvider) {
                const { doLogin } = await inquirer.prompt([{
                    type: 'confirm', name: 'doLogin',
                    message: `${cat.label} requires OAuth. Authorize & Login now?`,
                    default: true,
                }]);

                if (doLogin) {
                    console.log(cyan(`\n  Opening browser for ${cat.label} authorization...`));
                    await agent.llm.piAiLogin(catKey);
                    console.log(green(`\n  Login process completed. Try selecting a model again.`));
                } else {
                    console.log(yellow(`\n    Manual login instructions:`));
                    console.log(`     Run: ${bold(`npx @mariozechner/pi-ai /login ${catKey}`)}`);
                }
            } else if (catKey === 'azure-openai-responses') {
                const { endpoint } = await inquirer.prompt([{
                    type: 'input', name: 'endpoint',
                    message: `Enter Azure OpenAI Endpoint URL (e.g. https://NAME.openai.azure.com/):`,
                    default: agent.config.get('azureEndpoint'),
                }]);
                if (endpoint?.trim()) agent.config.set('azureEndpoint', endpoint.trim());

                const { keyVal } = await inquirer.prompt([{
                    type: 'input', name: 'keyVal',
                    message: `Enter Azure OpenAI API Key:`,
                    default: agent.config.get('openaiApiKey'),
                }]);
                if (keyVal?.trim()) agent.config.set('openaiApiKey', keyVal.trim());

                console.log(green(`Azure OpenAI credentials saved.`));
            } else if (catKey === 'google-vertex') {
                const { project } = await inquirer.prompt([{
                    type: 'input', name: 'project',
                    message: `Enter Google Cloud Project ID:`,
                    default: agent.config.get('googleProjectId'),
                }]);
                if (project?.trim()) agent.config.set('googleProjectId', project.trim());

                const { location } = await inquirer.prompt([{
                    type: 'input', name: 'location',
                    message: `Enter Vertex AI Location (e.g. us-central1):`,
                    default: agent.config.get('googleLocation'),
                }]);
                if (location?.trim()) agent.config.set('googleLocation', location.trim());

                console.log(green(`Google Vertex credentials saved.`));
            } else {
                const cfgKey = piConfigKey[catKey];
                if (cfgKey) {
                    const { keyVal } = await inquirer.prompt([{
                        type: 'input', name: 'keyVal',
                        message: `Enter ${cat.label} API key:`,
                        default: agent.config.get(cfgKey),
                    }]);
                    if (keyVal?.trim()) {
                        agent.config.set(cfgKey, keyVal.trim());
                        console.log(green(`${cat.label} API key saved.`));
                    }
                }
            }
            await waitKeyPress();
            return showPiAIConfig(ctx);
        }

        let finalModel = selectedModel;
        if (selectedModel === '__custom__') {
            const { custom } = await inquirer.prompt([{
                type: 'input', name: 'custom',
                message: `Enter ${cat.label} model ID:`,
                default: currentModel,
            }]);
            finalModel = custom;
        }

        agent.config.set('modelName', finalModel);
        // Sync llmProvider so the Active Model box reflects the real provider
        const legacyMap: Record<string, string> = {
            openai: 'openai',
            google: 'google',
            anthropic: 'anthropic',
            openrouter: 'openrouter',
            'amazon-bedrock': 'bedrock',
            groq: 'groq',
            mistral: 'mistral',
            deepseek: 'deepseek',
            xai: 'xai',
            perplexity: 'perplexity',
            cerebras: 'cerebras'
        };
        const legacyProvider = legacyMap[catKey];
        if (legacyProvider !== undefined) {
            agent.config.set('llmProvider', legacyProvider as any);
        } else {
            agent.config.set('llmProvider', undefined);
        }
        if (!piAiEnabled) agent.config.set('usePiAI', true);

        // If no key is set for this provider, ask now
        const keyAfterSelect = piKeyMap[catKey] ? piKeyMap[catKey]() : undefined;
        if (!keyAfterSelect && piConfigKey[catKey]) {
            console.log('');
            console.log(yellow(`No API key configured for ${cat.label}.`));
            const { setNow } = await inquirer.prompt([{
                type: 'confirm', name: 'setNow',
                message: `Set ${cat.label} API key now?`,
                default: true,
            }]);
            if (setNow) {
                const { keyVal } = await inquirer.prompt([{
                    type: 'input', name: 'keyVal',
                    message: `Enter ${cat.label} API key:`,
                }]);
                if (keyVal?.trim()) {
                    agent.config.set(piConfigKey[catKey], keyVal.trim());
                    console.log(green(`${cat.label} API key saved.`));
                }
            }
        }

        console.log(green(`Model set to: ${finalModel}`));
        await waitKeyPress();
        return showPiAIConfig(ctx);
    }

    return showPiAIConfig(ctx);
}

export async function showSetPrimaryProvider(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentProvider = agent.config.get('llmProvider');
    const hasOpenAI = !!agent.config.get('openaiApiKey');
    const hasGoogle = !!agent.config.get('googleApiKey');
    const hasOpenRouter = !!agent.config.get('openrouterApiKey');
    const hasNvidia = !!agent.config.get('nvidiaApiKey');
    const hasAnthropic = !!agent.config.get('anthropicApiKey');
    const hasBedrock = !!agent.config.get('bedrockAccessKeyId');

    const choices = [
        {
            name: `Auto (infer from model name)${!currentProvider ? ' ✓' : ''}`,
            value: 'auto'
        },
        {
            name: `OpenAI (no key configured)${currentProvider === 'openai' ? ' ✓' : ''}`,
            value: 'openai',
            disabled: !hasOpenAI
        },
        {
            name: `Google Gemini (no key configured)${currentProvider === 'google' ? ' ✓' : ''}`,
            value: 'google',
            disabled: !hasGoogle
        },
        {
            name: `OpenRouter (no key configured)${currentProvider === 'openrouter' ? ' ✓' : ''}`,
            value: 'openrouter',
            disabled: !hasOpenRouter
        },
        {
            name: `NVIDIA (no key configured)${currentProvider === 'nvidia' ? ' ✓' : ''}`,
            value: 'nvidia',
            disabled: !hasNvidia
        },
        {
            name: `Anthropic (Claude) (no key configured)${currentProvider === 'anthropic' ? ' ✓' : ''}`,
            value: 'anthropic',
            disabled: !hasAnthropic
        },
        {
            name: `AWS Bedrock (no credentials configured)${currentProvider === 'bedrock' ? ' ✓' : ''}`,
            value: 'bedrock',
            disabled: !hasBedrock
        },
        { name: 'Back', value: 'back' }
    ];

    const { selected } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selected',
            message: 'Select Primary LLM Provider:',
            choices
        }
    ]);

    if (selected === 'back') return showModelsMenu(ctx);

    if (selected === 'auto') {
        agent.config.set('llmProvider', undefined);
        console.log('Primary provider set to AUTO (will infer from model name)');
    } else {
        agent.config.set('llmProvider', selected);
        console.log(`Primary provider set to: ${selected.toUpperCase()}`);
    }

    await waitKeyPress();
    return showModelsMenu(ctx);
}

export async function showOpenRouterConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('openrouterApiKey') || 'Not Set';
    const baseUrl = agent.config.get('openrouterBaseUrl') || 'https://openrouter.ai/api/v1';
    const referer = agent.config.get('openrouterReferer') || 'Not Set';
    const appName = agent.config.get('openrouterAppName') || 'Not Set';

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `OpenRouter Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${apiKey.substring(0, 8)}...)`, value: 'key' },
                { name: `Set Base URL (current: ${baseUrl})`, value: 'base' },
                { name: `Set Referer Header (current: ${referer})`, value: 'referer' },
                { name: `Set App Name Header (current: ${appName})`, value: 'app' },
                { name: 'Set Model Name (e.g., meta-llama/llama-3.3-70b-instruct:free)', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu(ctx);

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter API Key:' }]);
        agent.config.set('openrouterApiKey', val);
    } else if (action === 'base') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter Base URL:', default: baseUrl }]);
        agent.config.set('openrouterBaseUrl', val);
    } else if (action === 'referer') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter Referer (optional):', default: referer === 'Not Set' ? '' : referer }]);
        agent.config.set('openrouterReferer', val);
    } else if (action === 'app') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter App Name (optional):', default: appName === 'Not Set' ? '' : appName }]);
        agent.config.set('openrouterAppName', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenRouter Model ID:', default: currentModel || 'meta-llama/llama-3.3-70b-instruct:free' }]);
        agent.config.set('modelName', val);
    }

    console.log('OpenRouter settings updated!');
    await waitKeyPress();
    return showOpenRouterConfig(ctx);
}

export async function showOpenAIConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('openaiApiKey') || 'Not Set';

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `OpenAI Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${apiKey.substring(0, 8)}...)`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu(ctx);

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter OpenAI API Key:' }]);
        agent.config.set('openaiApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Model (e.g., gpt-6.1-sol, gpt-6-luna):', default: DEFAULT_MODEL_IDS.openaiMain }]);
        agent.config.set('modelName', val);
    }

    console.log('OpenAI settings updated!');
    await waitKeyPress();
    return showOpenAIConfig(ctx);
}

export async function showGeminiConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    renderScreenHeader('Google Gemini (Cloud API)');

    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('googleApiKey') || 'Not Set';

    console.log(dim('\n  Note: This is for Google\'s Cloud API.'));
    console.log(dim('  If you are using a Gemini model via Ollama, use the "Ollama" menu instead.\n'));

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `Google Gemini Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${apiKey.substring(0, 8)}...)`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu(ctx);

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Google API Key:' }]);
        agent.config.set('googleApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([
            {
                type: 'list',
                name: 'val',
                message: 'Select Gemini Model:',
                choices: [
                    { name: 'Gemini 3.8 Flash      — Most intelligent Flash (agents, long-horizon coding)', value: 'gemini-3.8-flash' },
                    { name: 'Gemini 3.6 Flash      — Previous-generation Flash (balanced)', value: 'gemini-3.6-flash' },
                    { name: 'Gemini 3.5 Flash-Lite — Fastest, most cost-effective', value: 'gemini-3.5-flash-lite' },
                    { name: 'Gemini 3.1 Pro        — Advanced reasoning (preview)', value: 'gemini-3.1-pro-preview' },
                    { name: 'Gemini 2.5 Flash      — Legacy: limited access, migrate when you can', value: 'gemini-2.5-flash' },
                    { name: 'Custom model ID...', value: 'custom' }
                ]
            }
        ]);
        if (val === 'custom') {
            const { custom } = await inquirer.prompt([{ type: 'input', name: 'custom', message: 'Enter Gemini Model ID:', default: currentModel }]);
            agent.config.set('modelName', custom);
        } else {
            agent.config.set('modelName', val);
        }
    }

    console.log('Gemini settings updated!');
    await waitKeyPress();
    return showGeminiConfig(ctx);
}

export async function showNvidiaConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('nvidiaApiKey') || 'Not Set';
    const displayKey = apiKey === 'Not Set' ? 'Not Set' : `${apiKey.substring(0, Math.min(8, apiKey.length))}...`;

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `NVIDIA Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${displayKey})`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu(ctx);

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter NVIDIA API Key:' }]);
        agent.config.set('nvidiaApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Model (e.g., nvidia:moonshotai/kimi-k2.5):', default: 'nvidia:moonshotai/kimi-k2.5' }]);
        agent.config.set('modelName', val);
    }

    console.log('NVIDIA settings updated!');
    await waitKeyPress();
    return showNvidiaConfig(ctx);
}

export async function showAnthropicConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentModel = agent.config.get('modelName');
    const apiKey = agent.config.get('anthropicApiKey') || 'Not Set';
    const displayKey = apiKey === 'Not Set' ? 'Not Set' : `${apiKey.substring(0, 12)}...`;

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `Anthropic Settings (Active Model: ${currentModel}):`,
            choices: [
                { name: `Set API Key (current: ${displayKey})`, value: 'key' },
                { name: 'Set Model Name', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu(ctx);

    if (action === 'key') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Anthropic API Key:' }]);
        agent.config.set('anthropicApiKey', val);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([
            {
                type: 'list',
                name: 'val',
                message: 'Select Claude Model:',
                choices: [
                    { name: 'Claude Fable 5.1  — Demanding reasoning, long-horizon agentic work', value: 'claude-fable-5-1' },
                    { name: 'Claude Opus 5.5   — Most capable (agentic coding, knowledge work)', value: 'claude-opus-5-5' },
                    { name: 'Claude Sonnet 5.5 — Best speed + intelligence balance', value: 'claude-sonnet-5-5' },
                    { name: 'Claude Haiku 5.5  — Fastest, high-volume and latency-sensitive', value: 'claude-haiku-5-5' },
                    { name: 'Custom model ID...', value: 'custom' }
                ]
            }
        ]);
        if (val === 'custom') {
            const { custom } = await inquirer.prompt([{ type: 'input', name: 'custom', message: 'Enter Claude Model ID:', default: currentModel }]);
            agent.config.set('modelName', custom);
        } else {
            agent.config.set('modelName', val);
        }
    }

    console.log('Anthropic settings updated!');
    await waitKeyPress();
    return showAnthropicConfig(ctx);
}

export async function showBedrockConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentModel = agent.config.get('modelName');
    const region = agent.config.get('bedrockRegion') || 'Not Set';
    const accessKey = agent.config.get('bedrockAccessKeyId') || 'Not Set';

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `AWS Bedrock Settings (Model: ${currentModel}):`,
            choices: [
                { name: `Set Region (current: ${region})`, value: 'region' },
                { name: accessKey === 'Not Set' ? 'Set Access Keys' : 'Update Access Keys', value: 'keys' },
                { name: 'Set Model Name (e.g., bedrock:anthropic.claude-sonnet-5-5)', value: 'model' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showModelsMenu(ctx);

    if (action === 'region') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter AWS Region for Bedrock (e.g., us-east-1):' }]);
        agent.config.set('bedrockRegion', val);
    } else if (action === 'keys') {
        const answers = await inquirer.prompt([
            { type: 'input', name: 'accessKeyId', message: 'Access Key ID:', mask: '*' },
            { type: 'input', name: 'secretAccessKey', message: 'Secret Access Key:', mask: '*' },
            { type: 'input', name: 'sessionToken', message: 'Session Token (optional):', mask: '*' }
        ]);
        if (answers.accessKeyId) agent.config.set('bedrockAccessKeyId', answers.accessKeyId);
        if (answers.secretAccessKey) agent.config.set('bedrockSecretAccessKey', answers.secretAccessKey);
        if (answers.sessionToken) agent.config.set('bedrockSessionToken', answers.sessionToken);
    } else if (action === 'model') {
        const { val } = await inquirer.prompt([{ type: 'input', name: 'val', message: 'Enter Bedrock Model ID:', default: currentModel || 'bedrock:anthropic.claude-sonnet-5-5' }]);
        agent.config.set('modelName', val);
    }

    console.log('Bedrock settings updated!');
    await waitKeyPress();
    return showBedrockConfig(ctx);
}
