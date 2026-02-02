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
    /**
     * Sanitize JSON string to fix common LLM escaping issues
     */
    private static sanitizeJsonString(jsonStr: string): string {
        // Fix unescaped newlines inside string values
        // This regex finds strings and escapes unescaped newlines within them
        let result = jsonStr;
        
        // Replace literal newlines inside quoted strings with \n
        // Match content between quotes, handling escaped quotes
        result = result.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
            // Replace actual newlines with escaped newlines inside the matched string
            return match.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t');
        });
        
        // Fix Windows-style paths that might have unescaped backslashes
        // But be careful not to double-escape
        result = result.replace(/\\([^"\\nrtbfu\/])/g, '\\\\$1');
        
        return result;
    }

    public static normalize(rawResponse: string): StandardResponse {
        try {
            // Find JSON block if it exists
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                let jsonStr = jsonMatch[0];
                
                // Try parsing as-is first
                let parsed: any;
                try {
                    parsed = JSON.parse(jsonStr);
                } catch (firstError) {
                    // Try sanitizing the JSON
                    logger.debug('ParserLayer: Initial parse failed, attempting sanitization...');
                    try {
                        const sanitized = this.sanitizeJsonString(jsonStr);
                        parsed = JSON.parse(sanitized);
                        logger.debug('ParserLayer: Sanitization succeeded');
                    } catch (sanitizeError) {
                        // Last resort: try to extract key fields manually
                        logger.warn('ParserLayer: Sanitization failed, attempting manual extraction...');
                        parsed = this.extractFieldsManually(jsonStr);
                        if (!parsed) {
                            throw firstError; // Re-throw original error
                        }
                    }
                }

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

    /**
     * Manual field extraction as last resort for malformed JSON
     */
    private static extractFieldsManually(jsonStr: string): any | null {
        try {
            const result: any = {};
            
            // Extract action
            const actionMatch = jsonStr.match(/"action"\s*:\s*"([^"]+)"/);
            if (actionMatch) result.action = actionMatch[1];
            
            // Extract single tool name
            const toolMatch = jsonStr.match(/"tool"\s*:\s*"([^"]+)"/);
            if (toolMatch) result.tool = toolMatch[1];
            
            // Extract tools array - look for tool names within the array
            const toolsArrayMatch = jsonStr.match(/"tools"\s*:\s*\[([^\]]+)\]/s);
            if (toolsArrayMatch) {
                const toolNames = toolsArrayMatch[1].match(/"name"\s*:\s*"([^"]+)"/g);
                if (toolNames && toolNames.length > 0) {
                    result.tools = toolNames.map(t => {
                        const nameMatch = t.match(/"name"\s*:\s*"([^"]+)"/);
                        return { name: nameMatch ? nameMatch[1] : 'unknown', metadata: {} };
                    });
                    
                    // Try to extract metadata for each tool
                    const metadataMatches = toolsArrayMatch[1].match(/"metadata"\s*:\s*\{[^}]*\}/g);
                    if (metadataMatches) {
                        metadataMatches.forEach((m, i) => {
                            if (result.tools[i]) {
                                try {
                                    const metaObj = m.match(/\{[^}]*\}/);
                                    if (metaObj) {
                                        // Simple key-value extraction
                                        const pairs: Record<string, any> = {};
                                        const kvMatches = metaObj[0].matchAll(/"(\w+)"\s*:\s*"([^"]*)"/g);
                                        for (const kv of kvMatches) {
                                            pairs[kv[1]] = kv[2];
                                        }
                                        if (Object.keys(pairs).length > 0) {
                                            result.tools[i].metadata = pairs;
                                        }
                                    }
                                } catch {}
                            }
                        });
                    }
                }
            }
            
            // Extract reasoning (simplified)
            const reasoningMatch = jsonStr.match(/"reasoning"\s*:\s*"([^"]{0,500})/);
            if (reasoningMatch) result.reasoning = reasoningMatch[1];
            
            // Extract goals_met
            const goalsMatch = jsonStr.match(/"goals_met"\s*:\s*(true|false)/);
            if (goalsMatch) {
                result.verification = {
                    goals_met: goalsMatch[1] === 'true',
                    analysis: 'Extracted from malformed JSON'
                };
            }
            
            // Try to extract metadata object for single tool
            if (result.tool && !result.metadata) {
                const metadataMatch = jsonStr.match(/"metadata"\s*:\s*(\{[^}]+\})/);
                if (metadataMatch) {
                    try {
                        result.metadata = JSON.parse(metadataMatch[1]);
                    } catch {
                        // Extract individual metadata fields
                        const pairs: Record<string, any> = {};
                        const kvMatches = metadataMatch[1].matchAll(/"(\w+)"\s*:\s*"([^"]*)"/g);
                        for (const kv of kvMatches) {
                            pairs[kv[1]] = kv[2];
                        }
                        if (Object.keys(pairs).length > 0) {
                            result.metadata = pairs;
                        }
                    }
                }
            }
            
            // Only return if we got something useful
            if (result.tool || result.tools?.length > 0 || result.action) {
                logger.info(`ParserLayer: Manually extracted - tool: ${result.tool || 'none'}, tools: ${result.tools?.length || 0}, action: ${result.action || 'none'}`);
                return result;
            }
            
            return null;
        } catch (e) {
            logger.debug(`ParserLayer: Manual extraction error: ${e}`);
            return null;
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
