import inquirer from 'inquirer';
import qrcode from 'qrcode-terminal';
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
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';
import { eventBus } from '../../core/EventBus';

/**
 * Toggle whether a channel is allowed to send messages autonomously.
 */
export function toggleAutonomyChannel(channel: string, context?: CliContext): void {
    const ctx = context ?? getCliContext();
    let allowedChannels = ctx.agent.config.get('autonomyAllowedChannels');
    if (!Array.isArray(allowedChannels)) allowedChannels = [];

    // Create a new array to ensure config.set detects the change
    let nextChannels: string[];
    if (allowedChannels.includes(channel)) {
        nextChannels = allowedChannels.filter(c => c !== channel);
    } else {
        nextChannels = [...allowedChannels, channel];
    }
    ctx.agent.config.set('autonomyAllowedChannels', nextChannels);
}

/**
 * Check if a channel is allowed to send messages autonomously.
 */
export function isAutonomyEnabledForChannel(channel: string, context?: CliContext): boolean {
    const ctx = context ?? getCliContext();
    const allowedChannels = ctx.agent.config.get('autonomyAllowedChannels');
    return Array.isArray(allowedChannels) && allowedChannels.includes(channel);
}

/**
 * Root Connections menu controller for all messaging channels.
 */
export async function showConnectionsMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Connections');

    const hasTelegram = !!agent.config.get('telegramToken');
    const hasWhatsapp = !!agent.config.get('whatsappEnabled');
    const hasDiscord = !!agent.config.get('discordToken');
    const hasSlack = !!agent.config.get('slackBotToken');
    const hasEmail = !!agent.config.get('emailEnabled');
    const tgAuto = agent.config.get('telegramAutoReplyEnabled');
    const waAuto = agent.config.get('whatsappAutoReplyEnabled');
    const dcAuto = agent.config.get('discordAutoReplyEnabled');
    const slAuto = agent.config.get('slackAutoReplyEnabled');
    const emAuto = agent.config.get('emailAutoReplyEnabled');

    console.log('');
    const channelLines = [
        `${statusDot(hasTelegram, '')} ${bold('Telegram')}    ${hasTelegram ? green('Connected') : gray('Not configured')}  ${tgAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasWhatsapp, '')} ${bold('WhatsApp')}    ${hasWhatsapp ? green('Enabled') : gray('Disabled')}        ${waAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasDiscord, '')} ${bold('Discord')}     ${hasDiscord ? green('Connected') : gray('Not configured')}  ${dcAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasSlack, '')} ${bold('Slack')}       ${hasSlack ? green('Connected') : gray('Not configured')}  ${slAuto ? dim('auto-reply ✓') : ''}`,
        `${statusDot(hasEmail, '')} ${bold('Email')}       ${hasEmail ? green('Enabled') : gray('Not configured')}  ${emAuto ? dim('auto-reply ✓') : ''}`,
    ];
    box(channelLines, { title: 'CHANNEL STATUS', width: 58 });
    console.log('');

    const { channel } = await inquirer.prompt([
        {
            type: 'list',
            name: 'channel',
            message: cyan('Select channel to configure:'),
            choices: [
                { name: `    ${bold('Telegram Bot')}      ${hasTelegram ? green('●') : gray('○')}`, value: 'telegram' },
                { name: `     ${bold('WhatsApp (Baileys)')} ${hasWhatsapp ? green('●') : gray('○')}`, value: 'whatsapp' },
                { name: `     ${bold('Discord Bot')}       ${hasDiscord ? green('●') : gray('○')}`, value: 'discord' },
                { name: `     ${bold('Slack Bot')}         ${hasSlack ? green('●') : gray('○')}`, value: 'slack' },
                { name: `     ${bold('Email (SMTP/IMAP)')}  ${hasEmail ? green('●') : gray('○')}`, value: 'email' },
                new inquirer.Separator(dim('  ─────────────────────────────────')),
                { name: dim('  ← Back'), value: 'back' },
            ]
        }
    ]);

    if (channel === 'back') return showMainMenu();

    if (channel === 'telegram') {
        await showTelegramConfig(ctx);
    } else if (channel === 'whatsapp') {
        await showWhatsAppConfig(ctx);
    } else if (channel === 'discord') {
        await showDiscordConfig(ctx);
    } else if (channel === 'slack') {
        await showSlackConfig(ctx);
    } else if (channel === 'email') {
        await showEmailConfig(ctx);
    }
}

export async function showTelegramConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentToken = agent.config.get('telegramToken') || 'Not Set';
    const autoReply = agent.config.get('telegramAutoReplyEnabled');
    const channelsEnabled = agent.config.get('telegramChannelsEnabled');
    const autonomyAllowed = isAutonomyEnabledForChannel('telegram', ctx);
    const groupsEnabled = agent.config.get('telegramGroupsEnabled');
    const groupPolicy = String(agent.config.get('telegramGroupPolicy') || 'mention_only');
    const allowedGroups = (agent.config.get('telegramAllowedGroups') || []) as string[];
    const blockedGroups = (agent.config.get('telegramBlockedGroups') || []) as string[];
    renderScreenHeader('Telegram Settings');
    console.log('');
    const groupPolicyLabel = groupPolicy === 'mention_only' ? yellow('MENTION ONLY') : groupPolicy === 'reply_only' ? yellow('REPLY TO BOT ONLY') : groupPolicy === 'allowlist' ? yellow('ALLOWLIST') : green('ALL MESSAGES');
    const tgLines = [
        `${dim('Token')}          ${currentToken === 'Not Set' ? gray('Not Set') : green(currentToken.substring(0, 12) + '…')}`,
        `${dim('Auto-Reply')}     ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Channel Posts')}  ${channelsEnabled ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Autonomy')}       ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
        ``,
        `${dim('Group Support')}  ${groupsEnabled ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Group Policy')}   ${groupsEnabled ? groupPolicyLabel : gray('n/a')}`,
        `${dim('Allowed Groups')} ${cyan(String(allowedGroups.length))}`,
        `${dim('Blocked Groups')} ${cyan(String(blockedGroups.length))}`,
    ];
    box(tgLines, { title: 'TELEGRAM', width: 46 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Telegram Options:',
            choices: [
                { name: 'Set Token', value: 'set' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: channelsEnabled ? 'Disable Channel Post Processing' : 'Enable Channel Post Processing', value: 'toggle_channels' },
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: groupsEnabled ? 'Disable Group Chat Support' : 'Enable Group Chat Support', value: 'toggle_groups' },
                { name: 'Manage Group Policy', value: 'manage_group_policy' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu(ctx);

    if (action === 'set') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Telegram Bot Token:' }
        ]);
        agent.config.set('telegramToken', token);
        console.log('Token updated! (Restart required for token changes)');
        await waitKeyPress();
        return showTelegramConfig(ctx);
    } else if (action === 'toggle_auto') {
        agent.config.set('telegramAutoReplyEnabled', !autoReply);
        return showTelegramConfig(ctx);
    } else if (action === 'toggle_channels') {
        agent.config.set('telegramChannelsEnabled', !channelsEnabled);
        return showTelegramConfig(ctx);
    } else if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('telegram', ctx);
        return showTelegramConfig(ctx);
    } else if (action === 'toggle_groups') {
        agent.config.set('telegramGroupsEnabled', !groupsEnabled);
        return showTelegramConfig(ctx);
    } else if (action === 'manage_group_policy') {
        const { groupPolicyAction } = await inquirer.prompt([
            {
                type: 'list',
                name: 'groupPolicyAction',
                message: 'Telegram Group Policy:',
                choices: [
                    { name: 'Mode: All group messages', value: 'mode_all' },
                    { name: 'Mode: Only when @mentioned', value: 'mode_mention_only' },
                    { name: 'Mode: Only replies to the bot', value: 'mode_reply_only' },
                    { name: 'Mode: Allowlisted groups only', value: 'mode_allowlist' },
                    new inquirer.Separator('── Allowed Groups ──'),
                    { name: `Add group to allowlist (${allowedGroups.length})`, value: 'group_allow_add' },
                    { name: `Remove group from allowlist (${allowedGroups.length})`, value: 'group_allow_remove' },
                    { name: 'Clear group allowlist', value: 'group_allow_clear' },
                    new inquirer.Separator('── Blocked Groups ──'),
                    { name: `Add group to blocklist (${blockedGroups.length})`, value: 'group_block_add' },
                    { name: `Remove group from blocklist (${blockedGroups.length})`, value: 'group_block_remove' },
                    { name: 'Clear group blocklist', value: 'group_block_clear' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (groupPolicyAction === 'mode_all') {
            agent.config.set('telegramGroupPolicy', 'all');
            console.log(green('Group policy set to: all messages'));
        } else if (groupPolicyAction === 'mode_mention_only') {
            agent.config.set('telegramGroupPolicy', 'mention_only');
            console.log(green('Group policy set to: mention only'));
        } else if (groupPolicyAction === 'mode_reply_only') {
            agent.config.set('telegramGroupPolicy', 'reply_only');
            console.log(green('Group policy set to: reply to bot only'));
        } else if (groupPolicyAction === 'mode_allowlist') {
            agent.config.set('telegramGroupPolicy', 'allowlist');
            console.log(green('Group policy set to: allowlist'));
        } else if (groupPolicyAction === 'group_allow_add') {
            const { gid } = await inquirer.prompt([{ type: 'input', name: 'gid', message: 'Enter Telegram group chat ID (negative number, e.g. -100123456):' }]);
            const norm = String(gid || '').trim();
            if (norm) {
                agent.config.set('telegramAllowedGroups', Array.from(new Set([...allowedGroups, norm])));
                console.log(green(`Added group to allowlist: ${norm}`));
            }
        } else if (groupPolicyAction === 'group_allow_remove') {
            if (allowedGroups.length > 0) {
                const { gid } = await inquirer.prompt([{ type: 'list', name: 'gid', message: 'Select group to remove from allowlist:', choices: allowedGroups }]);
                agent.config.set('telegramAllowedGroups', allowedGroups.filter(g => g !== gid));
            }
        } else if (groupPolicyAction === 'group_allow_clear') {
            agent.config.set('telegramAllowedGroups', []);
            console.log(yellow('Group allowlist cleared'));
        } else if (groupPolicyAction === 'group_block_add') {
            const { gid } = await inquirer.prompt([{ type: 'input', name: 'gid', message: 'Enter Telegram group chat ID to block:' }]);
            const norm = String(gid || '').trim();
            if (norm) {
                agent.config.set('telegramBlockedGroups', Array.from(new Set([...blockedGroups, norm])));
                console.log(yellow(`Added group to blocklist: ${norm}`));
            }
        } else if (groupPolicyAction === 'group_block_remove') {
            if (blockedGroups.length > 0) {
                const { gid } = await inquirer.prompt([{ type: 'list', name: 'gid', message: 'Select group to remove from blocklist:', choices: blockedGroups }]);
                agent.config.set('telegramBlockedGroups', blockedGroups.filter(g => g !== gid));
            }
        } else if (groupPolicyAction === 'group_block_clear') {
            agent.config.set('telegramBlockedGroups', []);
            console.log(yellow('Group blocklist cleared'));
        }

        await waitKeyPress();
        return showTelegramConfig(ctx);
    }
}

export async function showWhatsAppConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const enabled = agent.config.get('whatsappEnabled');
    const autoReply = agent.config.get('whatsappAutoReplyEnabled');
    const statusReply = agent.config.get('whatsappStatusReplyEnabled');
    const statusMediaMode = String(agent.config.get('whatsappStatusMediaMode') || 'off');
    const autoReact = agent.config.get('whatsappAutoReactEnabled');
    const contextProfiling = agent.config.get('whatsappContextProfilingEnabled');
    const contactAccessMode = String(agent.config.get('whatsappContactAccessMode') || 'all');
    const allowedContacts = (agent.config.get('whatsappAllowedContacts') || []) as string[];
    const blockedContacts = (agent.config.get('whatsappBlockedContacts') || []) as string[];
    const groupsEnabled = agent.config.get('whatsappGroupsEnabled');
    const groupPolicy = String(agent.config.get('whatsappGroupPolicy') || 'mention_only');
    const allowedGroups = (agent.config.get('whatsappAllowedGroups') || []) as string[];
    const blockedGroups = (agent.config.get('whatsappBlockedGroups') || []) as string[];
    const ownerJid = agent.config.get('whatsappOwnerJID') || 'Not Linked';
    const autonomyAllowed = isAutonomyEnabledForChannel('whatsapp', ctx);

    renderScreenHeader('WhatsApp Settings');
    console.log('');
    const onOff = (v: any) => v ? green(bold('● ON')) : gray('○ OFF');
    const groupPolicyLabel = groupPolicy === 'mention_only' ? yellow('MENTION ONLY') : groupPolicy === 'owner_only' ? yellow('OWNER ONLY') : groupPolicy === 'allowlist' ? yellow('ALLOWLIST') : green('ALL MESSAGES');
    const statusMediaLabel = statusMediaMode === 'download_and_analyze' ? green('DOWNLOAD + ANALYZE') : statusMediaMode === 'download_only' ? yellow('DOWNLOAD ONLY') : gray('OFF');
    const waLines = [
        `${dim('Status')}            ${enabled ? green(bold('ENABLED')) : red(bold('DISABLED'))}`,
        `${dim('Linked Account')}    ${ownerJid === 'Not Linked' ? gray(ownerJid) : cyan(ownerJid)}`,
        `${dim('Autonomy')}          ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
        `${dim('Contact Policy')}    ${contactAccessMode === 'allowlist' ? yellow('ALLOWLIST ONLY') : contactAccessMode === 'blocklist' ? yellow('BLOCKLIST') : green('ALL CONTACTS')}`,
        `${dim('Allowed Contacts')}  ${cyan(String(allowedContacts.length))}`,
        `${dim('Blocked Contacts')}  ${cyan(String(blockedContacts.length))}`,
        ``,
        `${dim('Group Support')}     ${groupsEnabled ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Group Policy')}      ${groupsEnabled ? groupPolicyLabel : gray('n/a')}`,
        `${dim('Allowed Groups')}    ${cyan(String(allowedGroups.length))}`,
        `${dim('Blocked Groups')}    ${cyan(String(blockedGroups.length))}`,
        ``,
        `${dim('Auto-Reply (1‑on‑1)')}  ${onOff(autoReply)}`,
        `${dim('Status Interactions')}  ${onOff(statusReply)}`,
        `${dim('Status Media Mode')}    ${statusReply ? statusMediaLabel : gray('n/a (status off)')}`,
        `${dim('Auto-React (Emojis)')}  ${onOff(autoReact)}`,
        `${dim('Context Profiling')}    ${onOff(contextProfiling)}`,
    ];
    box(waLines, { title: 'WHATSAPP', width: 48 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'WhatsApp Options:',
            choices: [
                { name: enabled ? 'Disable WhatsApp' : 'Enable WhatsApp', value: 'toggle_enabled' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: statusReply ? 'Disable Status Interactions' : 'Enable Status Interactions', value: 'toggle_status' },
                { name: 'Manage Status Media Processing', value: 'manage_status_media' },
                { name: autoReact ? 'Disable Auto-React' : 'Enable Auto-React', value: 'toggle_react' },
                { name: contextProfiling ? 'Disable Context Profiling' : 'Enable Context Profiling', value: 'toggle_profile' },
                { name: 'Manage Contact Filter Policy', value: 'manage_contact_policy' },
                { name: groupsEnabled ? 'Disable Group Chat Support' : 'Enable Group Chat Support', value: 'toggle_groups' },
                { name: 'Manage Group Policy', value: 'manage_group_policy' },
                { name: 'Run Context Profiling (Batch)', value: 'trigger_profiling' },
                { name: 'Link Account / Show QR', value: 'link' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu(ctx);

    switch (action) {
        case 'toggle_enabled':
            agent.config.set('whatsappEnabled', !enabled);
            break;
        case 'toggle_auto':
            agent.config.set('whatsappAutoReplyEnabled', !autoReply);
            break;
        case 'toggle_autonomy':
            toggleAutonomyChannel('whatsapp', ctx);
            break;
        case 'toggle_status':
            agent.config.set('whatsappStatusReplyEnabled', !statusReply);
            break;
        case 'manage_status_media': {
            const { mode } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'mode',
                    message: 'Status Media Processing Mode:',
                    choices: [
                        { name: 'Off (ignore status media)', value: 'off' },
                        { name: 'Download only (no AI analysis)', value: 'download_only' },
                        { name: 'Download + analyze (audio/image/video/doc)', value: 'download_and_analyze' }
                    ],
                    default: statusMediaMode
                }
            ]);
            agent.config.set('whatsappStatusMediaMode', mode);
            break;
        }
        case 'toggle_react':
            agent.config.set('whatsappAutoReactEnabled', !autoReact);
            break;
        case 'toggle_profile':
            agent.config.set('whatsappContextProfilingEnabled', !contextProfiling);
            break;
        case 'manage_contact_policy': {
            const normalizeJid = (input: string): string => {
                let id = String(input || '').trim();
                if (!id) return '';
                if (!id.includes('@')) id = `${id}@s.whatsapp.net`;
                return id;
            };

            const knownContacts = agent.whatsapp?.getRecentContacts() || [];
            const pickContactFromKnown = async (message: string): Promise<string | null> => {
                if (knownContacts.length === 0) return null;
                const { pick } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'pick',
                        message,
                        choices: [
                            ...knownContacts.slice(0, 150).map((c: any) => ({ name: `${c.name} (${c.jid})`, value: c.jid })),
                            { name: 'Enter JID manually', value: '__manual__' },
                            { name: 'Cancel', value: '__cancel__' }
                        ]
                    }
                ]);
                if (pick === '__cancel__') return null;
                if (pick !== '__manual__') return pick;
                const { manual } = await inquirer.prompt([{ type: 'input', name: 'manual', message: 'Enter WhatsApp JID or phone number:' }]);
                return normalizeJid(manual);
            };

            const promptManual = async (message: string): Promise<string | null> => {
                const { jid } = await inquirer.prompt([{ type: 'input', name: 'jid', message }]);
                const normalized = normalizeJid(jid);
                return normalized || null;
            };

            const { policyAction } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'policyAction',
                    message: 'Contact Filter Policy:',
                    choices: [
                        { name: 'Mode: Allow all contacts', value: 'mode_all' },
                        { name: 'Mode: Reply only to allowlist', value: 'mode_allowlist' },
                        { name: 'Mode: Block listed contacts', value: 'mode_blocklist' },
                        new inquirer.Separator('── Allowlist ──'),
                        { name: `Add to allowlist (${allowedContacts.length})`, value: 'allow_add' },
                        { name: `Remove from allowlist (${allowedContacts.length})`, value: 'allow_remove' },
                        { name: 'Clear allowlist', value: 'allow_clear' },
                        new inquirer.Separator('── Blocklist ──'),
                        { name: `Add to blocklist (${blockedContacts.length})`, value: 'block_add' },
                        { name: `Remove from blocklist (${blockedContacts.length})`, value: 'block_remove' },
                        { name: 'Clear blocklist', value: 'block_clear' },
                        { name: 'Back', value: 'back' }
                    ]
                }
            ]);

            if (policyAction === 'mode_all') {
                agent.config.set('whatsappContactAccessMode', 'all');
            } else if (policyAction === 'mode_allowlist') {
                agent.config.set('whatsappContactAccessMode', 'allowlist');
            } else if (policyAction === 'mode_blocklist') {
                agent.config.set('whatsappContactAccessMode', 'blocklist');
            } else if (policyAction === 'allow_add') {
                const picked = (await pickContactFromKnown('Pick contact to allow')) || (await promptManual('Enter contact to allow:'));
                if (picked) {
                    const next = Array.from(new Set([...(allowedContacts || []), picked]));
                    agent.config.set('whatsappAllowedContacts', next);
                    console.log(green(`Added to allowlist: ${picked}`));
                }
            } else if (policyAction === 'allow_remove') {
                if (allowedContacts.length > 0) {
                    const { jid } = await inquirer.prompt([{ type: 'list', name: 'jid', message: 'Select allowlist contact to remove:', choices: allowedContacts }]);
                    agent.config.set('whatsappAllowedContacts', allowedContacts.filter((j: string) => j !== jid));
                }
            } else if (policyAction === 'allow_clear') {
                agent.config.set('whatsappAllowedContacts', []);
            } else if (policyAction === 'block_add') {
                const picked = (await pickContactFromKnown('Pick contact to block')) || (await promptManual('Enter contact to block:'));
                if (picked) {
                    const next = Array.from(new Set([...(blockedContacts || []), picked]));
                    agent.config.set('whatsappBlockedContacts', next);
                    console.log(yellow(`Added to blocklist: ${picked}`));
                }
            } else if (policyAction === 'block_remove') {
                if (blockedContacts.length > 0) {
                    const { jid } = await inquirer.prompt([{ type: 'list', name: 'jid', message: 'Select blocklist contact to remove:', choices: blockedContacts }]);
                    agent.config.set('whatsappBlockedContacts', blockedContacts.filter((j: string) => j !== jid));
                }
            } else if (policyAction === 'block_clear') {
                agent.config.set('whatsappBlockedContacts', []);
            }
            break;
        }
        case 'toggle_groups':
            agent.config.set('whatsappGroupsEnabled', !groupsEnabled);
            break;
        case 'manage_group_policy': {
            const normalizeGroupJid = (input: string): string => {
                let id = String(input || '').trim();
                if (!id) return '';
                if (!id.includes('@')) id = `${id}@g.us`;
                return id;
            };

            const { groupPolicyAction } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'groupPolicyAction',
                    message: 'Group Policy:',
                    choices: [
                        { name: 'Mode: All group messages', value: 'mode_all' },
                        { name: 'Mode: Only when @mentioned', value: 'mode_mention_only' },
                        { name: 'Mode: Only messages from owner', value: 'mode_owner_only' },
                        { name: 'Mode: Allowlisted groups only', value: 'mode_allowlist' },
                        new inquirer.Separator('── Allowed Groups ──'),
                        { name: `Add group to allowlist (${allowedGroups.length})`, value: 'group_allow_add' },
                        { name: `Remove group from allowlist (${allowedGroups.length})`, value: 'group_allow_remove' },
                        { name: 'Clear group allowlist', value: 'group_allow_clear' },
                        new inquirer.Separator('── Blocked Groups ──'),
                        { name: `Add group to blocklist (${blockedGroups.length})`, value: 'group_block_add' },
                        { name: `Remove group from blocklist (${blockedGroups.length})`, value: 'group_block_remove' },
                        { name: 'Clear group blocklist', value: 'group_block_clear' },
                        { name: 'Back', value: 'back' }
                    ]
                }
            ]);

            if (groupPolicyAction === 'mode_all') {
                agent.config.set('whatsappGroupPolicy', 'all');
                console.log(green('Group policy set to: all messages'));
            } else if (groupPolicyAction === 'mode_mention_only') {
                agent.config.set('whatsappGroupPolicy', 'mention_only');
                console.log(green('Group policy set to: mention only'));
            } else if (groupPolicyAction === 'mode_owner_only') {
                agent.config.set('whatsappGroupPolicy', 'owner_only');
                console.log(green('Group policy set to: owner only'));
            } else if (groupPolicyAction === 'mode_allowlist') {
                agent.config.set('whatsappGroupPolicy', 'allowlist');
                console.log(green('Group policy set to: allowlist'));
            } else if (groupPolicyAction === 'group_allow_add') {
                const { gid } = await inquirer.prompt([{ type: 'input', name: 'gid', message: 'Enter group JID or ID (e.g. 12345678@g.us):' }]);
                const norm = normalizeGroupJid(gid);
                if (norm) {
                    agent.config.set('whatsappAllowedGroups', Array.from(new Set([...allowedGroups, norm])));
                    console.log(green(`Added group to allowlist: ${norm}`));
                }
            } else if (groupPolicyAction === 'group_allow_remove') {
                if (allowedGroups.length > 0) {
                    const { gid } = await inquirer.prompt([{ type: 'list', name: 'gid', message: 'Select group to remove from allowlist:', choices: allowedGroups }]);
                    agent.config.set('whatsappAllowedGroups', allowedGroups.filter((g: string) => g !== gid));
                }
            } else if (groupPolicyAction === 'group_allow_clear') {
                agent.config.set('whatsappAllowedGroups', []);
                console.log(yellow('Group allowlist cleared'));
            } else if (groupPolicyAction === 'group_block_add') {
                const { gid } = await inquirer.prompt([{ type: 'input', name: 'gid', message: 'Enter group JID or ID to block:' }]);
                const norm = normalizeGroupJid(gid);
                if (norm) {
                    agent.config.set('whatsappBlockedGroups', Array.from(new Set([...blockedGroups, norm])));
                    console.log(yellow(`Added group to blocklist: ${norm}`));
                }
            } else if (groupPolicyAction === 'group_block_remove') {
                if (blockedGroups.length > 0) {
                    const { gid } = await inquirer.prompt([{ type: 'list', name: 'gid', message: 'Select group to remove from blocklist:', choices: blockedGroups }]);
                    agent.config.set('whatsappBlockedGroups', blockedGroups.filter((g: string) => g !== gid));
                }
            } else if (groupPolicyAction === 'group_block_clear') {
                agent.config.set('whatsappBlockedGroups', []);
                console.log(yellow('Group blocklist cleared'));
            }
            break;
        }
        case 'trigger_profiling': {
            if (!agent.whatsapp) {
                console.log(red('\nWhatsApp is not connected.'));
                await waitKeyPress();
                break;
            }

            const contacts = agent.whatsapp.getRecentContacts();
            if (contacts.length === 0) {
                console.log(yellow('\nNo recent contacts found to profile.'));
                await waitKeyPress();
                break;
            }

            const duration = agent.estimateProfilingDuration(contacts.length);

            console.log('\n' + c.bgYellow + c.black + '   HEAVY TASK WARNING ' + c.reset);
            console.log(yellow('Context profiling reads past chat history and uses AI to build relationship context.'));
            console.log(`${dim('contacts:')}      ${contacts.length}`);
            console.log(`${dim('estimated duration:')} ~${duration} minutes`);
            console.log(dim('costs: LLM tokens will be consumed for each contact.'));
            console.log('');

            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: 'Do you want to proceed with profiling?', default: false }
            ]);

            if (!confirm) break;

            console.log('\n' + cyan('Starting context profiling...'));

            // Progress bar helper (simple)
            const updateProgress = (processed: number, total: number, name: string) => {
                const percent = Math.round((processed / total) * 100);
                const barWidth = 20;
                const filled = Math.round((processed / total) * barWidth);
                const empty = barWidth - filled;
                const bar = '█'.repeat(filled) + '░'.repeat(empty);
                process.stdout.write(`\r[${bar}] ${percent}% | Analyzing: ${name.substring(0, 20).padEnd(20)}`);
            };

            const result = await agent.profileWhatsAppHistory(contacts, 20, updateProgress);

            process.stdout.write('\r' + ' '.repeat(70) + '\r'); // Clear progress line
            console.log(green(`\n\nProfiling complete! ${result.updated} contacts updated.`));
            await waitKeyPress();
            break;
        }
        case 'link':
            if (!agent.whatsapp) {
                console.log('\nEnabling WhatsApp channel...');
                agent.config.set('whatsappEnabled', true);
                agent.setupChannels();
            }

            console.log('\nStarting WhatsApp pairing process...');

            // Listener for QR events
            const qrListener = (qr: string) => {
                console.clear();
                console.log('OrcBot WhatsApp Pairing');
                console.log('-------------------------------------------');
                console.log('Scan this QR code with your WhatsApp app:');
                console.log('1. Open WhatsApp on your phone');
                console.log('2. Tap Menu or Settings and select Linked Devices');
                console.log('3. Tap on "Link a Device"');
                console.log('-------------------------------------------');
                qrcode.generate(qr, { small: true });
                console.log('-------------------------------------------');
                console.log('Waiting for scan...');
            };

            eventBus.on('whatsapp:qr', qrListener);

            // Start/Restart pairing
            await agent.whatsapp.start();

            // Wait for connected status
            await new Promise<void>((resolve) => {
                const statusListener = (status: string) => {
                    if (status === 'connected') {
                        eventBus.off('whatsapp:qr', qrListener);
                        eventBus.off('whatsapp:status', statusListener);
                        resolve();
                    }
                };
                eventBus.on('whatsapp:status', statusListener);
            });

            console.log('\nWhatsApp Linked Successfully!');
            await waitKeyPress();
            break;
    }

    console.log('WhatsApp settings updated!');
    await waitKeyPress();
    return showWhatsAppConfig(ctx);
}

export async function showSlackConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentToken = agent.config.get('slackBotToken') || 'Not Set';
    const currentAppToken = agent.config.get('slackAppToken') || 'Not Set';
    const currentSigningSecret = agent.config.get('slackSigningSecret') || 'Not Set';
    const autoReply = agent.config.get('slackAutoReplyEnabled');
    const autonomyAllowed = isAutonomyEnabledForChannel('slack', ctx);
    renderScreenHeader('Slack Settings');
    console.log('');
    const slLines = [
        `${dim('Bot Token')}   ${currentToken === 'Not Set' ? gray('Not Set') : green(currentToken.substring(0, 8) + '…' + currentToken.slice(-4))}`,
        `${dim('App Token')}   ${currentAppToken === 'Not Set' ? gray('Not Set') : green(currentAppToken.substring(0, 8) + '…' + currentAppToken.slice(-4))}`,
        `${dim('Signing Secret')} ${currentSigningSecret === 'Not Set' ? gray('Not Set') : green(currentSigningSecret.substring(0, 6) + '…' + currentSigningSecret.slice(-4))}`,
        `${dim('Auto-Reply')}  ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Autonomy')}    ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
    ];
    box(slLines, { title: 'SLACK', width: 46 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Slack Options:',
            choices: [
                { name: 'Set Bot Token (xoxb-...)', value: 'set_token' },
                { name: 'Set App Token (xapp-...)', value: 'set_app_token' },
                { name: 'Set Signing Secret', value: 'set_secret' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu(ctx);

    if (action === 'set_token') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Slack Bot Token (xoxb-...):' }
        ]);
        agent.config.set('slackBotToken', token);
        console.log('Bot token updated! (Restart required)');
        await waitKeyPress();
        return showSlackConfig(ctx);
    } else if (action === 'set_app_token') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Slack App-Level Token (xapp-...):' }
        ]);
        agent.config.set('slackAppToken', token);
        console.log('App token updated! (Restart required)');
        await waitKeyPress();
        return showSlackConfig(ctx);
    } else if (action === 'set_secret') {
        const { secret } = await inquirer.prompt([
            { type: 'input', name: 'secret', message: 'Enter Slack Signing Secret:' }
        ]);
        agent.config.set('slackSigningSecret', secret);
        console.log('Signing secret updated! (Restart required)');
        await waitKeyPress();
        return showSlackConfig(ctx);
    } else if (action === 'toggle_auto') {
        agent.config.set('slackAutoReplyEnabled', !autoReply);
        return showSlackConfig(ctx);
    } else if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('slack', ctx);
        return showSlackConfig(ctx);
    }
}

export async function showEmailConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const enabled = agent.config.get('emailEnabled') === true;
    const autoReply = agent.config.get('emailAutoReplyEnabled') === true;
    const processUnreadOnStart = agent.config.get('emailProcessUnreadOnStart') === true;
    const emailAddress = agent.config.get('emailAddress') || agent.config.get('smtpUsername') || 'Not Set';
    const smtpHost = agent.config.get('smtpHost') || 'Not Set';
    const imapHost = agent.config.get('imapHost') || 'Not Set';
    const smtpSecure = agent.config.get('smtpSecure') === true;
    const smtpStartTls = agent.config.get('smtpStartTls') !== false;
    const imapSecure = agent.config.get('imapSecure') !== false;
    const imapStartTls = agent.config.get('imapStartTls') !== false;
    const timeoutMs = Number(agent.config.get('emailSocketTimeoutMs') || 15000);
    const autonomyAllowed = isAutonomyEnabledForChannel('email', ctx);

    renderScreenHeader('Email Settings');
    console.log('');
    const lines = [
        `${dim('Enabled')}      ${enabled ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Address')}      ${emailAddress === 'Not Set' ? gray('Not Set') : green(emailAddress)}`,
        `${dim('Autonomy')}     ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
        `${dim('SMTP')}         ${smtpHost}`,
        `${dim('IMAP')}         ${imapHost}`,
        `${dim('SMTP Security')} ${smtpSecure ? green('Direct TLS (SMTPS)') : (smtpStartTls ? green('STARTTLS') : yellow('Plain (not recommended)'))}`,
        `${dim('IMAP Security')} ${imapSecure ? green('Direct TLS (IMAPS)') : (imapStartTls ? green('STARTTLS') : yellow('Plain (not recommended)'))}`,
        `${dim('Socket Timeout')} ${timeoutMs}ms`,
        `${dim('Auto-Reply')}   ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Startup Inbox')} ${processUnreadOnStart ? yellow('Process existing unread') : green('Ignore existing unread')}`,
    ];
    box(lines, { title: 'EMAIL', width: 58 });
    console.log(dim('SMTP = sending outbound mail.'));
    console.log(dim('IMAP = reading inbound inbox (auto-reply/tasks). Not required for SMTP-only sending/tests.'));
    console.log(dim('Default: OrcBot ignores unread backlog on connect and only processes new inbound mail.'));
    console.log(dim('Enable startup backlog processing only if you intentionally want the agent to catch up on old unread mail.'));
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Email Options:',
            choices: [
                { name: enabled ? 'Disable Email Channel' : 'Enable Email Channel', value: 'toggle_enabled' },
                { name: 'Set Email Address', value: 'set_email' },
                { name: 'Set SMTP Settings', value: 'set_smtp' },
                { name: 'Set IMAP Settings', value: 'set_imap' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: processUnreadOnStart ? 'Disable Startup Backlog Processing' : 'Enable Startup Backlog Processing', value: 'toggle_startup_backlog' },
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: 'Test SMTP Connection', value: 'test_smtp' },
                { name: 'Test IMAP Connection', value: 'test_imap' },
                { name: 'Test SMTP + IMAP Connection', value: 'test' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu(ctx);

    if (action === 'toggle_enabled') {
        const next = !enabled;
        agent.config.set('emailEnabled', next);
        if (next && !agent.email) {
            agent.setupChannels();
        }
        return showEmailConfig(ctx);
    }

    if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('email', ctx);
        return showEmailConfig(ctx);
    }

    if (action === 'set_email') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'emailAddress', message: 'Email Address (From):', default: agent.config.get('emailAddress') || '' },
            { type: 'input', name: 'emailFromName', message: 'From Name:', default: agent.config.get('emailFromName') || agent.config.get('agentName') || 'OrcBot' },
            { type: 'input', name: 'emailDefaultSubject', message: 'Default Subject:', default: agent.config.get('emailDefaultSubject') || 'OrcBot response' },
            { type: 'number', name: 'emailSocketTimeoutMs', message: 'Socket Timeout (ms):', default: agent.config.get('emailSocketTimeoutMs') || 15000 },
        ]);
        agent.config.set('emailAddress', ans.emailAddress);
        agent.config.set('emailFromName', ans.emailFromName);
        agent.config.set('emailDefaultSubject', ans.emailDefaultSubject);
        agent.config.set('emailSocketTimeoutMs', Math.max(3000, Number(ans.emailSocketTimeoutMs) || 15000));
        return showEmailConfig(ctx);
    }

    if (action === 'set_smtp') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'smtpHost', message: 'SMTP Host:', default: agent.config.get('smtpHost') || '' },
            { type: 'number', name: 'smtpPort', message: 'SMTP Port:', default: agent.config.get('smtpPort') || 587 },
            { type: 'confirm', name: 'smtpSecure', message: 'Use TLS (SMTPS)?', default: agent.config.get('smtpSecure') === true },
            { type: 'confirm', name: 'smtpStartTls', message: 'Use STARTTLS upgrade (recommended for port 587)?', default: agent.config.get('smtpStartTls') !== false, when: (a) => !a.smtpSecure },
            { type: 'input', name: 'smtpUsername', message: 'SMTP Username:', default: agent.config.get('smtpUsername') || '' },
            { type: 'password', name: 'smtpPassword', message: 'SMTP Password (leave blank to keep current):' },
        ]);
        agent.config.set('smtpHost', ans.smtpHost);
        agent.config.set('smtpPort', Number(ans.smtpPort) || 587);
        agent.config.set('smtpSecure', !!ans.smtpSecure);
        if (!ans.smtpSecure) agent.config.set('smtpStartTls', ans.smtpStartTls !== false);
        agent.config.set('smtpUsername', ans.smtpUsername);
        if (ans.smtpPassword) agent.config.set('smtpPassword', ans.smtpPassword);
        return showEmailConfig(ctx);
    }

    if (action === 'set_imap') {
        const ans = await inquirer.prompt([
            { type: 'input', name: 'imapHost', message: 'IMAP Host:', default: agent.config.get('imapHost') || '' },
            { type: 'number', name: 'imapPort', message: 'IMAP Port:', default: agent.config.get('imapPort') || 993 },
            { type: 'confirm', name: 'imapSecure', message: 'Use TLS (IMAPS)?', default: agent.config.get('imapSecure') !== false },
            { type: 'confirm', name: 'imapStartTls', message: 'Use STARTTLS upgrade (recommended for port 143)?', default: agent.config.get('imapStartTls') !== false, when: (a) => !a.imapSecure },
            { type: 'input', name: 'imapUsername', message: 'IMAP Username:', default: agent.config.get('imapUsername') || '' },
            { type: 'password', name: 'imapPassword', message: 'IMAP Password (leave blank to keep current):' },
        ]);
        agent.config.set('imapHost', ans.imapHost);
        agent.config.set('imapPort', Number(ans.imapPort) || 993);
        agent.config.set('imapSecure', !!ans.imapSecure);
        if (!ans.imapSecure) agent.config.set('imapStartTls', ans.imapStartTls !== false);
        agent.config.set('imapUsername', ans.imapUsername);
        if (ans.imapPassword) agent.config.set('imapPassword', ans.imapPassword);
        return showEmailConfig(ctx);
    }

    if (action === 'toggle_auto') {
        agent.config.set('emailAutoReplyEnabled', !autoReply);
        return showEmailConfig(ctx);
    }

    if (action === 'toggle_startup_backlog') {
        agent.config.set('emailProcessUnreadOnStart', !processUnreadOnStart);
        return showEmailConfig(ctx);
    }

    if (action === 'test_smtp' || action === 'test_imap' || action === 'test') {
        if (!agent.email) {
            agent.setupChannels();
        }
        if (!agent.email) {
            console.log('Email channel not available. Configure SMTP/IMAP credentials first.');
        } else {
            const label = action === 'test_smtp' ? 'SMTP' : action === 'test_imap' ? 'IMAP' : 'SMTP + IMAP';
            console.log(`Testing Email ${label}...`);
            try {
                if (action === 'test_smtp') {
                    await agent.email.testSmtpConnection();
                    console.log(green('  ✓ SMTP connection test successful (outbound send).'));
                } else if (action === 'test_imap') {
                    await agent.email.testImapConnection();
                    console.log(green('  ✓ IMAP connection test successful (inbox access).'));
                } else {
                    await agent.email.testConnections();
                    console.log(green('  ✓ Email connection test successful (SMTP send + IMAP access).'));
                }
            } catch (error: any) {
                console.log(red(`  ✗ ${label} connection test failed: ${error.message}`));
            }
        }
        await waitKeyPress();
        return showEmailConfig(ctx);
    }
}

export async function showDiscordConfig(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    const currentToken = agent.config.get('discordToken') || 'Not Set';
    const autoReply = agent.config.get('discordAutoReplyEnabled');
    const autonomyAllowed = isAutonomyEnabledForChannel('discord', ctx);
    renderScreenHeader('Discord Settings');
    console.log('');
    const dcLines = [
        `${dim('Token')}       ${currentToken === 'Not Set' ? gray('Not Set') : green('***' + currentToken.slice(-8))}`,
        `${dim('Auto-Reply')}  ${autoReply ? green(bold('● ON')) : gray('○ OFF')}`,
        `${dim('Autonomy')}    ${autonomyAllowed ? green(bold('● ENABLED')) : gray('○ DISABLED')}`,
    ];
    box(dcLines, { title: 'DISCORD', width: 46 });
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Discord Options:',
            choices: [
                { name: 'Set Bot Token', value: 'set' },
                { name: autoReply ? 'Disable Auto-Reply' : 'Enable Auto-Reply', value: 'toggle_auto' },
                { name: autonomyAllowed ? 'Disable Autonomous Messaging' : 'Enable Autonomous Messaging', value: 'toggle_autonomy' },
                { name: 'Test Connection', value: 'test' },
                { name: 'Back', value: 'back' }
            ]
        }
    ]);

    if (action === 'back') return showConnectionsMenu(ctx);

    if (action === 'set') {
        const { token } = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'Enter Discord Bot Token:' }
        ]);
        agent.config.set('discordToken', token);
        console.log('Token updated! (Restart required for token changes)');
        await waitKeyPress();
        return showDiscordConfig(ctx);
    } else if (action === 'toggle_auto') {
        agent.config.set('discordAutoReplyEnabled', !autoReply);
        return showDiscordConfig(ctx);
    } else if (action === 'toggle_autonomy') {
        toggleAutonomyChannel('discord', ctx);
        return showDiscordConfig(ctx);
    } else if (action === 'test') {
        if (!agent.discord) {
            console.log('Discord channel not initialized. Please set a token and restart.');
        } else {
            console.log('Testing Discord connection...');
            try {
                const guilds = await agent.discord.getGuilds();
                console.log(`Connected! Bot is in ${guilds.length} server(s):`);
                guilds.forEach((g: any) => console.log(`  - ${g.name} (${g.id})`));
            } catch (error: any) {
                console.log(`Connection test failed: ${error.message}`);
            }
        }
        await waitKeyPress();
        return showDiscordConfig(ctx);
    }
}
