import inquirer from 'inquirer';
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
    waitKeyPress,
    brightCyan,
    magenta,
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';

/**
 * Worker Profile screen controller.
 */
export async function showWorkerProfileMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { workerProfile, showMainMenu } = ctx;

    renderScreenHeader('Worker Profile');

    if (!workerProfile.exists()) {
        console.log('');
        box([
            `${dim('No worker profile exists yet.')}`,
            `${dim('A profile gives your agent a digital identity.')}`,
        ], { title: 'IDENTITY', width: 48 });
        console.log('');

        const { create } = await inquirer.prompt([
            { type: 'confirm', name: 'create', message: 'Would you like to create a worker profile?', default: true }
        ]);

        if (!create) return showMainMenu();

        const { handle, displayName } = await inquirer.prompt([
            { type: 'input', name: 'handle', message: 'Enter a unique handle (username):', validate: (v: string) => v.trim().length > 0 || 'Handle is required' },
            { type: 'input', name: 'displayName', message: 'Enter display name:', validate: (v: string) => v.trim().length > 0 || 'Display name is required' }
        ]);

        workerProfile.create(handle.trim(), displayName.trim());
        console.log('\nWorker profile created!');
        await waitKeyPress();
        return showWorkerProfileMenu(ctx);
    }

    // Show current profile in a box
    const profile = workerProfile.get()!;
    console.log('');
    const profileLines = [
        `${dim('Handle')}    ${brightCyan(bold('@' + profile.handle))}`,
        `${dim('Name')}      ${bold(profile.displayName)}`,
        `${dim('Bio')}       ${profile.bio || gray('(not set)')}`,
        `${dim('Email')}     ${profile.email || gray('(not set)')}`,
        `${dim('Password')}  ${profile.password ? green('● Set') : gray('○ Not set')}`,
        `${dim('Avatar')}    ${profile.avatarUrl || gray('(not set)')}`,
        `${dim('Websites')}  ${profile.websites.length > 0 ? cyan(String(profile.websites.length) + ' linked') : gray('(none)')}`,
    ];
    box(profileLines, { title: 'DIGITAL IDENTITY', width: 52 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Profile Options:'),
            choices: [
                { name: `    ${bold('Edit Basic Info')} ${dim('(Handle, Name, Bio)')}`, value: 'edit_basic' },
                { name: `   ${profile.email ? 'Update' : 'Set'} ${bold('Email Address')}`, value: 'email' },
                { name: `   ${profile.password ? 'Update' : 'Set'} ${bold('Password')}`, value: 'password' },
                { name: `   ${bold('Manage Linked Websites')} ${dim(`(${profile.websites.length})`)}`, value: 'websites' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: `    ${red('Delete Worker Profile')}`, value: 'delete' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'edit_basic': {
            const answers = await inquirer.prompt([
                { type: 'input', name: 'handle', message: `Handle (current: ${profile.handle}):`, default: profile.handle },
                { type: 'input', name: 'displayName', message: `Display Name (current: ${profile.displayName}):`, default: profile.displayName },
                { type: 'input', name: 'bio', message: `Bio (current: ${profile.bio || '(empty)'}):`, default: profile.bio || '' },
                { type: 'input', name: 'avatarUrl', message: `Avatar URL (current: ${profile.avatarUrl || '(empty)'}):`, default: profile.avatarUrl || '' }
            ]);
            workerProfile.update({
                handle: answers.handle.trim() || profile.handle,
                displayName: answers.displayName.trim() || profile.displayName,
                bio: answers.bio.trim() || undefined,
                avatarUrl: answers.avatarUrl.trim() || undefined
            });
            console.log('Profile updated!');
            break;
        }
        case 'email': {
            const { email } = await inquirer.prompt([
                { type: 'input', name: 'email', message: 'Enter email address:', validate: (v: string) => v.includes('@') || 'Enter a valid email' }
            ]);
            workerProfile.setEmail(email.trim());
            console.log('Email updated!');
            break;
        }
        case 'password': {
            const { password, confirm } = await inquirer.prompt([
                { type: 'password', name: 'password', message: 'Enter password:', mask: '*' },
                { type: 'password', name: 'confirm', message: 'Confirm password:', mask: '*' }
            ]);
            if (password !== confirm) {
                console.log('Passwords do not match.');
            } else if (password.length < 1) {
                console.log('Password cannot be empty.');
            } else {
                workerProfile.setPassword(password);
                console.log('Password set (encrypted locally).');
            }
            break;
        }
        case 'websites':
            await showWorkerWebsitesMenu(ctx);
            return;
        case 'delete': {
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'Are you sure you want to DELETE your worker profile? This cannot be undone.', default: false }
            ]);
            if (confirm) {
                workerProfile.delete();
                console.log('Worker profile deleted.');
            }
            break;
        }
    }

    await waitKeyPress();
    return showWorkerProfileMenu(ctx);
}

/**
 * Worker Websites screen controller.
 */
export async function showWorkerWebsitesMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { workerProfile } = ctx;

    const profile = workerProfile.get();
    if (!profile) return showWorkerProfileMenu(ctx);

    renderScreenHeader('Linked Websites');

    console.log('');
    if (profile.websites.length === 0) {
        box([dim('No websites linked yet.')], { title: 'WEBSITES', width: 46 });
    } else {
        const siteLines = profile.websites.map((w, i) =>
            `${cyan(bold(String(i + 1)))}. ${bold(w.name)} ${dim('→')} ${w.url}${w.username ? dim(` (${w.username})`) : ''}`
        );
        box(siteLines, { title: `WEBSITES (${profile.websites.length})`, width: 56 });
    }
    console.log('');

    const choices: { name: string; value: string }[] = [
        { name: 'Add Website', value: 'add' }
    ];

    if (profile.websites.length > 0) {
        choices.push({ name: 'Remove Website', value: 'remove' });
    }

    choices.push({ name: 'Back', value: 'back' });

    const { action } = await inquirer.prompt([
        { type: 'list', name: 'action', message: 'Website Options:', choices }
    ]);

    if (action === 'back') return showWorkerProfileMenu(ctx);

    if (action === 'add') {
        const { name, url, username } = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Website name (e.g., GitHub, LinkedIn):', validate: (v: string) => v.trim().length > 0 || 'Name required' },
            { type: 'input', name: 'url', message: 'Profile URL:', validate: (v: string) => v.startsWith('http') || 'Enter a valid URL' },
            { type: 'input', name: 'username', message: 'Username on this site (optional):' }
        ]);
        workerProfile.addWebsite(name.trim(), url.trim(), username.trim() || undefined);
        console.log('Website added!');
    } else if (action === 'remove') {
        const { name } = await inquirer.prompt([
            {
                type: 'list',
                name: 'name',
                message: 'Select website to remove:',
                choices: profile.websites.map(w => ({ name: `${w.name} (${w.url})`, value: w.name }))
            }
        ]);
        workerProfile.removeWebsite(name);
        console.log('Website removed!');
    }

    await waitKeyPress();
    return showWorkerWebsitesMenu(ctx);
}

/**
 * Agentic User (HITL Proxy) screen controller.
 */
export async function showAgenticUserMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Agentic User (HITL Proxy)');

    const au = agent.agenticUser;
    const settings = au.getSettings();
    const stats = au.getStats();
    const isActive = au.isActive();

    console.log('');
    const enabledBadge = settings.enabled
        ? (isActive ? green(bold('● ACTIVE')) : yellow(bold('● ENABLED (not running)')))
        : gray(bold('○ DISABLED'));
    const proactiveBadge = settings.proactiveGuidance ? green('ON') : gray('OFF');

    const notifyUser = agent.config.get('agenticUserNotifyUser') !== false;
    const notifyBadge = notifyUser ? green('ON') : gray('OFF');

    const auLines = [
        `${dim('Status')}         ${enabledBadge}`,
        `${dim('Response Delay')} ${cyan(bold(String(settings.responseDelay)))}${dim('s')}  ${dim('(wait before intervening)')}`,
        `${dim('Confidence')}     ${cyan(bold(String(settings.confidenceThreshold)))}${dim('%')}  ${dim('(min to auto-intervene)')}`,
        `${dim('Proactive')}      ${proactiveBadge}  ${dim(`after ${settings.proactiveStepThreshold} steps`)}`,
        `${dim('Notify User')}    ${notifyBadge}  ${dim('(send updates to channel)')}`,
        `${dim('Max per Action')} ${cyan(bold(String(settings.maxInterventionsPerAction)))}`,
        `${dim('Check Interval')} ${cyan(bold(String(settings.checkIntervalSeconds)))}${dim('s')}`,
        '',
        `${dim('Interventions')}  ${cyan(bold(String(stats.totalInterventions)))} total  ${dim('│')}  ${green(bold(String(stats.appliedInterventions)))} applied`,
        `${dim('Active Timers')}  ${cyan(bold(String(stats.activeTimers)))}`,
    ];
    box(auLines, { title: 'AGENTIC USER STATUS', width: 56, color: isActive ? c.green : c.gray });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Agentic User Options:'),
            choices: [
                new inquirer.Separator(dim('  ─── Control ──────────────────────')),
                {
                    name: settings.enabled
                        ? `  ${red('○')} ${bold('Disable')} Agentic User`
                        : `  ${green('●')} ${bold('Enable')} Agentic User`, value: 'toggle'
                },
                new inquirer.Separator(dim('  ─── Settings ─────────────────────')),
                { name: `    Response Delay ${dim(`(${settings.responseDelay}s)`)}`, value: 'response_delay' },
                { name: `   Confidence Threshold ${dim(`(${settings.confidenceThreshold}%)`)}`, value: 'confidence' },
                { name: `   Proactive Guidance ${dim(`(${proactiveBadge})`)}`, value: 'proactive' },
                { name: `   Proactive Step Threshold ${dim(`(${settings.proactiveStepThreshold})`)}`, value: 'step_threshold' },
                { name: `   Check Interval ${dim(`(${settings.checkIntervalSeconds}s)`)}`, value: 'check_interval' },
                { name: `   Max Interventions/Action ${dim(`(${settings.maxInterventionsPerAction})`)}`, value: 'max_interventions' },
                { name: `   Notify User on Intervention ${dim(`(${notifyBadge})`)}`, value: 'notify_user' },
                new inquirer.Separator(dim('  ─── History ──────────────────────')),
                { name: `   View Intervention Log ${dim(`(${stats.totalInterventions} entries)`)}`, value: 'view_log' },
                { name: `    Clear History`, value: 'clear_history' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'toggle': {
            const newVal = !settings.enabled;
            agent.config.set('agenticUserEnabled', newVal);
            au.reloadSettings();
            console.log(newVal
                ? `\n${green('●')} Agentic User ${green(bold('enabled'))}. It will monitor actions and intervene when confident.`
                : `\n${gray('○')} Agentic User ${gray(bold('disabled'))}. No autonomous interventions will occur.`);
            break;
        }
        case 'response_delay': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Response delay in seconds (current: ${settings.responseDelay}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 0 ? true : 'Enter a non-negative number' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserResponseDelay', Number(val));
                au.reloadSettings();
                console.log(`\nResponse delay set to ${bold(val)}s`);
            }
            break;
        }
        case 'confidence': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Confidence threshold 0-100 (current: ${settings.confidenceThreshold}):`, validate: (v: string) => { const n = Number(v); return !isNaN(n) && n >= 0 && n <= 100 ? true : 'Enter a number 0-100'; } }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserConfidenceThreshold', Number(val));
                au.reloadSettings();
                console.log(`\nConfidence threshold set to ${bold(val)}%`);
            }
            break;
        }
        case 'proactive': {
            const newVal = !settings.proactiveGuidance;
            agent.config.set('agenticUserProactiveGuidance', newVal);
            au.reloadSettings();
            console.log(newVal
                ? `\nProactive guidance ${green(bold('enabled'))}. Agent will receive guidance when stuck.`
                : `\nProactive guidance ${gray(bold('disabled'))}.`);
            break;
        }
        case 'step_threshold': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Steps before proactive guidance kicks in (current: ${settings.proactiveStepThreshold}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 1 ? true : 'Enter a positive number' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserProactiveStepThreshold', Number(val));
                au.reloadSettings();
                console.log(`\nProactive step threshold set to ${bold(val)}`);
            }
            break;
        }
        case 'check_interval': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Check interval in seconds (current: ${settings.checkIntervalSeconds}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 5 ? true : 'Enter a number ≥ 5' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserCheckInterval', Number(val));
                au.reloadSettings();
                console.log(`\nCheck interval set to ${bold(val)}s`);
            }
            break;
        }
        case 'max_interventions': {
            const { val } = await inquirer.prompt([
                { type: 'input', name: 'val', message: `Max interventions per action (current: ${settings.maxInterventionsPerAction}):`, validate: (v: string) => !isNaN(Number(v)) && Number(v) >= 1 ? true : 'Enter a positive number' }
            ]);
            if (val !== undefined && val !== '') {
                agent.config.set('agenticUserMaxInterventions', Number(val));
                au.reloadSettings();
                console.log(`\nMax interventions per action set to ${bold(val)}`);
            }
            break;
        }
        case 'notify_user': {
            const newVal = !notifyUser;
            agent.config.set('agenticUserNotifyUser', newVal);
            console.log(newVal
                ? `\nUser notifications ${green(bold('enabled'))}. You'll be messaged on the originating channel when the Agentic User intervenes.`
                : `\nUser notifications ${gray(bold('disabled'))}. Interventions will happen silently.`);
            break;
        }
        case 'view_log': {
            const log = au.getInterventionLog(20);
            console.log('');
            if (log.length === 0) {
                console.log(dim('  No interventions recorded yet.'));
            } else {
                for (const entry of log) {
                    const appliedTag = entry.applied ? green(bold('APPLIED')) : yellow('SKIPPED');
                    const typeTag = entry.type === 'question-answer' ? cyan('Q&A')
                        : entry.type === 'direction-guidance' ? magenta('GUIDE')
                            : yellow('STUCK');
                    console.log(`  ${dim(entry.timestamp.slice(0, 19))}  ${typeTag}  ${appliedTag}  ${dim('conf:')}${entry.confidence}%`);
                    console.log(`    ${dim('Action:')} ${entry.actionId}`);
                    console.log(`    ${dim('Trigger:')} ${entry.trigger.slice(0, 80)}${entry.trigger.length > 80 ? '…' : ''}`);
                    console.log(`    ${dim('Response:')} ${entry.response.slice(0, 100)}${entry.response.length > 100 ? '…' : ''}`);
                    console.log('');
                }
            }
            await waitKeyPress();
            return showAgenticUserMenu(ctx);
        }
        case 'clear_history': {
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'Clear all intervention history?', default: false }
            ]);
            if (confirm) {
                au.clearHistory();
                console.log('\nIntervention history cleared.');
            }
            break;
        }
    }

    await waitKeyPress();
    return showAgenticUserMenu(ctx);
}
