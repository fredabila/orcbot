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
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';

/**
 * Security & Permissions screen controller.
 */
export async function showSecurityMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Security & Permissions');

    const safeMode = agent.config.get('safeMode');
    const sudoMode = agent.config.get('sudoMode');
    const overrideMode = agent.config.get('overrideMode');
    const selfModEnabled = agent.config.get('enableSelfModification') || false;
    const allowList = (agent.config.get('commandAllowList') || []) as string[];
    const denyList = (agent.config.get('commandDenyList') || []) as string[];
    const adminUsers = agent.config.get('adminUsers') as any || {};
    const tgAdmins = (adminUsers.telegram || []) as string[];
    const dcAdmins = (adminUsers.discord || []) as string[];
    const waAdmins = (adminUsers.whatsapp || []) as string[];
    const slAdmins = (adminUsers.slack || []) as string[];
    const totalAdmins = tgAdmins.length + dcAdmins.length + waAdmins.length;
    const adminConfigured = totalAdmins > 0;

    console.log('');
    const safeBadge = safeMode ? red(bold('LOCKED')) : green(bold('OPEN'));
    const sudoBadge = sudoMode ? yellow(bold('ENABLED')) : green(bold('OFF'));
    const selfModBadge = selfModEnabled ? red(bold('ENABLED')) : green(bold('OFF'));
    const overrideBadge = overrideMode ? red(bold('ACTIVE')) : green(bold('OFF'));
    const adminBadge = adminConfigured ? green(bold(`${totalAdmins} admin(s)`)) : yellow(bold('OPEN'));
    const secLines = [
        `${dim('Safe Mode')}     ${safeBadge}     ${dim(safeMode ? 'commands disabled' : 'commands allowed')}`,
        `${dim('Sudo Mode')}     ${sudoBadge}  ${dim(sudoMode ? 'all commands allowed' : 'allowList enforced')}`,
        `${dim('Self-Mod')}      ${selfModBadge}  ${dim(selfModEnabled ? 'codebase access allowed' : 'codebase access blocked')}`,
        `${dim('Override')}      ${overrideBadge}  ${dim(overrideMode ? 'persona boundaries OFF' : 'persona boundaries enforced')}`,
        `${dim('Admin Users')}   ${adminBadge}  ${dim(adminConfigured ? `TG:${tgAdmins.length} DC:${dcAdmins.length} WA:${waAdmins.length}` : 'everyone has full access')}`,
        ``,
        `${dim('Allow List')}    ${cyan(bold(String(allowList.length)))} commands  ${dim(allowList.length > 0 ? allowList.slice(0, 5).join(', ') + (allowList.length > 5 ? '…' : '') : '(empty)')}`,
        `${dim('Block List')}    ${cyan(bold(String(denyList.length)))} commands  ${dim(denyList.length > 0 ? denyList.slice(0, 5).join(', ') + (denyList.length > 5 ? '…' : '') : '(empty)')}`,
    ];
    box(secLines, { title: 'SECURITY STATUS', width: 58, color: overrideMode ? c.red : (safeMode ? c.red : (sudoMode ? c.yellow : c.green)) });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Security Options:'),
            choices: [
                new inquirer.Separator(dim('  ─── Mode Toggles ─────────────────')),
                { name: safeMode ? `   ${bold('Disable Safe Mode')} ${dim('(allow commands)')}` : `   ${bold('Enable Safe Mode')} ${dim('(block all commands)')}`, value: 'toggle_safe' },
                { name: sudoMode ? `   ${bold('Disable Sudo Mode')} ${dim('(enforce allowList)')}` : `    ${bold('Enable Sudo Mode')} ${dim('(allow ALL commands)')}`, value: 'toggle_sudo' },
                { name: selfModEnabled ? `    ${bold('Disable Self-Modification')} ${dim('(block codebase access)')}` : `    ${bold('Enable Self-Modification')} ${dim('(allow codebase access)')}`, value: 'toggle_self_mod' },
                new inquirer.Separator(dim('  ─── Dangerous ────────────────────')),
                { name: overrideMode ? `    ${bold('Disable Override')} ${dim('(restore persona boundaries)')}` : `    ${bold('Enable Override')} ${dim('(remove ALL behavioral limits)')}`, value: 'toggle_override' },
                new inquirer.Separator(dim('  ─── Allow List ───────────────────')),
                { name: `   Add Command to Allow List`, value: 'add_allow' },
                { name: `   Remove Command from Allow List`, value: 'remove_allow' },
                { name: `   View Full Allow List ${dim(`(${allowList.length})`)}`, value: 'view_allow' },
                new inquirer.Separator(dim('  ─── Block List ───────────────────')),
                { name: `   Add Command to Block List`, value: 'add_deny' },
                { name: `   Remove Command from Block List`, value: 'remove_deny' },
                { name: `   View Full Block List ${dim(`(${denyList.length})`)}`, value: 'view_deny' },
                new inquirer.Separator(dim('  ─── Admin Users ──────────────────')),
                { name: `   ${bold('Manage Admin Users')} ${dim(`(${totalAdmins} configured)`)}`, value: 'manage_admins' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showMainMenu();

    switch (action) {
        case 'toggle_safe':
            agent.config.set('safeMode', !safeMode);
            console.log(safeMode ? '\nSafe Mode disabled. Agent can now run commands.' : '\nSafe Mode enabled. All commands are blocked.');
            break;
        case 'toggle_sudo':
            if (!sudoMode) {
                const { confirm } = await inquirer.prompt([
                    { type: 'confirm', name: 'confirm', message: 'Sudo Mode allows the agent to run ANY command (including rm, format, etc). Are you sure?', default: false }
                ]);
                if (confirm) {
                    agent.config.set('sudoMode', true);
                    console.log('\nSudo Mode enabled. Agent can run any command.');
                }
            } else {
                agent.config.set('sudoMode', false);
                console.log('\nSudo Mode disabled. AllowList is now enforced.');
            }
            break;
        case 'toggle_self_mod':
            if (!selfModEnabled) {
                const { confirm } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'confirm',
                        message: `${bold('Self-Modification')} allows the agent to read and EDIT its own source code.\nThis is a high-autonomy feature that could lead to unexpected changes or bugs.\nAre you sure you want to enable this?`,
                        default: false
                    }
                ]);
                if (confirm) {
                    agent.config.set('enableSelfModification', true);
                    console.log('\nSelf-Modification enabled. Agent can now access and modify its own codebase.');
                }
            } else {
                agent.config.set('enableSelfModification', false);
                console.log('\nSelf-Modification disabled. Codebase access is now blocked.');
            }
            break;
        case 'toggle_override':
            if (!overrideMode) {
                console.log('');
                console.log(red(bold('  ╔══════════════════════════════════════════════════╗')));
                console.log(red(bold('  ║           BEHAVIORAL OVERRIDE WARNING          ║')));
                console.log(red(bold('  ╠══════════════════════════════════════════════════╣')));
                console.log(red('  ║  This removes ALL persona safety boundaries.     ║'));
                console.log(red('  ║  The agent will comply with ANY request —         ║'));
                console.log(red('  ║  including rude, offensive, or unhinged content.  ║'));
                console.log(red('  ║                                                  ║'));
                console.log(red('  ║  SOUL.md rules, tone restrictions, and refusal    ║'));
                console.log(red('  ║  behaviors are fully suspended while active.      ║'));
                console.log(red(bold('  ╚══════════════════════════════════════════════════╝')));
                console.log('');
                const { confirm: c1 } = await inquirer.prompt([
                    { type: 'confirm', name: 'confirm', message: red('I understand this removes behavioral guardrails. Continue?'), default: false }
                ]);
                if (c1) {
                    const { confirm: c2 } = await inquirer.prompt([
                        { type: 'input', name: 'confirm', message: red('Type OVERRIDE to confirm:') }
                    ]);
                    if (c2 === 'OVERRIDE') {
                        agent.config.set('overrideMode', true);
                        console.log('\nOverride Mode ' + red(bold('ACTIVE')) + '. All persona boundaries suspended.');
                    } else {
                        console.log('\nAborted — confirmation did not match.');
                    }
                }
            } else {
                agent.config.set('overrideMode', false);
                console.log('\nOverride Mode disabled. Persona boundaries restored.');
            }
            break;
        case 'add_allow': {
            const { cmd } = await inquirer.prompt([
                { type: 'input', name: 'cmd', message: 'Enter command to allow (e.g., apt, docker):' }
            ]);
            if (cmd.trim()) {
                const newList = [...allowList, cmd.trim().toLowerCase()];
                agent.config.set('commandAllowList', [...new Set(newList)]);
                console.log(`\n'${cmd.trim()}' added to allow list.`);
            }
            break;
        }
        case 'remove_allow': {
            if (allowList.length === 0) {
                console.log('\nAllow list is empty.');
                break;
            }
            const { cmd } = await inquirer.prompt([
                { type: 'list', name: 'cmd', message: 'Select command to remove:', choices: allowList }
            ]);
            agent.config.set('commandAllowList', allowList.filter(c => c !== cmd));
            console.log(`\n'${cmd}' removed from allow list.`);
            break;
        }
        case 'add_deny': {
            const { cmd } = await inquirer.prompt([
                { type: 'input', name: 'cmd', message: 'Enter command to block (e.g., rm, reboot):' }
            ]);
            if (cmd.trim()) {
                const newList = [...denyList, cmd.trim().toLowerCase()];
                agent.config.set('commandDenyList', [...new Set(newList)]);
                console.log(`\n'${cmd.trim()}' added to block list.`);
            }
            break;
        }
        case 'remove_deny': {
            if (denyList.length === 0) {
                console.log('\nBlock list is empty.');
                break;
            }
            const { cmd } = await inquirer.prompt([
                { type: 'list', name: 'cmd', message: 'Select command to unblock:', choices: denyList }
            ]);
            agent.config.set('commandDenyList', denyList.filter(c => c !== cmd));
            console.log(`\n'${cmd}' removed from block list.`);
            break;
        }
        case 'view_allow':
            console.log('\nFull Allow List:');
            console.log(allowList.length > 0 ? allowList.join(', ') : '(empty)');
            break;
        case 'view_deny':
            console.log('\nFull Block List:');
            console.log(denyList.length > 0 ? denyList.join(', ') : '(empty)');
            break;
        case 'manage_admins':
            await showAdminUsersMenu(ctx);
            return;
    }

    await waitKeyPress();
    return showSecurityMenu(ctx);
}

/**
 * Admin Users Management submenu.
 */
export async function showAdminUsersMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    renderScreenHeader('Admin Users Management');

    const adminUsers = agent.config.get('adminUsers') as any || {};
    const tgAdmins = (adminUsers.telegram || []) as string[];
    const dcAdmins = (adminUsers.discord || []) as string[];
    const waAdmins = (adminUsers.whatsapp || []) as string[];
    const slAdmins = (adminUsers.slack || []) as string[];

    const knownTg = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers('telegram').filter((u: any) => !tgAdmins.includes(u.id)) : [];
    const knownDc = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers('discord').filter((u: any) => !dcAdmins.includes(u.id)) : [];
    const knownWa = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers('whatsapp').filter((u: any) => !waAdmins.includes(u.id)) : [];
    const knownSl = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers('slack').filter((u: any) => !slAdmins.includes(u.id)) : [];

    const nameForId = (id: string, channel: 'telegram' | 'discord' | 'whatsapp' | 'slack') => {
        const user = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers(channel).find((u: any) => u.id === id) : null;
        return user ? `${user.name}${user.username ? ` (@${user.username})` : ''} — ${id}` : id;
    };

    console.log('');
    const adminLines = [
        `${dim('When admin users are configured, only listed users can trigger')}`,
        `${dim('elevated skills (shell, files, browser, scheduling, image gen).')}`,
        `${dim('Unlisted users can still chat but with restricted permissions.')}`,
        `${dim('If NO admins are set for a channel, everyone has full access.')}`,
        ``,
        `${dim('Telegram')}    ${cyan(bold(String(tgAdmins.length)))} admin(s)  ${dim(tgAdmins.length > 0 ? tgAdmins.slice(0, 3).map(id => nameForId(id, 'telegram')).join(', ') + (tgAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        `${dim('Discord')}     ${cyan(bold(String(dcAdmins.length)))} admin(s)  ${dim(dcAdmins.length > 0 ? dcAdmins.slice(0, 3).map(id => nameForId(id, 'discord')).join(', ') + (dcAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        `${dim('WhatsApp')}    ${cyan(bold(String(waAdmins.length)))} admin(s)  ${dim(waAdmins.length > 0 ? waAdmins.slice(0, 3).map(id => nameForId(id, 'whatsapp')).join(', ') + (waAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        `${dim('Slack')}       ${cyan(bold(String(slAdmins.length)))} admin(s)  ${dim(slAdmins.length > 0 ? slAdmins.slice(0, 3).map(id => nameForId(id, 'slack')).join(', ') + (slAdmins.length > 3 ? '…' : '') : '(open — all users are admin)')}`,
        ``,
        `${dim('Known users')} ${cyan(bold(String(knownTg.length + knownDc.length + knownWa.length + knownSl.length)))} ${dim('available to add')}  ${dim(`(${knownTg.length} tg, ${knownDc.length} dc, ${knownWa.length} wa, ${knownSl.length} sl)`)}`,
    ];
    box(adminLines, { title: 'ADMIN USERS', width: 62 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: cyan('Admin Users Options:'),
            choices: [
                new inquirer.Separator(dim('  ─── Telegram ─────────────────────')),
                { name: `   Add Telegram Admin ${knownTg.length > 0 ? cyan(`(${knownTg.length} known users)`) : dim('(enter ID manually)')}`, value: 'add_tg' },
                { name: `   Remove Telegram Admin ${dim(`(${tgAdmins.length})`)}`, value: 'remove_tg' },
                new inquirer.Separator(dim('  ─── Discord ──────────────────────')),
                { name: `   Add Discord Admin ${knownDc.length > 0 ? cyan(`(${knownDc.length} known users)`) : dim('(enter ID manually)')}`, value: 'add_dc' },
                { name: `   Remove Discord Admin ${dim(`(${dcAdmins.length})`)}`, value: 'remove_dc' },
                new inquirer.Separator(dim('  ─── WhatsApp ─────────────────────')),
                { name: `   Add WhatsApp Admin ${knownWa.length > 0 ? cyan(`(${knownWa.length} known users)`) : dim('(enter ID manually)')}`, value: 'add_wa' },
                { name: `   Remove WhatsApp Admin ${dim(`(${waAdmins.length})`)}`, value: 'remove_wa' },
                new inquirer.Separator(dim('  ──────────────────────────────────')),
                { name: dim('  ← Back to Security'), value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showSecurityMenu(ctx);

    const saveAdminUsers = (tg: string[], dc: string[], wa: string[]) => {
        const updated: any = {};
        if (tg.length > 0) updated.telegram = tg;
        if (dc.length > 0) updated.discord = dc;
        if (wa.length > 0) updated.whatsapp = wa;
        agent.config.set('adminUsers', Object.keys(updated).length > 0 ? updated : undefined);
    };

    switch (action) {
        case 'add_tg': {
            let id = '';
            if (knownTg.length > 0) {
                const choices = knownTg.map((u: any) => ({
                    name: `  ${u.name}${u.username ? ` (@${u.username})` : ''} — ID: ${u.id}  ${dim(`${u.messageCount} msgs, last ${new Date(u.lastSeen).toLocaleDateString()}`)}`,
                    value: u.id
                }));
                choices.push({ name: dim('    Enter ID manually'), value: '__manual__' });
                const { selected } = await inquirer.prompt([
                    { type: 'list', name: 'selected', message: 'Select a Telegram user to add as admin:', choices }
                ]);
                id = selected === '__manual__' ? '' : selected;
            }
            if (!id) {
                if (knownTg.length === 0) console.log(dim('  No known Telegram users yet — enter ID manually.'));
                const { userId } = await inquirer.prompt([
                    { type: 'input', name: 'userId', message: 'Enter Telegram numeric user ID (e.g., 123456789):' }
                ]);
                id = userId.trim();
            }
            if (id && /^\d+$/.test(id)) {
                const newList = [...new Set([...tgAdmins, id])];
                saveAdminUsers(newList, dcAdmins, waAdmins);
                const user = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers('telegram').find((u: any) => u.id === id) : null;
                console.log(`\nTelegram admin added: ${user ? `${user.name} (${id})` : id}`);
            } else if (id) {
                console.log('\nInvalid Telegram user ID. Must be numeric.');
            }
            break;
        }
        case 'remove_tg': {
            if (tgAdmins.length === 0) { console.log('\nNo Telegram admins configured.'); break; }
            const { userId } = await inquirer.prompt([
                { type: 'list', name: 'userId', message: 'Select Telegram admin to remove:', choices: tgAdmins.map(id => ({ name: nameForId(id, 'telegram'), value: id })) }
            ]);
            saveAdminUsers(tgAdmins.filter(id => id !== userId), dcAdmins, waAdmins);
            console.log(`\nTelegram admin removed: ${nameForId(userId, 'telegram')}`);
            break;
        }
        case 'add_dc': {
            let id = '';
            if (knownDc.length > 0) {
                const choices = knownDc.map((u: any) => ({
                    name: `  ${u.name}${u.username ? ` (@${u.username})` : ''} — ID: ${u.id}  ${dim(`${u.messageCount} msgs, last ${new Date(u.lastSeen).toLocaleDateString()}`)}`,
                    value: u.id
                }));
                choices.push({ name: dim('    Enter ID manually'), value: '__manual__' });
                const { selected } = await inquirer.prompt([
                    { type: 'list', name: 'selected', message: 'Select a Discord user to add as admin:', choices }
                ]);
                id = selected === '__manual__' ? '' : selected;
            }
            if (!id) {
                if (knownDc.length === 0) console.log(dim('  No known Discord users yet — enter ID manually.'));
                const { userId } = await inquirer.prompt([
                    { type: 'input', name: 'userId', message: 'Enter Discord snowflake user ID (e.g., 876513738667229184):' }
                ]);
                id = userId.trim();
            }
            if (id && /^\d{15,20}$/.test(id)) {
                const newList = [...new Set([...dcAdmins, id])];
                saveAdminUsers(tgAdmins, newList, waAdmins);
                const user = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers('discord').find((u: any) => u.id === id) : null;
                console.log(`\nDiscord admin added: ${user ? `${user.name} (${id})` : id}`);
            } else if (id) {
                console.log('\nInvalid Discord user ID. Must be a 15-20 digit snowflake.');
            }
            break;
        }
        case 'remove_dc': {
            if (dcAdmins.length === 0) { console.log('\nNo Discord admins configured.'); break; }
            const { userId } = await inquirer.prompt([
                { type: 'list', name: 'userId', message: 'Select Discord admin to remove:', choices: dcAdmins.map(id => ({ name: nameForId(id, 'discord'), value: id })) }
            ]);
            saveAdminUsers(tgAdmins, dcAdmins.filter(id => id !== userId), waAdmins);
            console.log(`\nDiscord admin removed: ${nameForId(userId, 'discord')}`);
            break;
        }
        case 'add_wa': {
            let id = '';
            if (knownWa.length > 0) {
                const choices = knownWa.map((u: any) => ({
                    name: `  ${u.name}${u.username ? ` (@${u.username})` : ''} — ${u.id}  ${dim(`${u.messageCount} msgs, last ${new Date(u.lastSeen).toLocaleDateString()}`)}`,
                    value: u.id
                }));
                choices.push({ name: dim('    Enter ID manually'), value: '__manual__' });
                const { selected } = await inquirer.prompt([
                    { type: 'list', name: 'selected', message: 'Select a WhatsApp user to add as admin:', choices }
                ]);
                id = selected === '__manual__' ? '' : selected;
            }
            if (!id) {
                if (knownWa.length === 0) console.log(dim('  No known WhatsApp users yet — enter ID manually.'));
                const { userId } = await inquirer.prompt([
                    { type: 'input', name: 'userId', message: 'Enter WhatsApp JID (e.g., 2348012345678@s.whatsapp.net):' }
                ]);
                id = userId.trim();
                if (id && /^\d+$/.test(id)) {
                    id = `${id}@s.whatsapp.net`;
                    console.log(dim(`  → Formatted as ${id}`));
                }
            }
            if (id && id.includes('@')) {
                const newList = [...new Set([...waAdmins, id])];
                saveAdminUsers(tgAdmins, dcAdmins, newList);
                const user = typeof agent.getKnownUsers === 'function' ? agent.getKnownUsers('whatsapp').find((u: any) => u.id === id) : null;
                console.log(`\nWhatsApp admin added: ${user ? `${user.name} (${id})` : id}`);
            } else if (id) {
                console.log('\nInvalid WhatsApp JID. Use format: phonenumber@s.whatsapp.net');
            }
            break;
        }
        case 'remove_wa': {
            if (waAdmins.length === 0) { console.log('\nNo WhatsApp admins configured.'); break; }
            const { userId } = await inquirer.prompt([
                { type: 'list', name: 'userId', message: 'Select WhatsApp admin to remove:', choices: waAdmins.map(id => ({ name: nameForId(id, 'whatsapp'), value: id })) }
            ]);
            saveAdminUsers(tgAdmins, dcAdmins, waAdmins.filter(id => id !== userId));
            console.log(`\nWhatsApp admin removed: ${nameForId(userId, 'whatsapp')}`);
            break;
        }
    }

    await waitKeyPress();
    return showAdminUsersMenu(ctx);
}
