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
    verification?: {
        goals_met: boolean;
        analysis: string;
    };
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
                    verification: parsed.verification
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
You can call MULTIPLE tools in a single turn using the "tools" array - use this for parallel/independent operations.

JSON Format:
\`\`\`json
{
  "action": "THOUGHT",
  "reasoning": "I need to search for info and notify the user simultaneously.",
  "verification": {
    "goals_met": false,
    "analysis": "Starting research phase."
  },
  "tools": [
    { "name": "browser_navigate", "metadata": { "query": "http://google.com" } },
    { "name": "web_search", "metadata": { "query": "robotics breakthroughs 2026" } },
    { "name": "send_telegram", "metadata": { "chatId": "user123", "message": "Researching now..." } }
  ],
  "content": "..."
}
\`\`\`

Single tool shorthand (still supported):
\`\`\`json
{
  "action": "EXECUTE",
  "tool": "web_search",
  "metadata": { "query": "example" },
  "content": "..."
}
\`\`\`
`;
    }
}
