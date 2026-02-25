import { z } from 'zod';
import { logger } from '../utils/logger';
import { LLMParser, ParserLLM } from './LLMParser';

export const ToolCallSchema = z.object({
    name: z.string(),
    metadata: z.record(z.string(), z.any()).optional()
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

export const StandardResponseSchema = z.object({
    success: z.boolean().default(true),
    action: z.string().optional(),
    tool: z.string().optional(),
    tools: z.array(ToolCallSchema).optional(),
    content: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    reasoning: z.string().optional(),
    verification: z.object({
        goals_met: z.boolean(),
        analysis: z.string()
    }).optional(),
    /** Set by DecisionEngine when validator filters out tools */
    toolsFiltered: z.number().optional()
});

export type StandardResponse = z.infer<typeof StandardResponseSchema>;

export class ParserLayer {
    /** Optional LLM instance for smart parsing fallback (Tier 3) */
    private static llmParser: LLMParser | null = null;

    /**
     * Set the LLM instance for intelligent field extraction when regex fails.
     * Called once during agent initialization.
     */
    public static setLLM(llm: ParserLLM): void {
        ParserLayer.llmParser = new LLMParser(llm);
    }

    /**
     * Get the LLMParser instance (if configured). Useful for callers who want
     * direct access to intent classification or metadata normalization.
     */
    public static getLLMParser(): LLMParser | null {
        return ParserLayer.llmParser;
    }

    /**
     * Normalize tool call metadata to a canonical shape expected by ResponseValidator
     * and downstream execution.
     */
    private static normalizeToolCalls(tools: ToolCall[]): ToolCall[] {
        return (tools || [])
            .filter((tool) => {
                // Filter out tool calls with empty/missing names — LLMs occasionally produce phantom calls
                if (!tool?.name || tool.name.trim().length === 0) {
                    logger.debug('ParserLayer: Filtered tool call with empty name');
                    return false;
                }
                return true;
            })
            .map((tool) => {
            const toolName = (tool?.name || '').toLowerCase();
            const metadata: Record<string, any> = { ...(tool.metadata || {}) };

            // Normalize message field across messaging tools
            if (metadata.message == null) {
                metadata.message = metadata.content ?? metadata.text ?? metadata.body;
            }

            if (toolName === 'send_telegram') {
                // ResponseValidator requires metadata.chatId
                if (metadata.chatId == null) {
                    metadata.chatId = metadata.chat_id ?? metadata.chatid ?? metadata.id ?? metadata.to ?? metadata.userId;
                }
            }

            if (toolName === 'send_discord') {
                // ResponseValidator requires metadata.channel_id
                if (metadata.channel_id == null) {
                    metadata.channel_id = metadata.channelId ?? metadata.channel ?? metadata.id ?? metadata.to ?? metadata.sourceId;
                }
            }

            // Normalize browser tool fields to what ResponseValidator expects.
            // The LLM frequently uses selector_or_ref/ref/css/value, while the executor and validator
            // prefer canonical keys: selector + text.
            if (toolName === 'browser_click' || toolName === 'browser_type') {
                if (metadata.selector == null) {
                    const selectorCandidate =
                        metadata.selector_or_ref ??
                        metadata.selectorOrRef ??
                        metadata.css ??
                        metadata.ref;

                    if (selectorCandidate != null) {
                        metadata.selector = String(selectorCandidate);
                    }
                }

                if (toolName === 'browser_type') {
                    if (metadata.text === undefined) {
                        const textCandidate = metadata.value ?? metadata.content;
                        if (textCandidate !== undefined) {
                            metadata.text = textCandidate;
                        }
                    }
                }
            }

            return {
                ...tool,
                metadata
            };
        });
    }

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

                tools = this.normalizeToolCalls(tools);

                const finalResponse = {
                    success: parsed.success ?? true,
                    action: parsed.action,
                    tool: parsed.tool,
                    tools: tools,
                    content: parsed.content,
                    metadata: parsed.metadata,
                    reasoning: parsed.reasoning,
                    verification: parsed.verification
                };

                // Final validation with Zod
                const result = StandardResponseSchema.safeParse(finalResponse);
                if (!result.success) {
                    logger.debug(`ParserLayer: Response validation issues: ${result.error.message}`);
                    return finalResponse as StandardResponse;
                }
                return result.data;
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
     * Async-enhanced normalize that adds an LLM fallback tier.
     *
     * Pipeline:
     *   1. JSON.parse (fast)
     *   2. Sanitize + JSON.parse
     *   3. Regex-based manual extraction
     *   4. **LLM-based extraction** (new — only fires when regex extraction fails and an LLM is configured)
     *
     * Callers that can `await` should prefer this over the sync `normalize()`.
     */
    public static async normalizeAsync(rawResponse: string): Promise<StandardResponse> {
        // First try the fast synchronous path
        const syncResult = this.normalize(rawResponse);

        // If sync parsing succeeded with tools or meaningful content, return it
        if (syncResult.success && (syncResult.tools?.length || syncResult.tool || syncResult.action)) {
            return syncResult;
        }

        // If sync parsing failed AND we have an LLM parser, try LLM extraction
        if (!syncResult.success && this.llmParser) {
            const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
            const inputForLLM = jsonMatch ? jsonMatch[0] : rawResponse;

            logger.info('ParserLayer: Attempting LLM-based field extraction...');
            try {
                const extracted = await this.llmParser.extractFields(inputForLLM);
                if (extracted && (extracted.tool || extracted.tools?.length || extracted.action)) {
                    logger.info('ParserLayer: LLM extraction succeeded');

                    let tools: ToolCall[] = extracted.tools || [];
                    if (extracted.tool && tools.length === 0) {
                        tools.push({ name: extracted.tool, metadata: extracted.metadata });
                    }
                    tools = this.normalizeToolCalls(tools);

                    return {
                        success: true,
                        action: extracted.action,
                        tool: extracted.tool,
                        tools,
                        content: extracted.content,
                        metadata: extracted.metadata,
                        reasoning: extracted.reasoning,
                        verification: extracted.verification
                    };
                }
            } catch (llmError) {
                logger.warn(`ParserLayer: LLM extraction failed: ${llmError}`);
            }
        }

        return syncResult;
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

    /**
     * Convert a native tool calling response (structured tool calls + text content)
     * into the StandardResponse format used by the rest of the system.
     * 
     * The text content from the LLM may contain reasoning/verification as JSON or free text.
     * The structured tool calls are directly mapped to our ToolCall format.
     */
    public static normalizeNativeToolResponse(
        textContent: string,
        nativeToolCalls: Array<{ name: string; arguments: Record<string, any>; id?: string }>
    ): StandardResponse {
        // Convert native tool calls → our ToolCall format
        // Native tools use "arguments" directly as the parameters, which maps to our "metadata"
        // Filter out tool calls with empty names — LLMs occasionally produce phantom calls
        let tools: ToolCall[] = nativeToolCalls
            .filter(tc => tc.name && tc.name.trim().length > 0)
            .map(tc => ({
                name: tc.name,
                metadata: tc.arguments || {},
            }));

        if (tools.length < nativeToolCalls.length) {
            logger.debug(`ParserLayer: Filtered ${nativeToolCalls.length - tools.length} tool call(s) with empty name`);
        }

        tools = this.normalizeToolCalls(tools);

        // Extract reasoning and verification from the text content.
        // The LLM may embed these in JSON within its text response, or as free text.
        let reasoning: string | undefined;
        let verification: { goals_met: boolean; analysis: string } | undefined;
        let content: string | undefined;
        let action: string | undefined;

        if (textContent) {
            // Try to parse structured JSON from the text content
            const jsonMatch = textContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    reasoning = parsed.reasoning;
                    verification = parsed.verification;
                    content = parsed.content;
                    action = parsed.action;

                    // If the JSON also contained tools (hybrid response), merge them
                    if (parsed.tools?.length && tools.length === 0) {
                        const textTools: ToolCall[] = parsed.tools.map((t: any) => ({
                            name: t.name,
                            metadata: t.metadata || {},
                        }));
                        tools = this.normalizeToolCalls(textTools);
                    }
                } catch {
                    // JSON parse failed — treat text as reasoning
                    reasoning = textContent;
                }
            } else {
                // No JSON in text — treat the whole thing as reasoning
                reasoning = textContent;
            }
        }

        // If no verification was extracted, infer from tools: if no tools and no content,
        // the model might be done (but DecisionEngine's termination review catches this)
        if (!verification) {
            verification = {
                goals_met: tools.length === 0 && !content,
                analysis: tools.length === 0 ? 'No tools invoked' : `Invoking ${tools.length} tool(s)`,
            };
        }

        const finalResponse = {
            success: true,
            action: action || (tools.length > 0 ? 'EXECUTE' : 'THOUGHT'),
            tool: tools.length === 1 ? tools[0].name : undefined,
            tools,
            content,
            metadata: tools.length === 1 ? tools[0].metadata : undefined,
            reasoning,
            verification,
        };

        // Final validation with Zod
        const result = StandardResponseSchema.safeParse(finalResponse);
        if (!result.success) {
            logger.debug(`ParserLayer: Native tool response validation issues: ${result.error.message}`);
            return finalResponse as StandardResponse;
        }
        return result.data;
    }

    /**
     * Get the system prompt snippet for native tool calling mode.
     * This is a slimmer version — no JSON format instructions needed since tools are structured.
     * We only need to tell the model about reasoning/verification expectations.
     */
    public static getNativeToolCallingPromptSnippet(): string {
        return `
TOOL CALLING MODE:
You have tools available as function calls. When you want to use a tool, call it directly — do NOT wrap tool calls in JSON.

In addition to calling tools, include reasoning in your text response:
- Brief reasoning about what you're doing and why
- A verification assessment: { "goals_met": true/false, "analysis": "..." }

When the task is complete, respond with text only (no tool calls) and include:
\`\`\`json
{ "verification": { "goals_met": true, "analysis": "Task completed because..." }, "content": "Your message to show the user" }
\`\`\`

You can call MULTIPLE tools in parallel when they are independent operations.
`;
    }

    public static getSystemPromptSnippet(): string {
        return `
IMPORTANT: You MUST always respond with a valid JSON object wrapped in code blocks.
You can call MULTIPLE tools in a single turn using the "tools" array - use this for parallel/independent operations.

JSON Format:
- Always optimize your workflow based on the provided SYSTEM ENVIRONMENT (CPU/RAM/OS).
- If resources are constrained, explain your choice of a lighter-weight approach in "reasoning".
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
