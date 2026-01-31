import { logger } from '../utils/logger';

export interface StandardResponse {
    success: boolean;
    action?: string;
    tool?: string;
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
                return {
                    success: parsed.success ?? true,
                    action: parsed.action,
                    tool: parsed.tool,
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
IMPORTANT: You MUST always respond with a valid JSON object wrapped in code blocks, for example:
\`\`\`json
{
  "action": "THOUGHT",
  "reasoning": "I need to...",
  "tool": "optional_tool_name",
  "content": "message to user or result"
}
\`\`\`
`;
    }
}
