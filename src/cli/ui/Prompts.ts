import * as p from '@clack/prompts';

export interface SelectOption<T = string> {
    label: string;
    value: T;
    hint?: string;
}

/**
 * Standardized inline select menu using @clack/prompts.
 * Returns null if the user cancelled (Ctrl+C / Esc).
 */
export async function promptSelect<T extends string | number | boolean = string>(
    message: string,
    options: SelectOption<T>[],
    initialValue?: T
): Promise<T | null> {
    const res = await p.select({
        message,
        options: options.map(opt => ({
            label: opt.label,
            value: opt.value,
            ...(opt.hint ? { hint: opt.hint } : {}),
        })),
        initialValue,
    } as any);

    if (p.isCancel(res)) {
        return null;
    }
    return res as T;
}

/**
 * Standardized inline text input using @clack/prompts.
 * Returns null if cancelled.
 */
export async function promptText(
    message: string,
    opts: {
        placeholder?: string;
        defaultValue?: string;
        validate?: (value: string) => string | void;
    } = {}
): Promise<string | null> {
    const res = await p.text({
        message,
        placeholder: opts.placeholder,
        defaultValue: opts.defaultValue,
        validate: opts.validate
            ? (val: string) => {
                const out = opts.validate!(val);
                return typeof out === 'string' ? out : undefined;
            }
            : undefined,
    });

    if (p.isCancel(res)) {
        return null;
    }
    return res as string;
}

/**
 * Standardized inline confirmation (yes/no) using @clack/prompts.
 * Returns null if cancelled.
 */
export async function promptConfirm(
    message: string,
    initialValue = true
): Promise<boolean | null> {
    const res = await p.confirm({
        message,
        initialValue,
    });

    if (p.isCancel(res)) {
        return null;
    }
    return Boolean(res);
}

/**
 * Standardized inline multi-select menu using @clack/prompts.
 */
export async function promptMultiSelect<T extends string | number | boolean = string>(
    message: string,
    options: SelectOption<T>[],
    opts: { required?: boolean; initialValues?: T[] } = {}
): Promise<T[] | null> {
    const res = await p.multiselect({
        message,
        options: options.map(opt => ({
            label: opt.label,
            value: opt.value,
            ...(opt.hint ? { hint: opt.hint } : {}),
        })),
        required: opts.required,
        initialValues: opts.initialValues,
    } as any);

    if (p.isCancel(res)) {
        return null;
    }
    return res as T[];
}

/**
 * Execute an async operation with an inline animated spinner.
 */
export async function withSpinner<T>(
    startMessage: string,
    task: (update: (msg: string) => void) => Promise<T>,
    stopMessage?: string
): Promise<T> {
    const s = p.spinner();
    s.start(startMessage);
    try {
        const result = await task((msg: string) => s.message(msg));
        s.stop(stopMessage ?? startMessage);
        return result;
    } catch (err) {
        s.stop(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
    }
}

/**
 * Show a formatted note / callout box.
 */
export function showNote(message: string, title?: string): void {
    p.note(message, title);
}

/**
 * Show a completion outro message.
 */
export function showOutro(message: string): void {
    p.outro(message);
}
