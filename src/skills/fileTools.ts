import { Agent } from '../core/Agent';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import MarkdownIt from 'markdown-it';

export function registerFileTools(agent: Agent) {
    agent.skills.registerSkill({
        name: 'generate_pdf',
        description: 'Generate a PDF file from Markdown or HTML content. Use this to compile research, logs, or reports into a clean PDF document.',
        usage: 'generate_pdf(content, output_path, is_html?)',
        isSideEffect: true,
        handler: async (args: any) => {
            try {
                const content = args.content || args.text;
                const outputPath = args.output_path || args.outputPath || args.path;
                const isHtml = args.is_html || args.isHtml || false;

                if (!content || !outputPath) {
                    return 'Error: content and output_path are required.';
                }

                logger.info(`Generating PDF to ${outputPath}...`);

                let htmlContent = content;
                if (!isHtml) {
                    const md = new MarkdownIt({ html: true, breaks: true, linkify: true });
                    htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: 0 auto; color: #333; }
                            h1, h2, h3, h4 { color: #111; margin-top: 24px; margin-bottom: 16px; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
                            a { color: #0366d6; text-decoration: none; }
                            code { background-color: rgba(27,31,35,0.05); border-radius: 3px; font-family: monospace; padding: 0.2em 0.4em; }
                            pre { background-color: #f6f8fa; padding: 16px; overflow: auto; border-radius: 3px; }
                            pre code { background-color: transparent; padding: 0; }
                            table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
                            table th, table td { padding: 6px 13px; border: 1px solid #dfe2e5; }
                            table tr:nth-child(2n) { background-color: #f6f8fa; }
                            blockquote { color: #6a737d; border-left: 0.25em solid #dfe2e5; padding: 0 1em; margin: 0 0 16px 0; }
                            img { max-width: 100%; box-sizing: content-box; background-color: #fff; }
                        </style>
                    </head>
                    <body>
                        ${md.render(content)}
                    </body>
                    </html>`;
                }

                // Ensure directory exists
                const dir = path.dirname(outputPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                // Use the agent's web browser instance to generate the PDF
                if (!agent.browser) {
                     return 'Error: WebBrowser module is not initialized. Cannot generate PDF.';
                }

                if (!agent.browser.page) {
                    await agent.browser.wait(1); // Force browser initialization if not yet started
                }

                const page = agent.browser.page;
                
                if (!page) {
                    return 'Error: Browser page could not be created.';
                }
                
                await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
                
                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    printBackground: true,
                    margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
                });

                fs.writeFileSync(outputPath, pdfBuffer);

                return `Successfully generated PDF at: ${outputPath}`;
            } catch (error: any) {
                logger.error(`Failed to generate PDF: ${error}`);
                return `Error generating PDF: ${error.message || String(error)}`;
            }
        }
    });
}
