import inquirer from 'inquirer';
import { renderScreenHeader } from '../ui/Header';
import { promptSelect } from '../ui/Prompts';
import {
    box,
    c,
    bold,
    dim,
    cyan,
    green,
    red,
    gray,
    brightGreen,
    brightCyan,
    waitKeyPress,
} from '../ui/Widgets';
import { getCliContext, CliContext } from '../context';

/**
 * Screen controller for the Tools Manager (installed tool plugins, approvals, permissions).
 */
export async function showToolsManagerMenu(context?: CliContext): Promise<void> {
    const ctx = context ?? getCliContext();
    const { agent, showMainMenu } = ctx;

    renderScreenHeader('Tools Manager');

    const tools = agent.tools.listTools();
    const activeCount = tools.filter(t => t.active).length;
    const approvedCount = tools.filter(t => t.approved).length;

    console.log('');
    const summaryLines = [
        `${c.white}Installed${c.reset}   ${brightCyan(bold(String(tools.length)))}`,
        `${c.white}Active${c.reset}      ${activeCount > 0 ? `${c.brightGreen}${c.bold}${String(activeCount)}${c.reset}` : `${c.gray}0${c.reset}`}`,
        `${c.white}Approved${c.reset}    ${approvedCount > 0 ? `${c.brightGreen}${c.bold}${String(approvedCount)}${c.reset}` : `${c.gray}0${c.reset}`}`,
    ];
    box(summaryLines, { title: 'TOOL INVENTORY', width: 40 });
    console.log('');

    const action = await promptSelect<string>(
        cyan('Tools Options:'),
        [
            { label: 'Install Tool', value: 'install' },
            { label: 'Approve Tool', value: 'approve' },
            { label: 'Activate / Deactivate Tool', value: 'activate' },
            { label: 'Run Tool Command', value: 'run' },
            { label: 'Read Tool README', value: 'readme' },
            { label: 'Uninstall Tool', value: 'uninstall' },
            { label: 'Back', value: 'back', hint: 'return to main menu' }
        ]
    );

    if (!action || action === 'back') {
        return showMainMenu();
    }

    const pickToolName = async (label: string): Promise<string> => {
        if (tools.length > 0) {
            const choices = tools.map(t => ({
                name: `${t.active ? green('●') : gray('○')} ${t.name} ${t.approved ? green('✓') : red('✗')}${t.description ? dim(` — ${t.description.slice(0, 40)}`) : ''}`,
                value: t.name
            }));
            choices.push({ name: dim('    Enter name manually'), value: '__manual__' });
            const { selected } = await inquirer.prompt([
                { type: 'list', name: 'selected', message: label, choices }
            ]);
            if (selected !== '__manual__') return selected;
        }
        const { name } = await inquirer.prompt([
            { type: 'input', name: 'name', message: `${label} (tool name):` }
        ]);
        return (name || '').trim();
    };

    switch (action) {
        case 'install': {
            if (agent.config.get('safeMode')) {
                console.log('\nSafe mode is enabled. Tool installation is disabled.');
                break;
            }
            const { source } = await inquirer.prompt([
                { type: 'input', name: 'source', message: 'Git URL or local path:' }
            ]);
            const { name } = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'Optional tool name (leave blank to infer):' }
            ]);
            const { subdir } = await inquirer.prompt([
                { type: 'input', name: 'subdir', message: 'Optional subdir (leave blank if repo root):' }
            ]);
            const { allowed } = await inquirer.prompt([
                { type: 'input', name: 'allowed', message: 'Allowed commands (comma-separated, or * for all):' }
            ]);
            const { description } = await inquirer.prompt([
                { type: 'input', name: 'description', message: 'Optional description:' }
            ]);
            const allowedCommands = allowed ? allowed.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
            const result = await agent.tools.installTool({ source, name: name || undefined, subdir: subdir || undefined, allowedCommands, description: description || undefined });
            if (result.success && result.name) {
                agent.tools.activateTool(result.name, true);
            }
            console.log(`\n${result.success ? green('✓') : red('✗')} ${result.message}`);
            break;
        }
        case 'approve': {
            const name = await pickToolName('Select tool to approve');
            if (!name) break;
            const { allowed } = await inquirer.prompt([
                { type: 'input', name: 'allowed', message: 'Allowed commands (comma-separated, or * for all):' }
            ]);
            const allowedCommands = allowed ? allowed.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
            const result = agent.tools.approveTool(name, allowedCommands);
            console.log(`\n${result.success ? green('✓') : red('✗')} ${result.message}`);
            break;
        }
        case 'activate': {
            const name = await pickToolName('Select tool to activate/deactivate');
            if (!name) break;
            const tool = agent.tools.getTool(name);
            if (!tool) {
                console.log('\nTool not found.');
                break;
            }
            const { active } = await inquirer.prompt([
                { type: 'confirm', name: 'active', message: `Set "${name}" active?`, default: !tool.active }
            ]);
            const result = agent.tools.activateTool(name, active);
            console.log(`\n${result.success ? green('✓') : red('✗')} ${result.message}`);
            break;
        }
        case 'run': {
            if (agent.config.get('safeMode')) {
                console.log('\nSafe mode is enabled. Tool execution is disabled.');
                break;
            }
            const name = await pickToolName('Select tool to run');
            if (!name) break;
            const { command } = await inquirer.prompt([
                { type: 'input', name: 'command', message: 'Command to run (e.g., node, python, ./bin/tool):' }
            ]);
            const { args } = await inquirer.prompt([
                { type: 'input', name: 'args', message: 'Args (optional):' }
            ]);
            const { cwd } = await inquirer.prompt([
                { type: 'input', name: 'cwd', message: 'Working dir relative to tool (optional):' }
            ]);
            const result = await agent.tools.runToolCommand(name, command, args || undefined, cwd || undefined);
            console.log(`\n${result.success ? green('✓') : red('✗')} ${result.message}`);
            break;
        }
        case 'readme': {
            const name = await pickToolName('Select tool to read README');
            if (!name) break;
            const result = agent.tools.readToolReadme(name);
            console.log(`\n${result.message}`);
            break;
        }
        case 'uninstall': {
            if (agent.config.get('safeMode')) {
                console.log('\nSafe mode is enabled. Tool uninstall is disabled.');
                break;
            }
            const name = await pickToolName('Select tool to uninstall');
            if (!name) break;
            const { confirm } = await inquirer.prompt([
                { type: 'confirm', name: 'confirm', message: `Uninstall "${name}"?`, default: false }
            ]);
            if (!confirm) break;
            const result = agent.tools.uninstallTool(name);
            console.log(`\n${result.success ? green('✓') : red('✗')} ${result.message}`);
            break;
        }
    }

    await waitKeyPress();
    return showToolsManagerMenu(ctx);
}
