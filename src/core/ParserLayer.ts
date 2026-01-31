import { logger } from '../utils/logger';

export interface ToolCall {
    name: string;
    metadata?: Record<string, any>;
}

export interface StandardResponse {
    success: boolean;
    action?: string;
    tool?: string;
    tools?: ToolCall[];
    content?: string;
    metadata?: Record<string, any>;
    reasoning?: string;
}

export class ParserLayer {
    public static normalize(rawResponse: string): StandardResponse {
        try {
            // Find JSON block if it exists
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                // Unify single 'tool' and multiple 'tools'
                let tools: ToolCall[] = parsed.tools || [];
                if (parsed.tool && tools.length === 0) {
                    tools.push({ name: parsed.tool, metadata: parsed.metadata });
                }

                return {
                    success: parsed.success ?? true,
                    action: parsed.action,
                    tool: parsed.tool,
                    tools: tools,
                    content: parsed.content,
                    metadata: parsed.metadata,
                    reasoning: parsed.reasoning,
                };
            }

            // Fallback: treat whole response as content
            return {
                success: true,
                content: rawResponse,
                reasoning: 'No structured JSON found, treated as plain text.'
            };
        } catch (error) {
            logger.error(`ParserLayer: Error normalizing response: ${error}`);
            return {
                success: false,
                content: rawResponse,
                metadata: { error: String(error) }
            };
        }
    }

    public static getSystemPromptSnippet(): string {
        return `
IMPORTANT: You MUST always respond with a valid JSON object wrapped in code blocks.
You can now call MULTIPLE tools in a single turn using the "tools" array.

JSON Format:
\`\`\`json
{
  "action": "THOUGHT",
  "reasoning": "I need to research X and then message the user.",
  "tools": [
    { "name": "web_search", "metadata": { "query": "robotics" } },
    { "name": "update_journal", "metadata": { "entry_text": "Researched robotics for Frederick." } },
    { "name": "send_telegram", "metadata": { "message": "I've finished my research on robotics!" } }
  ],
  "content": "Final summary if no telegram tool used"
}
\`\`\`
`;
    }
}
