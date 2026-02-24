import { eventBus } from '../core/EventBus';
import { logger } from '../utils/logger';

/**
 * OrcCanvas (A2UI) Skills
 * Allows agents to render interactive HTML/JS workspaces in the dashboard.
 * Inspired by OpenClaw's Live Canvas.
 */

export const renderCanvasSkill = {
    name: 'render_canvas',
    description: 'Render a live interactive HTML/JS/Tailwind workspace in the dashboard. Use this to show charts, dashboards, maps, or interactive apps to the user. The dashboard will switch to the Canvas view automatically.',
    usage: 'render_canvas({ html, js?, css?, title? })',
    handler: async (args: any, context: any) => {
        try {
            const html = args.html || args.content || '';
            const js = args.js || args.script || '';
            const css = args.css || args.style || '';
            const title = args.title || 'OrcCanvas Workspace';

            if (!html) {
                return 'Error: No HTML content provided for the canvas.';
            }

            const canvasId = `canvas-${Date.now()}`;

            // Emit event to be picked up by Gateway and sent to dashboard
            eventBus.emit('gateway:chat:canvas', {
                type: 'chat:canvas',
                id: canvasId,
                title,
                html,
                js,
                css,
                timestamp: new Date().toISOString()
            });

            logger.info(`Canvas rendered: ${title} (${canvasId})`);
            return `✓ Canvas "${title}" has been rendered in the dashboard. The user can now see and interact with it.`;
        } catch (error) {
            logger.error(`Canvas render error: ${error}`);
            return `Error rendering canvas: ${error}`;
        }
    }
};

export const canvasToolsSkills = [renderCanvasSkill];
