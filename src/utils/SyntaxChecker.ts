import { Script } from 'vm';
import { logger } from './logger';

export class SyntaxChecker {
    /**
     * Verifies if the provided JavaScript/TypeScript code has valid syntax.
     * Note: This only checks syntax, not logic or type safety.
     * 
     * @param code The source code to check
     * @returns { valid: boolean; error?: string }
     */
    public static verify(code: string): { valid: boolean; error?: string } {
        try {
            // We use vm.Script to parse the code without executing it.
            // If there's a syntax error, the constructor will throw.
            new Script(code);
            return { valid: true };
        } catch (e: any) {
            logger.debug(`SyntaxChecker: Invalid syntax detected: ${e.message}`);
            return { valid: false, error: e.message };
        }
    }

    /**
     * Strips markdown code blocks from LLM output.
     */
    public static cleanLLMOutput(text: string): string {
        return text
            .replace(/^```(?:javascript|typescript|js|ts)?\n/gm, '')
            .replace(/```$/gm, '')
            .trim();
    }
}
