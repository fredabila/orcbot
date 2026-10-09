import fs from 'fs';
import path from 'path';
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
    waitKeyPress,
    brightCyan,
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';

/**
 * Fetch and display skills from the community vault (github.com/fredabila/orcbot-skills).
 */
export async function showCommunitySkillsMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent } = ctx;

    renderScreenHeader('Community Skills');
    console.log(gray('  Fetching latest skills from fredabila/orcbot-skills...'));

    try {
        const repoUrl = 'https://github.com/fredabila/orcbot-skills';
        const apiUrl = 'https://api.github.com/repos/fredabila/orcbot-skills/contents/skills';

        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'OrcBot-CLI' }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const items = await response.json() as any[];
        const skills = items.filter(item => item.type === 'dir').map(item => item.name);

        if (skills.length === 0) {
            console.log(yellow('\n  No skills found in the community repository.'));
            await waitKeyPress();
            return;
        }

        console.log(dim(`\n  Found ${skills.length} community skills in the vault:\n`));

        const choices: any[] = skills.map(name => ({
            name: `   ${bold(name)}`,
            value: name
        }));
        choices.push(new inquirer.Separator(dim('  ──────────────────────────────────')));
        choices.push({ name: dim('  ← Back'), value: 'back' });

        const { selection } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selection',
                message: 'Select a community skill:',
                choices,
                pageSize: 15
            }
        ]);

        if (selection === 'back') return;

        const skillName = selection;
        const skillUrl = `${repoUrl}/tree/main/skills/${skillName}`;
        const rawSkillUrl = `https://raw.githubusercontent.com/fredabila/orcbot-skills/main/skills/${skillName}/SKILL.md`;

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Skill: ${bold(skillName)}`,
                choices: [
                    { name: `   ${bold('View Details')} ${dim('(Description & Requirements)')}`, value: 'view' },
                    { name: `   ${bold('Install Skill')} ${dim('to this OrcBot')}`, value: 'install' },
                    new inquirer.Separator(),
                    { name: dim('  ← Back to list'), value: 'back' }
                ]
            }
        ]);

        if (action === 'back') return showCommunitySkillsMenu(ctx);

        if (action === 'view') {
            console.log(gray('\n  Fetching skill details...'));
            try {
                const res = await fetch(rawSkillUrl);
                if (!res.ok) throw new Error(`Could not fetch SKILL.md (${res.status})`);
                const content = await res.text();
                const parsed = agent.skills.parseSkillMd(content);

                if (parsed) {
                    renderScreenHeader(`Skill: ${skillName}`);

                    console.log(`\n  ${bold('Description:')}`);
                    console.log(`  ${parsed.meta.description}\n`);

                    if (parsed.meta.orcbot?.triggerPatterns) {
                        console.log(`  ${bold('Auto-Activation Patterns:')}`);
                        parsed.meta.orcbot.triggerPatterns.forEach((p: string) => console.log(`  - ${dim(p)}`));
                        console.log('');
                    }

                    if (parsed.meta.allowedTools) {
                        const tools = Array.isArray(parsed.meta.allowedTools) ? parsed.meta.allowedTools : [parsed.meta.allowedTools];
                        console.log(`  ${bold('Allowed Tools:')}`);
                        tools.forEach((t: string) => console.log(`  - ${dim(t)}`));
                        console.log('');
                    }

                    if (parsed.meta.metadata) {
                        console.log(`  ${bold('Metadata:')}`);
                        Object.entries(parsed.meta.metadata).forEach(([k, v]) => console.log(`  - ${k}: ${dim(String(v))}`));
                        console.log('');
                    }

                    const { proceed } = await inquirer.prompt([
                        { type: 'confirm', name: 'proceed', message: 'Install this skill now?', default: true }
                    ]);
                    if (!proceed) return showCommunitySkillsMenu(ctx);
                } else {
                    console.log(yellow('\n  This skill uses a loose format. Full content:'));
                    console.log(dim(content.split('\n').slice(0, 10).join('\n') + '...'));
                    const { proceed } = await inquirer.prompt([
                        { type: 'confirm', name: 'proceed', message: 'Install anyway?', default: true }
                    ]);
                    if (!proceed) return showCommunitySkillsMenu(ctx);
                }
            } catch (e: any) {
                console.log(red(`\n  Failed to load preview: ${e.message}`));
                await waitKeyPress();
                return showCommunitySkillsMenu(ctx);
            }
        }

        console.log(`\nInstalling "${skillName}" from community vault...`);
        const result = await agent.skills.installSkillFromUrl(skillUrl);

        if (result.success) {
            console.log(green(`\n${result.message}`));
        } else {
            console.log(red(`\n${result.message}`));
        }
        await waitKeyPress();

    } catch (e: any) {
        console.log(red(`\nFailed to fetch community skills: ${e.message}`));
        console.log(dim(`   You can manually install from: https://github.com/fredabila/orcbot-skills`));
        await waitKeyPress();
    }
}

/**
 * Skills Manager screen controller.
 */
export async function showSkillsMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Skills Manager');

    const skills = agent.skills.getAllSkills();
    const agentSkills = agent.skills.getAgentSkills();
    const pluginSkills = skills.filter((s: any) => s.pluginPath);
    const coreSkills = skills.filter((s: any) => !s.pluginPath);

    const activeCount = agentSkills.filter((s: any) => s.activated).length;
    console.log('');
    const summaryLines = [
        `${dim('Agent Skills')}   ${brightCyan(bold(String(agentSkills.length)))} installed  ${green(bold(String(activeCount)))} active`,
        `${dim('Plugins')}        ${cyan(bold(String(pluginSkills.length)))} loaded`,
        `${dim('Core Built-in')}  ${gray(bold(String(coreSkills.length)))} available`,
    ];
    box(summaryLines, { title: 'SKILL INVENTORY', width: 52 });
    console.log('');

    const choices: any[] = [];

    if (agentSkills.length > 0) {
        choices.push(new inquirer.Separator(dim('  ─── Agent Skills (SKILL.md) ──────')));
        for (const s of agentSkills) {
            const badge = s.activated ? green('● ') : gray('○ ');
            choices.push({
                name: `  ${badge}${bold(s.meta.name)} ${dim('— ' + s.meta.description.slice(0, 50) + (s.meta.description.length > 50 ? '…' : ''))}`,
                value: `agent:${s.meta.name}`
            });
        }
    }

    if (pluginSkills.length > 0) {
        choices.push(new inquirer.Separator(dim('  ─── Plugins (.ts/.js) ────────────')));
        for (const s of pluginSkills) {
            choices.push({
                name: `   ${bold(s.name)} ${dim('— ' + s.description.slice(0, 50) + (s.description.length > 50 ? '…' : ''))}`,
                value: `plugin:${s.name}`
            });
        }
    }

    choices.push(new inquirer.Separator(dim(`  ─── Core Skills (${coreSkills.length}) ─────────────`)));
    choices.push({ name: `   ${bold('Show all ' + coreSkills.length + ' core skills')}`, value: 'list_core' });

    choices.push(new inquirer.Separator(dim('  ─── Community ────────────────────')));
    choices.push({ name: `   ${bold('Browse Community Skills')} ${dim('(orcbot-skills)')}`, value: 'browse_community' });

    choices.push(new inquirer.Separator(dim('  ─── Actions ──────────────────────')));
    choices.push({ name: `   ${bold('Install Skill from URL')}`, value: 'install_url' });
    choices.push({ name: `   ${bold('Install Skill from Local Path')}`, value: 'install_path' });
    choices.push({ name: `   ${bold('Create New Skill')}`, value: 'create' });
    choices.push({ name: `   ${bold('Build Skill from Spec URL')} ${dim('(Legacy)')}`, value: 'build' });
    choices.push({ name: `   ${bold('Validate Skill')}`, value: 'validate' });
    choices.push({ name: `   ${bold('Resync Skills Registry Files')}`, value: 'resync_registry' });
    choices.push(new inquirer.Separator(dim('  ──────────────────────────────────')));
    choices.push({ name: dim('  ← Back'), value: 'back' });

    const { selection } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selection',
            message: 'Manage Agent Skills:',
            choices,
            pageSize: 20
        }
    ]);

    if (selection === 'back') return showMainMenu();

    if (selection.startsWith('agent:')) {
        const skillName = selection.replace('agent:', '');
        const skill = agent.skills.getAgentSkill(skillName);
        if (!skill) return showSkillsMenu(ctx);

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: `Agent Skill: ${skillName}`,
                choices: [
                    { name: skill.activated ? 'Deactivate' : '▶  Activate', value: 'toggle' },
                    { name: 'View SKILL.md', value: 'view' },
                    { name: 'Validate', value: 'validate' },
                    { name: 'Show Resources', value: 'resources' },
                    { name: 'Uninstall', value: 'uninstall' },
                    { name: 'Back', value: 'back' }
                ]
            }
        ]);

        if (action === 'toggle') {
            if (skill.activated) {
                agent.skills.deactivateAgentSkill(skillName);
                console.log(`Deactivated "${skillName}"`);
            } else {
                agent.skills.activateAgentSkill(skillName);
                console.log(`▶  Activated "${skillName}"`);
            }
            await waitKeyPress();
        } else if (action === 'view') {
            console.log('\n' + '─'.repeat(60));
            console.log(fs.readFileSync(path.join(skill.skillDir, 'SKILL.md'), 'utf8'));
            console.log('─'.repeat(60));
            await waitKeyPress();
        } else if (action === 'validate') {
            const result = agent.skills.validateSkill(skill.skillDir);
            if (result.valid) {
                console.log(`Skill "${skillName}" is valid.`);
            } else {
                console.log(`${result.errors.length} issue(s):`);
                result.errors.forEach((e: string) => console.log(`  - ${e}`));
            }
            await waitKeyPress();
        } else if (action === 'resources') {
            console.log(`\nResources for "${skillName}":`);
            if (skill.scripts.length > 0) console.log(`  Scripts: ${skill.scripts.join(', ')}`);
            if (skill.references.length > 0) console.log(`  References: ${skill.references.join(', ')}`);
            if (skill.assets.length > 0) console.log(`  Assets: ${skill.assets.join(', ')}`);
            if (skill.scripts.length + skill.references.length + skill.assets.length === 0) {
                console.log('  (No bundled resources)');
            }
            await waitKeyPress();
        } else if (action === 'uninstall') {
            const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Really uninstall "${skillName}"?`, default: false }]);
            if (confirm) {
                console.log(agent.skills.uninstallAgentSkill(skillName));
                await waitKeyPress();
            }
        }
        return showSkillsMenu(ctx);
    }

    if (selection.startsWith('plugin:')) {
        const skillName = selection.replace('plugin:', '');
        const selectedSkill = skills.find((s: any) => s.name === skillName);
        if (selectedSkill?.pluginPath) {
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: `Plugin Skill: ${skillName}`,
                    choices: [
                        { name: 'View Source', value: 'view' },
                        { name: 'Uninstall', value: 'uninstall' },
                        { name: 'Back', value: 'back' }
                    ]
                }
            ]);

            if (action === 'view') {
                console.log('\n' + '─'.repeat(60));
                console.log(fs.readFileSync(selectedSkill.pluginPath, 'utf8'));
                console.log('─'.repeat(60));
                await waitKeyPress();
            } else if (action === 'uninstall') {
                const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Really delete "${skillName}"?`, default: false }]);
                if (confirm) {
                    fs.unlinkSync(selectedSkill.pluginPath);
                    console.log(`Uninstalled ${skillName}`);
                    agent.skills.loadPlugins();
                    await waitKeyPress();
                }
            }
        }
        return showSkillsMenu(ctx);
    }

    if (selection === 'list_core') {
        console.log('\n' + bold('Core Built-in Skills:'));
        coreSkills.forEach((s: any) => console.log(`  ${cyan(s.name)} - ${dim(s.description)}`));
        await waitKeyPress();
        return showSkillsMenu(ctx);
    }

    if (selection === 'browse_community') {
        await showCommunitySkillsMenu(ctx);
        return showSkillsMenu(ctx);
    }

    if (selection === 'install_url') {
        const { url } = await inquirer.prompt([
            { type: 'input', name: 'url', message: 'Enter Git repository URL or raw file URL:' }
        ]);
        if (url) {
            console.log('\nInstalling skill...');
            const result = await agent.skills.installSkillFromUrl(url.trim());
            console.log(result.message);
            await waitKeyPress();
        }
        return showSkillsMenu(ctx);
    }

    if (selection === 'install_path') {
        const { srcPath } = await inquirer.prompt([
            { type: 'input', name: 'srcPath', message: 'Enter local directory or file path:' }
        ]);
        if (srcPath) {
            const result = await agent.skills.installSkillFromPath(srcPath.trim());
            console.log(result.message);
            await waitKeyPress();
        }
        return showSkillsMenu(ctx);
    }

    if (selection === 'create') {
        const { name, description } = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Skill name (e.g. "deploy-helper"):', validate: (v: string) => v.trim().length > 0 || 'Name is required' },
            { type: 'input', name: 'description', message: 'What does this skill do?:', validate: (v: string) => v.trim().length > 0 || 'Description is required' }
        ]);
        const created = agent.skills.initSkill(name.trim(), description.trim());
        console.log(`\nCreated skill scaffold at:\n  ${created.path}`);
        console.log(`Edit the SKILL.md file to add your instructions and tools.`);
        await waitKeyPress();
        return showSkillsMenu(ctx);
    }

    if (selection === 'validate') {
        const agentSkillsList = agent.skills.getAgentSkills();
        if (agentSkillsList.length === 0) {
            console.log('No agent skills installed to validate.');
            await waitKeyPress();
            return showSkillsMenu(ctx);
        }
        const { skillName } = await inquirer.prompt([
            {
                type: 'list',
                name: 'skillName',
                message: 'Select skill to validate:',
                choices: agentSkillsList.map((s: any) => ({ name: s.meta.name, value: s.meta.name }))
            }
        ]);
        const skill = agent.skills.getAgentSkill(skillName);
        if (skill) {
            const result = agent.skills.validateSkill(skill.skillDir);
            if (result.valid) {
                console.log(`Skill "${skillName}" is valid.`);
            } else {
                console.log(`${result.errors.length} issue(s):`);
                result.errors.forEach((e: string) => console.log(`  - ${e}`));
            }
        }
        await waitKeyPress();
        return showSkillsMenu(ctx);
    }

    if (selection === 'resync_registry') {
        try {
            const result = agent.syncSkillsRegistryNow();
            console.log('\nSkills registry files resynced.');
            if (result.sourcePath) {
                console.log(`   Source: ${result.sourcePath}`);
            }
            for (const target of result.targets) {
                console.log(`   Target: ${target}`);
            }
        } catch (e: any) {
            console.log(`\nFailed to resync skills registries: ${e?.message || e}`);
        }
        await waitKeyPress();
        return showSkillsMenu(ctx);
    }

    if (selection === 'build') {
        const { url } = await inquirer.prompt([
            { type: 'input', name: 'url', message: 'Enter URL for skill specification:' }
        ]);
        if (url) {
            const { SkillBuilder } = require('../builder');
            const builder = new SkillBuilder();
            console.log('Building skill...');
            const result = await builder.buildFromUrl(url);
            console.log(result);
            agent.skills.loadPlugins();
            await waitKeyPress();
        }
        return showSkillsMenu(ctx);
    }

    return showSkillsMenu(ctx);
}
