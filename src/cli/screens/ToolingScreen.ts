import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import inquirer from 'inquirer';
import { getOrcBotDataHome, resolveDataHomePath } from '../../utils/dataHome';
import { logger } from '../../utils/logger';
import { DEFAULT_MODEL_IDS } from '../../config/modelDefaults';
import { renderScreenHeader } from '../ui/Header';
import {
    box,
    dim,
    bold,
    cyan,
    green,
    yellow,
    red,
    gray,
    c,
    statusDot,
    waitKeyPress,
    brightCyan,
} from '../ui/Widgets';
import { isAutonomyEnabledForChannel, toggleAutonomyChannel } from './ChannelsScreen';
import { getCliContext, CliContext } from '../context';

export async function showBrowserMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;
    const currentEngine = agent.config.get('browserEngine') || 'puppeteer';
    const lightpandaPath = agent.config.get('lightpandaPath');
    const lightpandaEndpoint = agent.config.get('lightpandaEndpoint') || 'ws://127.0.0.1:9222';
    const pidPath = resolveDataHomePath('lightpanda.pid');

    // Check if Lightpanda is installed
    const isInstalled = lightpandaPath && fs.existsSync(lightpandaPath);

    // Check if Lightpanda is running
    let isRunning = false;
    let runningPid: number | null = null;
    if (fs.existsSync(pidPath)) {
        try {
            runningPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
            process.kill(runningPid, 0);
            isRunning = true;
        } catch {
            fs.unlinkSync(pidPath);
        }
    }

    renderScreenHeader('Browser Engine');
    console.log('');
    const computerUseEnabled = !!agent.config.get('googleComputerUseEnabled');
    const computerUseModel = agent.config.get('googleComputerUseModel') || DEFAULT_MODEL_IDS.googleComputerUse;
    const hasGoogleKey = !!agent.config.get('googleApiKey');
    const browserLines = [
        `${dim('Engine')}     ${currentEngine === 'lightpanda' ? brightCyan(bold('Lightpanda')) : currentEngine === 'puppeteer' ? cyan(bold('Puppeteer (Chrome)')) : cyan(bold('Puppeteer (Chrome)'))}`,
        `${dim('Installed')}  ${isInstalled ? green('● Yes') : gray('○ No')}`,
        ...(isInstalled ? [
            `${dim('Server')}     ${isRunning ? green(`● Running ${dim(`(PID: ${runningPid})`)}`) : gray('○ Stopped')}`,
            `${dim('Endpoint')}   ${dim(lightpandaEndpoint)}`,
        ] : []),
        `${dim('Gemini CU')}  ${computerUseEnabled ? green('● Enabled') : gray('○ Disabled')}${computerUseEnabled ? ` ${dim(computerUseModel)}` : ''}`,
    ];
    box(browserLines, { title: 'BROWSER STATUS', width: 50 });
    console.log('');

    const choices = [
        { name: currentEngine === 'puppeteer' ? 'Switch to Lightpanda (9x less RAM)' : 'Switch to Puppeteer (Chrome)', value: 'toggle' },

        { name: computerUseEnabled ? `${bold('Disable')} Gemini Computer Use` : `${bold('Enable')} Gemini Computer Use ${dim('(vision-based browser control)')}`, value: 'computeruse' },
    ];

    if (!isInstalled) {
        choices.push({ name: 'Install Lightpanda', value: 'install' });
    } else {
        if (isRunning) {
            choices.push({ name: 'Stop Lightpanda Server', value: 'stop' });
        } else {
            choices.push({ name: 'Start Lightpanda Server', value: 'start' });
        }
    }

    choices.push({ name: 'Back', value: 'back' });

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Browser Options:',
            choices
        }
    ]);

    if (action === 'back') return showToolingMenu(ctx);

    if (action === 'toggle') {
        if (currentEngine === 'puppeteer') {
            if (!isInstalled) {
                console.log('\nLightpanda is not installed.');
                const { install } = await inquirer.prompt([
                    { type: 'confirm', name: 'install', message: 'Would you like to install it now?', default: true }
                ]);
                if (install) {
                    console.log('\nInstalling Lightpanda...');
                    console.log('   Run: orcbot lightpanda install\n');
                }
            } else {
                agent.config.set('browserEngine', 'lightpanda');
                console.log('\nSwitched to Lightpanda');
                if (!isRunning) {
                    console.log('     Remember to start the server: orcbot lightpanda start -b');
                }
            }
        } else {
            agent.config.set('browserEngine', 'puppeteer');
            console.log('\nSwitched to Playwright (Chrome)');
        }
    } else if (action === 'computeruse') {
        if (computerUseEnabled) {
            agent.config.set('googleComputerUseEnabled', false);
            console.log('\nGemini Computer Use disabled');
            console.log('   Browser actions will use DOM-based selectors only.');
        } else {
            if (!hasGoogleKey) {
                console.log('\nGoogle API key is not set. Computer Use requires a Google API key.');
                const { key } = await inquirer.prompt([
                    { type: 'input', name: 'key', message: 'Enter Google API Key (or press Enter to skip):' }
                ]);
                if (key) {
                    agent.config.set('googleApiKey', key);
                    console.log('    Google API key saved.');
                } else {
                    console.log('     Skipped. Computer Use may not work without a Google API key.');
                }
            }
            agent.config.set('googleComputerUseEnabled', true);
            console.log(`\nGemini Computer Use enabled`);
            console.log(`   Model: ${computerUseModel}`);
            console.log('   All browser_* actions will prefer vision-based control with DOM fallback.');
            const { changeModel } = await inquirer.prompt([
                { type: 'confirm', name: 'changeModel', message: `Keep default model (${computerUseModel})?`, default: true }
            ]);
            if (!changeModel) {
                const { model } = await inquirer.prompt([
                    { type: 'input', name: 'model', message: 'Enter Gemini Computer Use model name:', default: computerUseModel }
                ]);
                if (model) {
                    agent.config.set('googleComputerUseModel', model);
                    console.log(`    Model set to: ${model}`);
                }
            }
        }
    } else if (action === 'install') {
        console.log('\nTo install Lightpanda, run:');
        console.log('   orcbot lightpanda install\n');
    } else if (action === 'start') {
        const { spawn } = require('child_process');
        const dataDir = getOrcBotDataHome();
        const logPath = path.join(dataDir, 'lightpanda.log');
        const out = fs.openSync(logPath, 'a');

        // Use --timeout 300 (5 minutes) to prevent premature disconnection
        const child = spawn(lightpandaPath, ['serve', '--host', '127.0.0.1', '--port', '9222', '--timeout', '300'], {
            detached: true,
            stdio: ['ignore', out, out]
        });

        fs.writeFileSync(pidPath, String(child.pid));
        child.unref();

        console.log('\nLightpanda started');
        console.log(`   PID: ${child.pid}`);
        console.log(`   Endpoint: ws://127.0.0.1:9222`);
    } else if (action === 'stop') {
        try {
            process.kill(runningPid!, 'SIGTERM');
            fs.unlinkSync(pidPath);
            console.log('\nLightpanda stopped');
        } catch (e: any) {
            console.error(`\nFailed to stop: ${e.message}`);
        }
    }

    await waitKeyPress();
    return showBrowserMenu(ctx);
}

export async function showToolingMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;
    renderScreenHeader('Tooling & APIs');

    const hasSerper = !!agent.config.get('serperApiKey');
    const hasBrave = !!agent.config.get('braveSearchApiKey');
    const hasSearxng = !!agent.config.get('searxngUrl');
    const hasCaptcha = !!agent.config.get('captchaApiKey');
    const browserEngine = agent.config.get('browserEngine') || 'puppeteer';
    const computerUseOn = !!agent.config.get('googleComputerUseEnabled');
    const imageGenProvider = agent.config.get('imageGenProvider');
    const imageGenModel = agent.config.get('imageGenModel');
    const hasImageGen = !!(imageGenProvider || imageGenModel || agent.config.get('openaiApiKey') || agent.config.get('googleApiKey'));
    const imageGenLabel = imageGenModel ? `${imageGenModel}` : imageGenProvider ? `${imageGenProvider} (auto)` : hasImageGen ? 'Auto-detect' : 'Not configured';
    const googleIdentityStatus = agent.googleIdentity.getStatus();
    const hasGoogleIdentity = googleIdentityStatus.connected;
    const googleWorkspaceStatus = await agent.googleWorkspaceCli.getStatus();
    const hasGoogleWorkspace = googleWorkspaceStatus.installed;
    const googleWorkspaceLabel = hasGoogleWorkspace
        ? googleWorkspaceStatus.configuredAccount || googleWorkspaceStatus.binary || 'Installed'
        : 'Not installed';
    const githubCliStatus = await agent.githubCli.getStatus();
    const hasGitHubCli = githubCliStatus.installed;
    const githubCliLabel = hasGitHubCli
        ? githubCliStatus.binary || 'Installed'
        : 'Not installed';

    console.log('');
    const toolLines = [
        `${statusDot(true, '')} ${bold('Browser')}       ${browserEngine === 'lightpanda' ? cyan('Lightpanda') : cyan('Playwright')}${computerUseOn ? ` + ${green('Gemini CU')}` : ''}`,
        `${statusDot(hasSerper, '')} ${bold('Serper')}        ${hasSerper ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasBrave, '')} ${bold('Brave Search')}  ${hasBrave ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasSearxng, '')} ${bold('SearxNG')}       ${hasSearxng ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasCaptcha, '')} ${bold('2Captcha')}      ${hasCaptcha ? green('Configured') : gray('Not set')}`,
        `${statusDot(hasImageGen, '')} ${bold('Image Gen')}    ${hasImageGen ? green(imageGenLabel) : gray('Not set')}`,
        `${statusDot(hasGoogleIdentity, '')} ${bold('Google Identity')} ${hasGoogleIdentity ? green(googleIdentityStatus.email || 'Connected') : gray('Not connected')}`,
        `${statusDot(hasGoogleWorkspace, '')} ${bold('Google Workspace')} ${hasGoogleWorkspace ? green(googleWorkspaceLabel) : gray(googleWorkspaceLabel)}`,
        `${statusDot(hasGitHubCli, '')} ${bold('GitHub CLI')}   ${hasGitHubCli ? green(githubCliLabel) : gray(githubCliLabel)}`,
    ];
    box(toolLines, { title: 'TOOL STATUS', width: 52 });
    console.log('');

    const { tool } = await inquirer.prompt([
        {
            type: 'list',
            name: 'tool',
            message: cyan('Select tool to configure:'),
            choices: [
                { name: `   ${bold('Browser Engine')} ${dim('(Lightpanda / Chrome)')}`, value: 'browser' },
                new inquirer.Separator(dim('  ─── Search Providers ─────────────')),
                { name: `  ${statusDot(hasSerper, '')} Serper ${dim('(Web Search API)')}`, value: 'serper' },
                { name: `  ${statusDot(hasBrave, '')} Brave Search`, value: 'brave' },
                { name: `  ${statusDot(hasSearxng, '')} SearxNG ${dim('(Self-hosted)')}`, value: 'searxng' },
                { name: `   ${bold('Search Provider Order')}`, value: 'searchOrder' },
                new inquirer.Separator(dim('  ─── Other ────────────────────────')),
                { name: `  ${statusDot(hasCaptcha, '')} 2Captcha ${dim('(CAPTCHA Solver)')}`, value: 'captcha' },
                { name: `  ${statusDot(hasImageGen, '')}  ${bold('Image Generation')} ${dim(`(${imageGenLabel})`)}`, value: 'imagegen' },
                { name: `  ${statusDot(hasGoogleIdentity, '')}  ${bold('Google Identity')} ${dim('(OAuth + Gmail OTP)')}`, value: 'google_identity' },
                { name: `  ${statusDot(hasGoogleWorkspace, '')}  ${bold('Google Workspace CLI')} ${dim(`(${googleWorkspaceLabel})`)}`, value: 'google_workspace' },
                { name: `  ${statusDot(hasGitHubCli, '')}  ${bold('GitHub CLI')} ${dim(`(${githubCliLabel})`)}`, value: 'github_cli' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (tool === 'back') return showMainMenu();

    if (tool === 'browser') {
        await showBrowserMenu(ctx);
        return;
    } else if (tool === 'serper') {
        const apiKey = agent.config.get('serperApiKey') || 'Not Set';
        const { key } = await inquirer.prompt([
            { type: 'input', name: 'key', message: `Enter Serper API Key (current: ${apiKey.substring(0, 8)}...):` }
        ]);
        if (key) agent.config.set('serperApiKey', key);
    } else if (tool === 'brave') {
        const apiKey = agent.config.get('braveSearchApiKey') || 'Not Set';
        const { key } = await inquirer.prompt([
            { type: 'input', name: 'key', message: `Enter Brave Search API Key (current: ${apiKey.substring(0, 8)}...):` }
        ]);
        if (key) agent.config.set('braveSearchApiKey', key);
    } else if (tool === 'searxng') {
        const currentUrl = agent.config.get('searxngUrl') || 'Not Set';
        const { url } = await inquirer.prompt([
            { type: 'input', name: 'url', message: `Enter SearxNG Base URL (current: ${currentUrl}):` }
        ]);
        if (url) agent.config.set('searxngUrl', url);
    } else if (tool === 'searchOrder') {
        const currentOrder = agent.config.get('searchProviderOrder') || ['serper', 'brave', 'searxng', 'google', 'bing', 'duckduckgo'];
        const { order } = await inquirer.prompt([
            {
                type: 'input',
                name: 'order',
                message: `Enter provider order (comma-separated) (current: ${currentOrder.join(', ')}):`
            }
        ]);
        if (order) {
            const parsed = order.split(',').map((s: string) => s.trim()).filter(Boolean);
            if (parsed.length > 0) agent.config.set('searchProviderOrder', parsed);
        }
    } else if (tool === 'captcha') {
        const apiKey = agent.config.get('captchaApiKey') || 'Not Set';
        const { key } = await inquirer.prompt([
            { type: 'input', name: 'key', message: `Enter CAPTCHA Solver API Key (current: ${apiKey.substring(0, 8)}...):` }
        ]);
        if (key) agent.config.set('captchaApiKey', key);
    } else if (tool === 'imagegen') {
        console.log('');
        const imgLines = [
            `${dim('Provider')}  ${bold(String(agent.config.get('imageGenProvider') || 'auto'))}`,
            `${dim('Model')}     ${bold(String(agent.config.get('imageGenModel') || 'auto'))}`,
            `${dim('Size')}      ${bold(String(agent.config.get('imageGenSize') || '1024x1024'))}`,
            `${dim('Quality')}   ${bold(String(agent.config.get('imageGenQuality') || 'medium'))}`,
            '',
            `${dim('Available providers:')}`,
            `  ${agent.config.get('openaiApiKey') ? green('●') : red('○')} OpenAI  ${dim('(DALL·E 3, GPT Image)')}`,
            `  ${agent.config.get('googleApiKey') ? green('●') : red('○')} Google  ${dim('(Gemini Flash Image, Imagen)')}`,
            '',
            `${dim('Reuses your existing LLM API keys!')}`,
        ];
        box(imgLines, { title: 'IMAGE GENERATION', width: 52 });
        console.log('');

        const { imgAction } = await inquirer.prompt([
            {
                type: 'list',
                name: 'imgAction',
                message: cyan('Image Generation Options:'),
                choices: [
                    { name: `   ${bold('Set Provider')} ${dim('(openai / google / auto)')}`, value: 'provider' },
                    { name: `   ${bold('Set Model')} ${dim('(dall-e-3 / gemini-2.5-flash-image / ...)')}`, value: 'model' },
                    { name: `   ${bold('Set Default Size')} ${dim(`(current: ${agent.config.get('imageGenSize') || '1024x1024'})`)}`, value: 'size' },
                    { name: `   ${bold('Set Default Quality')} ${dim(`(current: ${agent.config.get('imageGenQuality') || 'medium'})`)}`, value: 'quality' },
                    new inquirer.Separator(dim('  ──────────────────────────────────')),
                    { name: dim('  ← Back'), value: 'back' }
                ]
            }
        ]);

        if (imgAction === 'back') {
            return showToolingMenu(ctx);
        } else if (imgAction === 'provider') {
            const { prov } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'prov',
                    message: 'Select image generation provider:',
                    choices: [
                        { name: `  Auto-detect ${dim('(uses first available key)')}`, value: '' },
                        { name: `  OpenAI ${dim('(DALL·E 3, GPT Image 1)')}`, value: 'openai' },
                        { name: `  Google ${dim('(Gemini 2.5 Flash Image, Gemini 3 Pro Image)')}`, value: 'google' },
                    ]
                }
            ]);
            agent.config.set('imageGenProvider', prov || undefined);
        } else if (imgAction === 'model') {
            const { mdl } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mdl',
                    message: 'Select image generation model:',
                    choices: [
                        { name: `  Auto ${dim('(provider default)')}`, value: '' },
                        new inquirer.Separator(dim('  ─── OpenAI ───')),
                        { name: `  dall-e-3 ${dim('(1024x1024, good quality)')}`, value: 'dall-e-3' },
                        { name: `  gpt-image-1 ${dim('(best quality, text rendering)')}`, value: 'gpt-image-1' },
                        new inquirer.Separator(dim('  ─── Google ───')),
                        { name: `  gemini-3.1-flash-image ${dim('(Nano Banana 2, fast)')}`, value: 'gemini-3.1-flash-image' },
                        { name: `  gemini-3-pro-image ${dim('(Nano Banana Pro, 4K)')}`, value: 'gemini-3-pro-image' },
                    ]
                }
            ]);
            agent.config.set('imageGenModel', mdl || undefined);
        } else if (imgAction === 'size') {
            const { sz } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'sz',
                    message: 'Select default image size:',
                    choices: [
                        { name: '  1024x1024 (square)', value: '1024x1024' },
                        { name: '  1024x1536 (portrait)', value: '1024x1536' },
                        { name: '  1536x1024 (landscape)', value: '1536x1024' },
                    ]
                }
            ]);
            agent.config.set('imageGenSize', sz);
        } else if (imgAction === 'quality') {
            const { q } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'q',
                    message: 'Select default image quality:',
                    choices: [
                        { name: `  low ${dim('(fastest, cheapest)')}`, value: 'low' },
                        { name: `  medium ${dim('(balanced)')}`, value: 'medium' },
                        { name: `  high ${dim('(best quality, slower)')}`, value: 'high' },
                    ]
                }
            ]);
            agent.config.set('imageGenQuality', q);
        }
    } else if (tool === 'google_identity') {
        await showGoogleIdentityMenu(ctx);
        return;
    } else if (tool === 'google_workspace') {
        await showGoogleWorkspaceCliMenu(ctx);
        return;
    } else if (tool === 'github_cli') {
        await showGitHubCliMenu(ctx);
        return;
    }

    console.log('Tooling configuration updated!');
    await waitKeyPress();
    return showToolingMenu(ctx);
}

export async function showGoogleIdentityMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;
    renderScreenHeader('Google Identity (OAuth + Gmail)');

    const status = agent.googleIdentity.getStatus();
    const email = status.email || '(unknown)';

    console.log('');
    box([
        `${dim('Configured')}   ${status.configured ? green('● yes') : gray('○ no')}`,
        `${dim('Connected')}    ${status.connected ? green('● yes') : gray('○ no')}`,
        `${dim('Email')}        ${status.connected ? cyan(email) : gray('(not connected)')}`,
        `${dim('Client ID')}    ${status.hasClientId ? green('set') : gray('not set')}`,
        `${dim('Client Secret')} ${status.hasClientSecret ? green('set') : gray('not set')}`,
        `${dim('Refresh Token')} ${status.hasRefreshToken ? green('stored') : gray('missing')}`,
        `${dim('Scope')}        ${status.scope ? status.scope.slice(0, 52) : gray('(none)')}`,
    ], { title: 'GOOGLE IDENTITY STATUS', width: 64, color: status.connected ? c.green : c.yellow });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Google Identity Options:'),
            choices: [
                { name: `   ${bold('Set OAuth Client Credentials')}`, value: 'set_credentials' },
                { name: `   ${bold('Generate Authorization URL')}`, value: 'auth_url' },
                { name: `   ${bold('Exchange Auth Code / Redirect URL')}`, value: 'exchange_code' },
                { name: `   ${bold('Test Gmail Search')}`, value: 'test_search' },
                { name: `   ${bold('Test OTP Extraction')}`, value: 'test_otp' },
                { name: `   ${bold('Disconnect (remove refresh token)')}`, value: 'disconnect' },
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showToolingMenu(ctx);

    if (action === 'set_credentials') {
        const currentClientId = String(agent.config.get('googleOAuthClientId') || '');
        const currentRedirect = String(agent.config.get('googleOAuthRedirectUri') || 'http://localhost');

        const ans = await inquirer.prompt([
            {
                type: 'input',
                name: 'clientId',
                message: `Google OAuth Client ID${currentClientId ? ' (leave blank to keep current)' : ''}:`
            },
            {
                type: 'password',
                name: 'clientSecret',
                message: `Google OAuth Client Secret${status.hasClientSecret ? ' (leave blank to keep current)' : ''}:`
            },
            {
                type: 'input',
                name: 'redirectUri',
                message: 'OAuth Redirect URI:',
                default: currentRedirect || 'http://localhost'
            },
            {
                type: 'input',
                name: 'email',
                message: 'Agent Google email (optional):',
                default: status.email || ''
            }
        ]);

        const clientId = String(ans.clientId || '').trim() || currentClientId;
        const clientSecret = String(ans.clientSecret || '').trim() || String(agent.config.get('googleOAuthClientSecret') || '');
        if (!clientId || !clientSecret) {
            console.log('\nClient ID and Client Secret are required.');
            await waitKeyPress();
            return showGoogleIdentityMenu(ctx);
        }

        agent.googleIdentity.setCredentials({ clientId, clientSecret, email: String(ans.email || '').trim() || undefined });
        agent.config.set('googleOAuthRedirectUri' as any, String(ans.redirectUri || 'http://localhost').trim() || 'http://localhost');
        console.log('\nGoogle OAuth credentials saved.');
    } else if (action === 'auth_url') {
        try {
            const url = agent.googleIdentity.getAuthorizationUrl();
            console.log('\nOpen this URL in your browser and complete consent:');
            console.log(cyan(url));
            console.log(dim('\nThen choose "Exchange Auth Code / Redirect URL" and paste either the code or full redirect URL.'));
        } catch (e) {
            console.log(`\n${e}`);
        }
    } else if (action === 'exchange_code') {
        const { codeOrUrl } = await inquirer.prompt([
            {
                type: 'input',
                name: 'codeOrUrl',
                message: 'Paste Google authorization code OR full redirect URL:'
            }
        ]);
        try {
            await agent.googleIdentity.exchangeAuthorizationCode(String(codeOrUrl || '').trim());
            const nextStatus = agent.googleIdentity.getStatus();
            console.log(`\nConnected Google identity${nextStatus.email ? `: ${nextStatus.email}` : ''}`);
        } catch (e) {
            console.log(`\n${e}`);
        }
    } else if (action === 'test_search') {
        const { query } = await inquirer.prompt([
            { type: 'input', name: 'query', message: 'Gmail query:', default: 'newer_than:7d (otp OR verification OR code)' }
        ]);
        try {
            const msgs = await agent.googleIdentity.searchInbox(String(query || '').trim(), 5);
            console.log(`\nFound ${msgs.length} message(s).`);
            msgs.slice(0, 5).forEach((m, idx) => {
                console.log(`${idx + 1}. ${m.subject || '(no subject)'} ${dim(`| from: ${m.from || 'unknown'}`)}`);
                if (m.snippet) console.log(`   ${dim(m.snippet.slice(0, 140))}`);
            });
        } catch (e) {
            console.log(`\n${e}`);
        }
    } else if (action === 'test_otp') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'fromContains', message: 'Optional sender contains:', default: '' },
            { type: 'input', name: 'subjectContains', message: 'Optional subject contains:', default: '' }
        ]);

        try {
            const res = await agent.googleIdentity.findLatestOtp({
                fromContains: String(ans.fromContains || '').trim() || undefined,
                subjectContains: String(ans.subjectContains || '').trim() || undefined
            });
            if (res.code) {
                console.log(`\nOTP found: ${bold(res.code)}`);
                if (res.message?.subject) console.log(`   ${dim('From message:')} ${res.message.subject}`);
            } else {
                console.log('\nNo OTP code found in recent matching messages.');
            }
        } catch (e) {
            console.log(`\n${e}`);
        }
    } else if (action === 'disconnect') {
        const { ok } = await inquirer.prompt([
            { type: 'confirm', name: 'ok', message: 'Remove stored Google refresh token?', default: false }
        ]);
        if (ok) {
            agent.googleIdentity.disconnect();
            console.log('\nGoogle identity disconnected.');
        }
    }

    await waitKeyPress();
    return showGoogleIdentityMenu(ctx);
}

export async function showGoogleWorkspaceCliMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;
    renderScreenHeader('Google Workspace CLI (gws)');

    const status = await agent.googleWorkspaceCli.getStatus();
    const configuredPath = String(agent.config.get('googleWorkspaceCliPath') || '').trim();
    const configuredAccount = String(agent.config.get('googleWorkspaceCliAccount') || '').trim();

    console.log('');
    box([
        `${dim('Installed')}      ${status.installed ? green('● yes') : gray('○ no')}`,
        `${dim('Binary')}         ${status.binary ? cyan(status.binary) : gray(configuredPath || '(not found)')}`,
        `${dim('Config Path')}    ${configuredPath ? cyan(configuredPath) : gray('(auto-detect)')}`,
        `${dim('Account')}        ${configuredAccount ? cyan(configuredAccount) : gray('(default account)')}`,
        `${dim('Auth')}           ${status.authError ? yellow('check needed') : status.authStatus ? green('looks ready') : gray('(unknown)')}`,
    ], { title: 'GOOGLE WORKSPACE STATUS', width: 68, color: status.installed ? c.green : c.yellow });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Google Workspace CLI Options:'),
            choices: [
                { name: `   ${bold('Install / Update gws')}`, value: 'install' },
                { name: `   ${bold('Set Binary Path / Default Account')}`, value: 'configure' },
                { name: `   ${bold('Run gws auth setup')}`, value: 'auth_setup' },
                { name: `   ${bold('Run gws auth login')}`, value: 'auth_login' },
                { name: `   ${bold('Show Auth Status Details')}`, value: 'auth_status' },
                { name: `   ${bold('Show Setup Help')}`, value: 'help' },
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showToolingMenu(ctx);

    const runInteractiveGws = (args: string[]) => {
        const binary = agent.googleWorkspaceCli.findBinary() || configuredPath;
        if (!binary) {
            console.log('\ngws is not installed or not configured yet.');
            return;
        }

        const result = spawnSync(binary, args, { stdio: 'inherit' });
        if (result.error) {
            console.log(`\n${result.error.message}`);
            return;
        }
        if (typeof result.status === 'number' && result.status !== 0) {
            console.log(`\nCommand exited with status ${result.status}.`);
        }
    };

    if (action === 'install') {
        const { ok } = await inquirer.prompt([
            { type: 'confirm', name: 'ok', message: 'Install or update @googleworkspace/cli globally with npm?', default: true }
        ]);
        if (ok) {
            const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            const result = spawnSync(npmBinary, ['install', '-g', '@googleworkspace/cli'], { stdio: 'inherit' });
            if (result.error) {
                console.log(`\n${result.error.message}`);
            } else if (typeof result.status === 'number' && result.status !== 0) {
                console.log(`\nnpm exited with status ${result.status}.`);
            } else {
                console.log('\ngws install/update completed.');
            }
        }
    } else if (action === 'configure') {
        const ans = await inquirer.prompt([
            {
                type: 'input',
                name: 'binaryPath',
                message: 'gws binary path or command (leave blank for auto-detect):',
                default: configuredPath
            },
            {
                type: 'input',
                name: 'account',
                message: 'Default Google Workspace account (leave blank to unset):',
                default: configuredAccount
            }
        ]);

        const binaryPath = String(ans.binaryPath || '').trim();
        const account = String(ans.account || '').trim();
        agent.config.set('googleWorkspaceCliPath' as any, binaryPath || undefined);
        agent.config.set('googleWorkspaceCliAccount' as any, account || undefined);
        agent.googleWorkspaceCli.invalidateBinaryCache();
        console.log('\nGoogle Workspace CLI configuration updated.');
    } else if (action === 'auth_setup') {
        runInteractiveGws(['auth', 'setup']);
    } else if (action === 'auth_login') {
        runInteractiveGws(['auth', 'login']);
    } else if (action === 'auth_status') {
        const latestStatus = await agent.googleWorkspaceCli.getStatus();
        console.log('');
        console.log(dim('Installed:'), latestStatus.installed ? green('yes') : red('no'));
        if (latestStatus.binary) console.log(dim('Binary:'), latestStatus.binary);
        if (latestStatus.configuredAccount) console.log(dim('Account:'), latestStatus.configuredAccount);
        if (latestStatus.authError) {
            console.log(dim('Auth error:'), yellow(latestStatus.authError));
        }
        if (latestStatus.authStatus !== undefined) {
            console.log(dim('Auth status:'));
            console.log(typeof latestStatus.authStatus === 'string'
                ? latestStatus.authStatus
                : JSON.stringify(latestStatus.authStatus, null, 2));
        }
    } else if (action === 'help') {
        console.log('');
        console.log(bold('Recommended setup:'));
        console.log(`  ${cyan('1.')} npm install -g @googleworkspace/cli`);
        console.log(`  ${cyan('2.')} gws auth setup`);
        console.log(`  ${cyan('3.')} gws auth login`);
        console.log('');
        console.log(bold('Built-in OrcBot skills:'));
        console.log('  google_workspace_status, google_workspace_command');
        console.log('  google_docs_create, google_docs_write, google_drive_list');
        console.log('  google_sheets_create, google_sheets_read, google_sheets_append');
        console.log('  google_calendar_create_event');
        console.log('  google_gmail_triage, google_gmail_send, google_gmail_reply, google_gmail_reply_all');
    }

    await waitKeyPress();
    return showGoogleWorkspaceCliMenu(ctx);
}

export async function showGitHubCliMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;
    renderScreenHeader('GitHub CLI (gh)');

    const status = await agent.githubCli.getStatus();
    const configuredPath = String(agent.config.get('githubCliPath') || '').trim();
    const defaultCwd = process.cwd();
    const binarySource = configuredPath ? 'config override' : 'PATH auto-detect';

    console.log('');
    box([
        `${dim('Installed')}      ${status.installed ? green('● yes') : gray('○ no')}`,
        `${dim('Binary')}         ${status.binary ? cyan(status.binary) : gray(configuredPath || '(not found)')}`,
        `${dim('Binary Source')}  ${status.binary ? green(binarySource) : gray(binarySource)}`,
        `${dim('Config Path')}    ${configuredPath ? cyan(configuredPath) : gray('(none, using auto-detect)')}`,
        `${dim('Auth')}           ${status.authError ? yellow('check needed') : status.authStatus ? green('looks ready') : gray('(unknown)')}`,
        `${dim('Workspace')}      ${cyan(defaultCwd)}`,
    ], { title: 'GITHUB CLI STATUS', width: 68, color: status.installed ? c.green : c.yellow });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('GitHub CLI Options:'),
            choices: [
                { name: `   ${bold('Set Binary Path Override')}`, value: 'configure' },
                { name: `   ${bold('Use Auto-Detect From PATH')}`, value: 'auto_detect' },
                { name: `   ${bold('Run gh auth login')}`, value: 'auth_login' },
                { name: `   ${bold('Show Auth Status Details')}`, value: 'auth_status' },
                { name: `   ${bold('List Pull Requests')}`, value: 'pr_list' },
                { name: `   ${bold('List Branches')}`, value: 'branch_list' },
                { name: `   ${bold('List Labels')}`, value: 'label_list' },
                { name: `   ${bold('Create Label')}`, value: 'label_create' },
                { name: `   ${bold('Delete Label')}`, value: 'label_delete' },
                { name: `   ${bold('Show PR Checks')}`, value: 'pr_checks' },
                { name: `   ${bold('Review Pull Request')}`, value: 'pr_review' },
                { name: `   ${bold('Comment On Pull Request')}`, value: 'pr_comment' },
                { name: `   ${bold('Merge Pull Request')}`, value: 'pr_merge' },
                { name: `   ${bold('List Releases')}`, value: 'release_list' },
                { name: `   ${bold('Upload Release Asset')}`, value: 'release_upload_asset' },
                { name: `   ${bold('List Variables')}`, value: 'variable_list' },
                { name: `   ${bold('Set Variable')}`, value: 'variable_set' },
                { name: `   ${bold('Delete Variable')}`, value: 'variable_delete' },
                { name: `   ${bold('List Workflow Runs')}`, value: 'workflow_runs' },
                { name: `  ▶ ${bold('Dispatch Workflow')}`, value: 'workflow_dispatch' },
                { name: `   ${bold('Rerun Workflow Run')}`, value: 'workflow_rerun' },
                { name: `   ${bold('Create Issue')}`, value: 'issue_create' },
                { name: `   ${bold('Comment On Issue')}`, value: 'issue_comment' },
                { name: `   ${bold('Create Release')}`, value: 'release_create' },
                { name: `   ${bold('Show Setup Help')}`, value: 'help' },
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showToolingMenu(ctx);

    const runInteractiveGh = (args: string[], cwd?: string) => {
        const binary = agent.githubCli.findBinary() || configuredPath;
        if (!binary) {
            console.log('\nGitHub CLI is not installed or not configured yet.');
            return;
        }

        const result = spawnSync(binary, args, { stdio: 'inherit', cwd: cwd || defaultCwd });
        if (result.error) {
            console.log(`\n${result.error.message}`);
            return;
        }
        if (typeof result.status === 'number' && result.status !== 0) {
            console.log(`\nCommand exited with status ${result.status}.`);
        }
    };

    if (action === 'configure') {
        const ans = await inquirer.prompt([
            {
                type: 'input',
                name: 'binaryPath',
                message: 'gh binary path override or command (leave blank to keep current override):',
                default: configuredPath
            }
        ]);

        const binaryPath = String(ans.binaryPath || '').trim();
        agent.config.set('githubCliPath' as any, binaryPath || undefined);
        agent.githubCli.invalidateBinaryCache();
        console.log(`\nGitHub CLI override ${binaryPath ? 'updated' : 'cleared; auto-detect will be used'}.`);
    } else if (action === 'auto_detect') {
        agent.config.set('githubCliPath' as any, undefined);
        agent.githubCli.invalidateBinaryCache();
        const refreshed = await agent.githubCli.getStatus();
        console.log(`\nAuto-detect enabled.${refreshed.binary ? ` Found: ${refreshed.binary}` : ' gh was not found on PATH.'}`);
    } else if (action === 'auth_login') {
        runInteractiveGh(['auth', 'login']);
    } else if (action === 'auth_status') {
        const latestStatus = await agent.githubCli.getStatus();
        console.log('');
        console.log(dim('Installed:'), latestStatus.installed ? green('yes') : red('no'));
        if (latestStatus.binary) console.log(dim('Binary:'), latestStatus.binary);
        if (latestStatus.authError) {
            console.log(dim('Auth error:'), yellow(String(latestStatus.authError)));
        } else if (latestStatus.authStatus) {
            console.log(dim('Auth status:'));
            console.log(typeof latestStatus.authStatus === 'string'
                ? latestStatus.authStatus
                : JSON.stringify(latestStatus.authStatus, null, 2));
        } else {
            console.log(dim('Auth status:'), gray('No auth information returned.'));
        }
    } else if (action === 'pr_list') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'list', name: 'state', message: 'PR state:', choices: ['open', 'closed', 'merged', 'all'], default: 'open' },
            { type: 'number', name: 'limit', message: 'Limit:', default: 10 }
        ]);

        const result = await agent.githubCli.listPullRequests({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            state: String(ans.state || 'open'),
            limit: Number(ans.limit) || 10,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            const pullRequests = Array.isArray(result.data) ? result.data : [];
            console.log(`\nFound ${pullRequests.length} pull request(s).`);
            for (const pr of pullRequests) {
                console.log(`${pr.number}. ${pr.title} ${dim(`| ${pr.state}${pr.isDraft ? ', draft' : ''}`)}`);
                console.log(`   ${dim(`${pr.headRefName} → ${pr.baseRefName}`)}`);
                if (pr.url) console.log(`   ${cyan(pr.url)}`);
            }
        }
    } else if (action === 'branch_list') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'query', message: 'Branch name contains (optional):', default: '' },
            { type: 'number', name: 'limit', message: 'Limit:', default: 20 }
        ]);

        const result = await agent.githubCli.listBranches({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            query: String(ans.query || '').trim() || undefined,
            limit: Number(ans.limit) || 20,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            const branches = Array.isArray(result.data?.branches) ? result.data.branches : [];
            const defaultBranch = result.data?.defaultBranch;
            console.log(`\nFound ${branches.length} branch(es).`);
            if (defaultBranch) console.log(`${dim('Default branch:')} ${cyan(defaultBranch)}`);
            for (const branch of branches) {
                const isDefault = defaultBranch && branch?.name === defaultBranch;
                console.log(`${branch.name}${isDefault ? ` ${dim('(default)')}` : ''}`);
            }
        }
    } else if (action === 'label_list') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'search', message: 'Label name contains (optional):', default: '' },
            { type: 'number', name: 'limit', message: 'Limit:', default: 20 }
        ]);

        const result = await agent.githubCli.listLabels({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            search: String(ans.search || '').trim() || undefined,
            limit: Number(ans.limit) || 20,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            const labels = Array.isArray(result.data) ? result.data : [];
            console.log(`\nFound ${labels.length} label(s).`);
            for (const label of labels) {
                console.log(`${label.name} ${dim(`#${label.color || 'unknown'}`)}`);
                if (label.description) console.log(`   ${dim(label.description)}`);
            }
        }
    } else if (action === 'label_create') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'name', message: 'Label name:' },
            { type: 'input', name: 'color', message: 'Hex color without # (example: ff0000):' },
            { type: 'input', name: 'description', message: 'Description (optional):', default: '' },
            { type: 'confirm', name: 'force', message: 'Update if label already exists?', default: true },
        ]);

        const result = await agent.githubCli.createLabel({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            name: String(ans.name || '').trim(),
            color: String(ans.color || '').trim(),
            description: String(ans.description || '').trim() || undefined,
            force: !!ans.force,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nLabel command submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'label_delete') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'name', message: 'Label name to delete:' },
        ]);

        const result = await agent.githubCli.deleteLabel({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            name: String(ans.name || '').trim(),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nLabel delete command submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'pr_checks') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'pullRequest', message: 'Pull request number or branch:' },
        ]);

        const result = await agent.githubCli.getPullRequestChecks({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            pullRequest: String(ans.pullRequest || '').trim(),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            const checks = Array.isArray(result.data) ? result.data : [];
            console.log(`\nFound ${checks.length} check(s).`);
            for (const check of checks) {
                console.log(`${check.name} ${dim(`| ${check.state}${check.bucket ? `, ${check.bucket}` : ''}`)}`);
                if (check.description) console.log(`   ${dim(check.description)}`);
                if (check.link) console.log(`   ${cyan(check.link)}`);
            }
        }
    } else if (action === 'pr_review') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'pullRequest', message: 'Pull request number or branch:' },
            { type: 'list', name: 'event', message: 'Review action:', choices: ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'], default: 'APPROVE' },
            { type: 'editor', name: 'body', message: 'Review body (optional):' },
        ]);

        const result = await agent.githubCli.reviewPullRequest({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            pullRequest: String(ans.pullRequest || '').trim(),
            event: String(ans.event || 'APPROVE') as 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES',
            body: String(ans.body || '').trim() || undefined,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nPull request review submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'pr_comment') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'pullRequest', message: 'Pull request number or branch:' },
            { type: 'editor', name: 'body', message: 'Comment body:' },
        ]);

        const result = await agent.githubCli.commentOnPullRequest({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            pullRequest: String(ans.pullRequest || '').trim(),
            body: String(ans.body || '').trim(),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nPull request comment submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'pr_merge') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'pullRequest', message: 'Pull request number or branch:' },
            { type: 'list', name: 'strategy', message: 'Merge strategy:', choices: ['merge', 'squash', 'rebase'], default: 'merge' },
            { type: 'input', name: 'subject', message: 'Commit subject (optional):', default: '' },
            { type: 'editor', name: 'body', message: 'Commit body / merge body (optional):' },
            { type: 'confirm', name: 'auto', message: 'Enable auto-merge?', default: false },
            { type: 'confirm', name: 'admin', message: 'Use admin override?', default: false },
            { type: 'confirm', name: 'deleteBranch', message: 'Delete branch after merge?', default: true },
            { type: 'input', name: 'matchHeadCommit', message: 'Match head commit SHA (optional):', default: '' },
        ]);

        const result = await agent.githubCli.mergePullRequest({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            pullRequest: String(ans.pullRequest || '').trim(),
            strategy: String(ans.strategy || 'merge') as 'merge' | 'squash' | 'rebase',
            subject: String(ans.subject || '').trim() || undefined,
            body: String(ans.body || '').trim() || undefined,
            auto: !!ans.auto,
            admin: !!ans.admin,
            deleteBranch: !!ans.deleteBranch,
            matchHeadCommit: String(ans.matchHeadCommit || '').trim() || undefined,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nPull request merge command submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'release_list') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'number', name: 'limit', message: 'Limit:', default: 10 }
        ]);

        const result = await agent.githubCli.listReleases({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            limit: Number(ans.limit) || 10,
        });
        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            const releases = Array.isArray(result.data) ? result.data : [];
            console.log(`\nFound ${releases.length} release(s).`);
            for (const release of releases) {
                const title = release.name || release.tagName;
                const status = release.isDraft ? 'draft' : release.isPrerelease ? 'prerelease' : 'published';
                const flags = release.isLatest ? ', latest' : release.isImmutable ? ', immutable' : '';
                console.log(`${title} ${dim(`| ${status}${flags}`)}`);
                if (release.tagName) console.log(`   ${dim(`tag: ${release.tagName}`)}`);
                if (release.publishedAt || release.createdAt) console.log(`   ${dim(`time: ${release.publishedAt || release.createdAt}`)}`);
            }
        }
    } else if (action === 'release_upload_asset') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'tag', message: 'Release tag:' },
            { type: 'input', name: 'files', message: 'Files to upload (comma-separated paths):' },
            { type: 'confirm', name: 'clobber', message: 'Overwrite asset if it already exists?', default: false },
        ]);

        const result = await agent.githubCli.uploadReleaseAsset({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            tag: String(ans.tag || '').trim(),
            files: String(ans.files || '').split(',').map((item) => item.trim()).filter(Boolean),
            clobber: !!ans.clobber,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nRelease asset upload requested.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'variable_list') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'number', name: 'limit', message: 'Limit:', default: 20 }
        ]);

        const result = await agent.githubCli.listVariables({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            limit: Number(ans.limit) || 20,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            const variables = Array.isArray(result.data) ? result.data : [];
            console.log(`\nFound ${variables.length} variable(s).`);
            for (const variable of variables) {
                console.log(`${variable.name} ${dim(`| ${variable.visibility || 'repo'}`)}`);
                if (variable.value) console.log(`   ${dim(variable.value)}`);
            }
        }
    } else if (action === 'variable_set') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'name', message: 'Variable name:' },
            { type: 'editor', name: 'value', message: 'Variable value:' },
            { type: 'list', name: 'visibility', message: 'Visibility (optional):', choices: ['', 'all', 'private', 'selected'], default: '' },
        ]);

        const result = await agent.githubCli.setVariable({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            name: String(ans.name || '').trim(),
            value: String(ans.value || '').trim(),
            visibility: ((): 'all' | 'private' | 'selected' | undefined => {
                const value = String(ans.visibility || '').trim();
                return value === 'all' || value === 'private' || value === 'selected'
                    ? value
                    : undefined;
            })(),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nVariable set command submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'variable_delete') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'name', message: 'Variable name to delete:' },
        ]);

        const result = await agent.githubCli.deleteVariable({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            name: String(ans.name || '').trim(),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nVariable delete command submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'workflow_runs') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'workflow', message: 'Workflow name/file (optional):', default: '' },
            { type: 'input', name: 'branch', message: 'Branch (optional):', default: '' },
            { type: 'list', name: 'status', message: 'Status filter:', choices: ['', 'queued', 'completed', 'in_progress', 'requested', 'waiting', 'pending', 'action_required', 'cancelled', 'failure', 'neutral', 'skipped', 'stale', 'startup_failure', 'success', 'timed_out'], default: '' },
            { type: 'number', name: 'limit', message: 'Limit:', default: 10 },
        ]);

        const result = await agent.githubCli.listWorkflowRuns({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            workflow: String(ans.workflow || '').trim() || undefined,
            branch: String(ans.branch || '').trim() || undefined,
            status: String(ans.status || '').trim() || undefined,
            limit: Number(ans.limit) || 10,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            const runs = Array.isArray(result.data) ? result.data : [];
            console.log(`\nFound ${runs.length} workflow run(s).`);
            for (const run of runs) {
                const name = run.workflowName || run.name || 'Workflow';
                console.log(`${run.databaseId}. ${name} ${dim(`| ${run.status}${run.conclusion ? `, ${run.conclusion}` : ''}`)}`);
                console.log(`   ${dim(`${run.headBranch || 'unknown branch'} • ${run.displayTitle || 'no title'}`)}`);
                if (run.url) console.log(`   ${cyan(run.url)}`);
            }
        }
    } else if (action === 'workflow_dispatch') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'workflow', message: 'Workflow name or file:' },
            { type: 'input', name: 'ref', message: 'Git ref (optional):', default: '' },
            { type: 'editor', name: 'fields', message: 'Workflow fields as JSON object (optional):' },
        ]);

        let fields: Record<string, string | number | boolean> | undefined;
        const rawFields = String(ans.fields || '').trim();
        if (rawFields) {
            try {
                const parsed = JSON.parse(rawFields);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    fields = parsed as Record<string, string | number | boolean>;
                } else {
                    console.log('\nFields JSON must be an object.');
                    await waitKeyPress();
                    return showGitHubCliMenu(ctx);
                }
            } catch (e: any) {
                console.log(`\nInvalid fields JSON: ${e.message}`);
                await waitKeyPress();
                return showGitHubCliMenu(ctx);
            }
        }

        const result = await agent.githubCli.dispatchWorkflow({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            workflow: String(ans.workflow || '').trim(),
            ref: String(ans.ref || '').trim() || undefined,
            fields,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nWorkflow dispatch requested.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'workflow_rerun') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'runId', message: 'Workflow run ID:' },
            { type: 'confirm', name: 'failed', message: 'Rerun failed jobs only?', default: false },
        ]);

        const result = await agent.githubCli.rerunWorkflowRun({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            runId: String(ans.runId || '').trim(),
            failed: !!ans.failed,
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nWorkflow rerun requested.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'issue_create') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'title', message: 'Issue title:' },
            { type: 'editor', name: 'body', message: 'Issue body:' },
            { type: 'input', name: 'labels', message: 'Labels (comma-separated, optional):', default: '' },
            { type: 'input', name: 'assignees', message: 'Assignees (comma-separated, optional):', default: '' },
        ]);

        const result = await agent.githubCli.createIssue({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            title: String(ans.title || '').trim(),
            body: String(ans.body || ''),
            labels: String(ans.labels || '').split(',').map((value) => value.trim()).filter(Boolean),
            assignees: String(ans.assignees || '').split(',').map((value) => value.trim()).filter(Boolean),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nGitHub issue created.');
            if (result.data?.url) console.log(cyan(result.data.url));
        }
    } else if (action === 'issue_comment') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'issue', message: 'Issue number:' },
            { type: 'editor', name: 'body', message: 'Comment body:' },
        ]);

        const result = await agent.githubCli.commentOnIssue({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            issue: String(ans.issue || '').trim(),
            body: String(ans.body || '').trim(),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nGitHub issue comment submitted.');
            if (result.stdout) console.log(result.stdout);
        }
    } else if (action === 'release_create') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'cwd', message: 'Working directory:', default: defaultCwd },
            { type: 'input', name: 'repo', message: 'Optional repo override (owner/name):', default: '' },
            { type: 'input', name: 'tag', message: 'Release tag (example: v1.0.8):' },
            { type: 'input', name: 'title', message: 'Release title (optional):', default: '' },
            { type: 'editor', name: 'notes', message: 'Release notes (leave blank to use generated notes):' },
            { type: 'input', name: 'target', message: 'Target branch/commit (optional):', default: '' },
            { type: 'confirm', name: 'draft', message: 'Create as draft?', default: false },
            { type: 'confirm', name: 'prerelease', message: 'Mark as prerelease?', default: false },
        ]);

        const notes = String(ans.notes || '');
        const result = await agent.githubCli.createRelease({
            cwd: String(ans.cwd || '').trim() || defaultCwd,
            repo: String(ans.repo || '').trim() || undefined,
            tag: String(ans.tag || '').trim(),
            title: String(ans.title || '').trim() || undefined,
            notes: notes.trim() || undefined,
            target: String(ans.target || '').trim() || undefined,
            draft: !!ans.draft,
            prerelease: !!ans.prerelease,
            generateNotes: !notes.trim(),
        });

        if (!result.success) {
            console.log(`\n${result.error || result.stderr || result.stdout}`);
        } else {
            console.log('\nGitHub release created.');
            if (result.data?.url) console.log(cyan(result.data.url));
        }
    } else if (action === 'help') {
        console.log('');
        console.log(`${bold('Install:')} https://cli.github.com/`);
        console.log(`${bold('Auto-detect:')} if ${cyan('gh')} is already on your PATH, OrcBot will use it automatically.`);
        console.log(`${bold('Binary path override:')} only set this when you want OrcBot to use a specific gh executable.`);
        console.log(`${bold('Auth:')} run ${cyan('gh auth login')} and choose the account you want OrcBot to use.`);
        console.log(`${bold('Repo context:')} by default, commands run in the current workspace. Use repo override when targeting another repository.`);
        console.log(`${bold('Agent skills:')} github_branch_list, github_label_list, github_label_create, github_label_delete, github_pr_list, github_pr_checks, github_pr_review, github_pr_comment, github_pr_merge, github_issue_create, github_issue_comment, github_release_create, github_release_upload_asset, github_variable_list, github_variable_set, github_variable_delete, github_workflow_runs, github_workflow_dispatch, github_workflow_rerun, plus github_cli_command for raw structured access.`);
    }

    await waitKeyPress();
    return showGitHubCliMenu(ctx);
}

export async function showGatewayMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;
    renderScreenHeader('Web Gateway');
    const currentPort = agent.config.get('gatewayPort') || 3100;
    const currentHost = agent.config.get('gatewayHost') || '0.0.0.0';
    const apiKey = agent.config.get('gatewayApiKey');
    const currentMcpPort = agent.config.get('mcpPort') || 3190;
    const currentMcpHost = agent.config.get('mcpHost') || '0.0.0.0';
    const currentMcpPath = agent.config.get('mcpPath') || '/mcp';
    const mcpApiKey = agent.config.get('mcpApiKey') || apiKey;
    const autonomyAllowed = isAutonomyEnabledForChannel('gateway-chat', ctx);

    
    const gatewayLines = [
        `${dim('Host')}       ${bold(String(currentHost))}`,
        `${dim('Port')}       ${brightCyan(bold(String(currentPort)))}`,
        `${dim('Endpoint')}   ${cyan(`http://${currentHost}:${currentPort}/api`)}`,
        `${dim('WebSocket')}  ${cyan(`ws://${currentHost}:${currentPort}`)}`,
        `${dim('Auth')}       ${apiKey ? green('● API Key set') : yellow('○ No authentication')}`,
        `${dim('Autonomy')}   ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
    ];
    box(gatewayLines, { title: 'GATEWAY CONFIG', width: 52 });
    const mcpLines = [
        `${dim('Host')}       ${bold(String(currentMcpHost))}`,
        `${dim('Port')}       ${brightCyan(bold(String(currentMcpPort)))}`,
        `${dim('Path')}       ${cyan(String(currentMcpPath))}`,
        `${dim('Endpoint')}   ${cyan(`http://${currentMcpHost}:${currentMcpPort}${currentMcpPath}`)}`,
        `${dim('Auth')}       ${mcpApiKey ? green('● API Key set') : yellow('○ No authentication')}`,
    ];
    box(mcpLines, { title: 'MCP HTTP CONFIG', width: 52 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Gateway Options:'),
            choices: [
                { name: `   ${bold('Start Gateway Server')}`, value: 'start' },
                { name: `   ${bold('Start Gateway + Agent')}`, value: 'start_with_agent' },
                { name: `   ${bold('Start Gateway + Agent + MCP HTTP')}`, value: 'start_with_agent_mcp' },
                { name: `   ${bold('Start MCP HTTP Only')}`, value: 'start_mcp_http' },
                { name: `   ${bold('Show MCP Client Config (Local/Tailnet)')}`, value: 'mcp_info' },
                new inquirer.Separator(dim('  ─── Settings ─────────────────────')),
                { name: `   Set Port ${dim(`(current: ${currentPort})`)}`, value: 'port' },
                { name: `   Set Host ${dim(`(current: ${currentHost})`)}`, value: 'host' },
                { name: `   ${apiKey ? 'Update' : 'Set'} API Key`, value: 'apikey' },
                { name: `   Set MCP Port ${dim(`(current: ${currentMcpPort})`)}`, value: 'mcp_port' },
                { name: `   Set MCP Host ${dim(`(current: ${currentMcpHost})`)}`, value: 'mcp_host' },
                { name: `    Set MCP Path ${dim(`(current: ${currentMcpPath})`)}`, value: 'mcp_path' },
                { name: `   ${mcpApiKey ? 'Update' : 'Set'} MCP API Key`, value: 'mcp_apikey' },
                { name: `   ${autonomyAllowed ? 'Disable' : 'Enable'} Autonomous Messaging`, value: 'toggle_autonomy' },
                { name: `   ${bold('Tailscale Setup & Status Guide')}`, value: 'tailscale' },
                { name: `   ${bold('Public Tunnel Setup (Cloudflare/Ngrok)')}`, value: 'public_tunnel' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('gateway-chat', ctx);
        return showGatewayMenu(ctx);
    }

    if (action === 'start' || action === 'start_with_agent' || action === 'start_with_agent_mcp') {
        // Ask for optional static dashboard directory before starting the gateway
        const defaultStatic = agent.config.get('gatewayStaticDir') || path.join(process.cwd(), 'apps', 'dashboard');
        const { staticDirInput } = await inquirer.prompt([
            { type: 'input', name: 'staticDirInput', message: 'Optional path to dashboard static files (leave blank to skip):', default: defaultStatic }
        ]);

        let staticDir = (staticDirInput || '').trim();
        if (staticDir) {
            if (!path.isAbsolute(staticDir)) staticDir = path.join(process.cwd(), staticDir);
            if (!fs.existsSync(staticDir)) {
                const { createDir } = await inquirer.prompt([
                    { type: 'confirm', name: 'createDir', message: `Directory "${staticDir}" does not exist. Create it?`, default: false }
                ]);
                if (createDir) {
                    try { fs.mkdirSync(staticDir, { recursive: true }); } catch (e) { console.log(yellow(`Failed to create directory: ${e?.message || e}`)); }
                } else {
                    console.log('Aborting start. No static directory set.');
                    await waitKeyPress();
                    return showGatewayMenu(ctx);
                }
            }
            // Save as preference
            agent.config.set('gatewayStaticDir', staticDir);
        } else {
            staticDir = undefined;
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GatewayServer } = require('../../gateway/GatewayServer');

        const gatewayConfig = {
            port: currentPort,
            host: currentHost,
            apiKey: apiKey,
            staticDir: staticDir
        };

        const gateway = new GatewayServer(agent, agent.config, gatewayConfig);

        console.log('\nStarting OrcBot Web Gateway...');
        await gateway.start();

        console.log(`\nGateway is ready!`);
        console.log(`   REST API: http://${currentHost}:${currentPort}/api`);
        console.log(`   WebSocket: ws://${currentHost}:${currentPort}`);
        if (apiKey) {
            console.log(`   Auth: API key required (X-Api-Key header)`);
        }
        if (staticDir) console.log(`   Static files served from: ${staticDir}`);
        console.log('\n   Press Ctrl+C to stop\n');

        if (action === 'start_with_agent' || action === 'start_with_agent_mcp') {
            console.log('Also starting agent loop...\n');
            agent.start().catch(err => logger.error(`Agent error: ${err}`));
        }

        if (action === 'start_with_agent_mcp') {
            const { OrcBotMcpServer, resolveMcpHttpOptions } = require('../../mcp/OrcBotMcpServer');
            const resolved = resolveMcpHttpOptions(agent.config);
            const mcp = new OrcBotMcpServer(agent, {
                serverName: 'orcbot',
                serverVersion: '1.0.7',
                chatTimeoutMs: 90000,
                chatIdleMs: 4000,
                startAgentLoop: false
            });
            await mcp.startHttp(resolved);
            const connectHost = resolved.host === '0.0.0.0' ? 'localhost' : resolved.host;
            console.log(`MCP HTTP server running at http://${connectHost}:${resolved.port}${resolved.path}`);
            console.log(`   Health check: http://${connectHost}:${resolved.port}/health`);
            process.on('SIGINT', async () => { await mcp.close(); });
        }

        // Keep running - don't return to menu
        await new Promise(() => { }); // Wait forever until Ctrl+C
    } else if (action === 'start_mcp_http') {
        const { OrcBotMcpServer, resolveMcpHttpOptions } = require('../../mcp/OrcBotMcpServer');
        const resolved = resolveMcpHttpOptions(agent.config);
        const mcp = new OrcBotMcpServer(agent, {
            serverName: 'orcbot',
            serverVersion: '1.0.7',
            chatTimeoutMs: 90000,
            chatIdleMs: 4000,
            startAgentLoop: true
        });
        await mcp.startHttp(resolved);
        const connectHost = resolved.host === '0.0.0.0' ? 'localhost' : resolved.host;
        console.log('\nMCP HTTP server is ready!');
        console.log(`   Endpoint: http://${connectHost}:${resolved.port}${resolved.path}`);
        console.log(`   Health:   http://${connectHost}:${resolved.port}/health`);
        console.log('   Press Ctrl+C to stop\n');
        await new Promise(() => { });
    } else if (action === 'mcp_info') {
        const tsInfo = getTailscaleInfo();
        const connectHost = currentMcpHost === '0.0.0.0' ? 'localhost' : currentMcpHost;
        const localUrl = `http://${connectHost}:${currentMcpPort}${currentMcpPath}`;
        const remoteHost = tsInfo.dnsName || tsInfo.ipv4 || '';
        const remoteUrl = remoteHost ? `http://${remoteHost}:${currentMcpPort}${currentMcpPath}` : '(tailscale endpoint unavailable)';
        const localConfig = mcpApiKey
            ? JSON.stringify({ mcpServers: { orcbot: { url: localUrl, headers: { 'X-Api-Key': '<your-mcpApiKey>' } } } }, null, 2)
            : JSON.stringify({ mcpServers: { orcbot: { url: localUrl } } }, null, 2);
        const remoteConfig = mcpApiKey
            ? JSON.stringify({ mcpServers: { orcbot: { url: remoteUrl, headers: { 'X-Api-Key': '<your-mcpApiKey>' } } } }, null, 2)
            : JSON.stringify({ mcpServers: { orcbot: { url: remoteUrl } } }, null, 2);

        console.log('');
        box([
            `${dim('Local MCP URL')}   ${cyan(localUrl)}`,
            `${dim('Tailnet MCP URL')} ${remoteHost ? cyan(remoteUrl) : yellow('not available (run tailscale up)')}`,
            `${dim('Backend State')}   ${tsInfo.backendState ? (tsInfo.connected ? green(tsInfo.backendState) : yellow(tsInfo.backendState)) : gray('unknown')}`,
            `${dim('Tailnet DNS')}     ${tsInfo.dnsName ? brightCyan(tsInfo.dnsName) : gray('n/a')}`,
            `${dim('Tailnet IPv4')}    ${tsInfo.ipv4 ? brightCyan(tsInfo.ipv4) : gray('n/a')}`,
            `${dim('Tailnet State')}   ${tsInfo.connected ? green('connected') : yellow('not connected')}`,
            `${dim('Auth')}            ${mcpApiKey ? green('API key required') : yellow('no auth')}`,
        ], { title: 'MCP CLIENT CONNECTION INFO', width: 76 });
        if (tsInfo.health) {
            console.log(yellow(`Health: ${tsInfo.health}`));
            console.log('');
        }
        console.log('');
        console.log(bold('Local client JSON:'));
        console.log(localConfig);
        console.log('');
        console.log(bold('Tailnet client JSON:'));
        console.log(remoteConfig);
        console.log('');
    } else if (action === 'port') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Enter gateway port:', default: currentPort }
        ]);
        if (val) agent.config.set('gatewayPort', val);
    } else if (action === 'host') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter gateway host (0.0.0.0 for all interfaces):', default: currentHost }
        ]);
        if (val) agent.config.set('gatewayHost', val);
    } else if (action === 'apikey') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter API key (leave empty to disable auth):' }
        ]);
        agent.config.set('gatewayApiKey', val || undefined);
        console.log(val ? 'API key set!' : 'Authentication disabled.');
    } else if (action === 'mcp_port') {
        const { val } = await inquirer.prompt([
            { type: 'number', name: 'val', message: 'Enter MCP port:', default: currentMcpPort }
        ]);
        if (val) agent.config.set('mcpPort', val);
    } else if (action === 'mcp_host') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter MCP host (0.0.0.0 for all interfaces):', default: currentMcpHost }
        ]);
        if (val) agent.config.set('mcpHost', val);
    } else if (action === 'mcp_path') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter MCP path:', default: currentMcpPath }
        ]);
        if (val) {
            const normalizedPath = String(val).trim().startsWith('/') ? String(val).trim() : `/${String(val).trim()}`;
            agent.config.set('mcpPath', normalizedPath || '/mcp');
        }
    } else if (action === 'mcp_apikey') {
        const { val } = await inquirer.prompt([
            { type: 'input', name: 'val', message: 'Enter MCP API key (leave empty to disable):' }
        ]);
        agent.config.set('mcpApiKey', val || undefined);
        console.log(val ? 'MCP API key set!' : 'MCP authentication disabled.');
    } else if (action === 'tailscale') {
        console.log('');
        const tsInfo = getTailscaleInfo();
        const tailscaleInstalled = tsInfo.cliAvailable;
        const statusLine = !tailscaleInstalled
            ? yellow('not installed / cli not found')
            : tsInfo.connected
                ? green(`connected${tsInfo.version ? ` (${tsInfo.version})` : ''}`)
                : yellow(`installed but not connected${tsInfo.version ? ` (${tsInfo.version})` : ''}`);
        const tailscaleIp = tsInfo.ipv4 ? brightCyan(tsInfo.ipv4) : dim('n/a');
        const tailscaleDns = tsInfo.dnsName ? brightCyan(tsInfo.dnsName) : dim('n/a');

        const tailscaleLines = [
            `${dim('Tailscale')}   ${statusLine}`,
            `${dim('Backend')}     ${tsInfo.backendState ? (tsInfo.connected ? green(tsInfo.backendState) : yellow(tsInfo.backendState)) : dim('unknown')}`,
            `${dim('Tailnet IP')}  ${tailscaleIp}`,
            `${dim('Tailnet DNS')} ${tailscaleDns}`,
            `${dim('Gateway')}     ${bold(String(currentHost))}:${brightCyan(bold(String(currentPort)))}`,
            `${dim('Auth Key')}    ${apiKey ? green('set') : yellow('not set (recommended)')}`,
            `${dim('CLI Path')}    ${tsInfo.command ? dim(tsInfo.command) : dim('n/a')}`,
        ];
        box(tailscaleLines, { title: 'PRIVATE REMOTE ACCESS', width: 60 });
        if (tsInfo.health) {
            console.log(yellow(`Health: ${tsInfo.health}`));
            console.log('');
        }
        if (tsInfo.error) {
            console.log(yellow(`Note: ${tsInfo.error}`));
            console.log('');
        }

        console.log('');
        console.log(bold('Recommended setup (official pattern):'));
        console.log(`  1) ${dim('Install + login')} Tailscale on this OrcBot host and your operator device.`);
        console.log(`  2) ${dim('Keep gateway auth on')} by setting ${cyan('gatewayApiKey')} in this menu.`);
        console.log(`  3) ${dim('Prefer private networking')} expose gateway only to Tailnet users/devices.`);
        console.log(`  4) ${dim('Use ACLs')} allow only your ops group to reach port ${currentPort}.`);
        console.log('');
        console.log(dim('Quick commands:'));
        console.log(`  ${cyan('tailscale status --json')}`);
        console.log(`  ${cyan('tailscale ip -4')}`);
        console.log(`  ${cyan('orcbot gateway --with-agent -p ' + currentPort)}`);
        console.log(`  ${dim('Then browse:')} ${cyan('http://<tailnet-ip>:' + currentPort)}`);
        console.log('');

        const choices: any[] = [];
        if (!tailscaleInstalled) choices.push({ name: `    ${bold('Install Tailscale')}`, value: 'install' });
        else choices.push({ name: `   ${bold('Run login (tailscale up)')}`, value: 'login' });
        choices.push({ name: `   ${bold('Show quick commands')}`, value: 'quick' });
        choices.push(new inquirer.Separator(dim('  ──────────────────────────────────')));
        choices.push({ name: dim('  ← Back'), value: 'back' });

        const { tsAction } = await inquirer.prompt([
            { type: 'list', name: 'tsAction', message: cyan('Tailscale actions:'), choices }
        ]);

        if (tsAction === 'install') {
            const { confirmInstall } = await inquirer.prompt([{ type: 'confirm', name: 'confirmInstall', message: 'Install Tailscale on this host now?', default: true }]);
            if (confirmInstall) {
                console.log('');
                console.log('Installing Tailscale (platform-aware)...');
                try {
                    const platform = process.platform;
                    let installCmd = '';
                    if (platform === 'linux') {
                        installCmd = 'curl -fsSL https://tailscale.com/install.sh | sh';
                    } else if (platform === 'darwin') {
                        installCmd = 'brew install --cask tailscale || brew install tailscale';
                    } else if (platform === 'win32') {
                        // Prefer winget, fallback to choco
                        installCmd = 'winget install --silent --accept-package-agreements --accept-source-agreements Tailscale.Tailscale || choco install tailscale -y';
                    } else {
                        installCmd = '';
                    }

                    if (!installCmd) throw new Error(`Unsupported platform: ${process.platform}`);

                    // Run the installer in a shell so complex commands (pipes) work
                    const out = spawnSync(installCmd, { stdio: 'inherit', shell: true });
                    if (out.error) throw out.error;
                    if (out.status !== 0) throw new Error(`Installer exited with code ${out.status}`);

                    console.log(green('Tailscale installation completed.'));
                    console.log('You may need to run:');
                    console.log(`  ${cyan('tailscale up')}`);
                } catch (e: any) {
                    console.error(red(`Installation failed: ${String(e?.message || e)}`));
                    console.log('If automatic install failed, follow the official instructions: https://tailscale.com/download');
                }
            }
        } else if (tsAction === 'login') {
            try {
                console.log('Launching tailscale login flow (this may open a browser)...');
                // Run `tailscale up` which starts interactive login
                const r = spawnSync('tailscale up', { stdio: 'inherit', shell: true });
                if (r.error) throw r.error;
            } catch (e: any) {
                console.error(red(`Failed to run tailscale up: ${String(e?.message || e)}`));
            }
        } else if (tsAction === 'quick') {
            // Quick commands already displayed above — repeat with emphasis
            console.log('');
            console.log(cyan('Quick commands:'));
            console.log(`  ${cyan('tailscale status --json')}`);
            console.log(`  ${cyan('tailscale ip -4')}`);
            console.log(`  ${cyan('orcbot gateway --with-agent -p ' + currentPort)}`);
            console.log(`  ${dim('Then browse:')} ${cyan('http://<tailnet-ip>:' + currentPort)}`);
        }

        if (!tailscaleInstalled && tsAction !== 'install') {
            console.log(yellow('Tip: Install tailscale first, then rerun this check to confirm status/IP.'));
        }
    } else if (action === 'public_tunnel') {
        console.log('');
        const tunnelInfo = getPublicTunnelInfo();
        const localConnectHost = currentMcpHost === '0.0.0.0' ? 'localhost' : currentMcpHost;
        const localMcpUrl = `http://${localConnectHost}:${currentMcpPort}${currentMcpPath}`;

        const tunnelLines = [
            `${dim('MCP Local')}     ${cyan(localMcpUrl)}`,
            `${dim('cloudflared')}   ${tunnelInfo.cloudflared.available ? green(`installed${tunnelInfo.cloudflared.version ? ` (${tunnelInfo.cloudflared.version})` : ''}`) : yellow('not found')}`,
            `${dim('ngrok')}        ${tunnelInfo.ngrok.available ? green(`installed${tunnelInfo.ngrok.version ? ` (${tunnelInfo.ngrok.version})` : ''}`) : yellow('not found')}`,
            `${dim('Auth')}         ${mcpApiKey ? green('MCP API key set') : yellow('no mcpApiKey set (strongly recommended)')}`,
        ];
        box(tunnelLines, { title: 'PUBLIC MCP TUNNEL', width: 80 });

        console.log('');
        console.log(bold('Public MCP notes:'));
        console.log(`  • Use ${bold('HTTPS')} tunnel URLs only.`);
        console.log(`  • Browser GET on ${cyan('/mcp')} returns 405 by design; use MCP client POSTs.`);
        console.log(`  • Keep ${cyan('mcpApiKey')} enabled when exposing publicly.`);
        console.log('');

        const publicConfigTemplate = mcpApiKey
            ? JSON.stringify({ mcpServers: { orcbot: { url: 'https://<public-tunnel-url>/mcp', headers: { 'X-Api-Key': '<your-mcpApiKey>' } } } }, null, 2)
            : JSON.stringify({ mcpServers: { orcbot: { url: 'https://<public-tunnel-url>/mcp' } } }, null, 2);
        console.log(bold('Public client JSON template:'));
        console.log(publicConfigTemplate);
        console.log('');

        const tunnelChoices: any[] = [];
        if (tunnelInfo.cloudflared.available) tunnelChoices.push({ name: `    ${bold('Start Cloudflare Quick Tunnel now')}`, value: 'run_cloudflared' });
        if (tunnelInfo.ngrok.available) tunnelChoices.push({ name: `    ${bold('Start ngrok tunnel now')}`, value: 'run_ngrok' });
        tunnelChoices.push({ name: `   ${bold('Show quick commands')}`, value: 'quick' });
        tunnelChoices.push(new inquirer.Separator(dim('  ──────────────────────────────────')));
        tunnelChoices.push({ name: dim('  ← Back'), value: 'back' });

        const { tunnelAction } = await inquirer.prompt([
            { type: 'list', name: 'tunnelAction', message: cyan('Public tunnel actions:'), choices: tunnelChoices }
        ]);

        if (tunnelAction === 'run_cloudflared') {
            const cmd = tunnelInfo.cloudflared.command || 'cloudflared';
            console.log(`\nStarting Cloudflare quick tunnel to ${localMcpUrl} ...\n`);
            console.log(dim('Press Ctrl+C to stop the tunnel.'));
            const result = spawnSync(cmd, ['tunnel', '--url', `http://${localConnectHost}:${currentMcpPort}`], { stdio: 'inherit', shell: true });
            if (result.error) console.error(red(`Failed to start cloudflared: ${String(result.error.message || result.error)}`));
        } else if (tunnelAction === 'run_ngrok') {
            const cmd = tunnelInfo.ngrok.command || 'ngrok';
            console.log(`\nStarting ngrok tunnel to http://${localConnectHost}:${currentMcpPort} ...\n`);
            console.log(dim('Press Ctrl+C to stop the tunnel.'));
            const result = spawnSync(cmd, ['http', String(currentMcpPort)], { stdio: 'inherit', shell: true });
            if (result.error) console.error(red(`Failed to start ngrok: ${String(result.error.message || result.error)}`));
        } else if (tunnelAction === 'quick') {
            console.log('');
            console.log(cyan('Quick commands:'));
            console.log(`  ${cyan(`cloudflared tunnel --url http://${localConnectHost}:${currentMcpPort}`)}`);
            console.log(`  ${cyan(`ngrok http ${currentMcpPort}`)}`);
            console.log(`  ${dim('Then use in client JSON:')} ${cyan('https://<public-tunnel-url>/mcp')}`);
            console.log('');
        }
    }

    await waitKeyPress();
    return showGatewayMenu(ctx);
}

type TailscaleInfo = {
    cliAvailable: boolean;
    connected: boolean;
    backendState?: string;
    health?: string;
    ipv4?: string;
    dnsName?: string;
    version?: string;
    command?: string;
    error?: string;
};

type CliToolInfo = {
    available: boolean;
    command?: string;
    version?: string;
    error?: string;
};

type PublicTunnelInfo = {
    cloudflared: CliToolInfo;
    ngrok: CliToolInfo;
};

function runCli(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return {
        ok: result.status === 0,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
    };
}

function probeCliTool(candidates: string[], versionArgs: string[] = ['--version']): CliToolInfo {
    for (const cmd of candidates) {
        const probe = runCli(cmd, versionArgs);
        if (probe.ok || probe.stdout || !/not recognized|ENOENT|not found|cannot find/i.test(probe.stderr || '')) {
            return {
                available: true,
                command: cmd,
                version: (probe.stdout || probe.stderr || '').split(/\r?\n/)[0]?.trim() || undefined,
            };
        }
    }
    return { available: false, error: 'command not found' };
}

function getPublicTunnelInfo(): PublicTunnelInfo {
    const cloudflaredCandidates = process.platform === 'win32'
        ? ['cloudflared.exe', 'cloudflared', 'C:\\Program Files\\Cloudflare\\Cloudflare Tunnel\\cloudflared.exe']
        : ['cloudflared'];
    const ngrokCandidates = process.platform === 'win32'
        ? ['ngrok.exe', 'ngrok']
        : ['ngrok'];

    return {
        cloudflared: probeCliTool(cloudflaredCandidates),
        ngrok: probeCliTool(ngrokCandidates, ['version'])
    };
}

function getTailscaleCommandCandidates(): string[] {
    if (process.platform === 'win32') {
        return [
            'tailscale.exe',
            'tailscale',
            'C:\\Program Files\\Tailscale\\tailscale.exe',
            'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'
        ];
    }
    return ['tailscale'];
}

function parseFirstIPv4(text: string): string | undefined {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
        const candidate = line.split('/')[0].trim();
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) return candidate;
    }
    return undefined;
}

function getTailscaleInfo(): TailscaleInfo {
    const candidates = getTailscaleCommandCandidates();
    let selected: string | undefined;
    let version: string | undefined;

    for (const cmd of candidates) {
        const probe = runCli(cmd, ['version']);
        if (probe.ok || probe.stdout || !/not recognized|ENOENT|not found/i.test(probe.stderr || '')) {
            selected = cmd;
            version = (probe.stdout || '').split(/\r?\n/)[0]?.trim() || undefined;
            break;
        }
    }

    if (!selected) {
        return {
            cliAvailable: false,
            connected: false,
            error: 'tailscale CLI was not found on PATH or standard install locations.'
        };
    }

    const statusRun = runCli(selected, ['status', '--json']);
    let connected = false;
    let backendState: string | undefined;
    let health: string | undefined;
    let ipv4: string | undefined;
    let dnsName: string | undefined;

    if (statusRun.ok && statusRun.stdout) {
        try {
            const parsed = JSON.parse(statusRun.stdout);
            const backend = String(parsed?.BackendState || '').toLowerCase();
            connected = backend === 'running';
            backendState = String(parsed?.BackendState || '').trim() || undefined;
            if (Array.isArray(parsed?.Health) && parsed.Health.length > 0) {
                health = String(parsed.Health[0] || '').trim() || undefined;
            }

            const self = parsed?.Self || {};
            dnsName = String(self?.DNSName || self?.HostName || '').trim() || undefined;

            const fromAddresses = Array.isArray(self?.Addresses) ? self.Addresses : [];
            const fromTailscaleIps = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : [];
            ipv4 = parseFirstIPv4([...fromAddresses, ...fromTailscaleIps].join('\n'));
        } catch {
            // ignore JSON parse errors and continue fallbacks
        }
    }

    if (!ipv4) {
        const ipRun = runCli(selected, ['ip', '-4']);
        if (ipRun.ok) {
            ipv4 = parseFirstIPv4(ipRun.stdout);
        }
    }

    return {
        cliAvailable: true,
        connected,
        backendState,
        health,
        ipv4,
        dnsName,
        version,
        command: selected,
        error: statusRun.ok ? undefined : (statusRun.stderr || undefined)
    };
}