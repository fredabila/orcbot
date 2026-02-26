/**
 * ObjectUtils - Helpers for deep comparison and object manipulation
 */

/**
 * Perform a deep equality check between two values.
 * Optimized for configuration objects.
 */
export function isDeepEqual(a: any, b: any): boolean {
    // 1. Literal equality (handles primitives and same-reference objects)
    if (a === b) return true;

    // 2. Handle null/undefined (one is null, other is undefined)
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;

    // 3. Handle different types
    if (typeof a !== typeof b) return false;

    // 4. Handle Objects and Arrays
    if (typeof a === 'object') {
        // Handle Arrays
        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!isDeepEqual(a[i], b[i])) return false;
            }
            return true;
        }

        // Handle Dates
        if (a instanceof Date) {
            return b instanceof Date && a.getTime() === b.getTime();
        }

        // Handle Plain Objects
        const keysA = Object.keys(a).filter(k => (a as any)[k] !== undefined);
        const keysB = Object.keys(b).filter(k => (b as any)[k] !== undefined);
        
        if (keysA.length !== keysB.length) return false;

        // Sort keys to ensure consistent comparison
        keysA.sort();
        keysB.sort();

        for (let i = 0; i < keysA.length; i++) {
            const key = keysA[i];
            if (key !== keysB[i]) return false;
            if (!isDeepEqual((a as any)[key], (b as any)[key])) return false;
        }
        return true;
    }

    return false;
}
