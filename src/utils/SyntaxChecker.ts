import { Script } from 'vm';
import { logger } from './logger';
import * as ts from 'typescript';

export class SyntaxChecker {
    /**
     * Verifies if the provided JavaScript/TypeScript code has valid syntax.
     * Note: This only checks syntax, not logic or type safety.
     * 
     * @param code The source code to check
     * @param isTypeScript Whether to treat the code as TypeScript
     * @returns { valid: boolean; error?: string }
     */
    public static verify(code: string, isTypeScript: boolean = true): { valid: boolean; error?: string } {
        try {
            if (isTypeScript) {
                // For TypeScript, we use the TS compiler API to check for syntax errors.
                // transpileModule will report syntactic diagnostics.
                const result = ts.transpileModule(code, {
                    reportDiagnostics: true,
                    compilerOptions: { 
                        module: ts.ModuleKind.CommonJS,
                        target: ts.ScriptTarget.ESNext,
                        noEmit: true 
                    }
                });

                if (result.diagnostics && result.diagnostics.length > 0) {
                    const firstError = result.diagnostics[0];
                    const message = ts.flattenDiagnosticMessageText(firstError.messageText, '\n');
                    return { valid: false, error: `TS Syntax Error: ${message}` };
                }
                return { valid: true };
            } else {
                // For plain JavaScript, vm.Script is sufficient and fast.
                new Script(code);
                return { valid: true };
            }
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
