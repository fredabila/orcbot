/**
 * Channel permission resolution.
 *
 * Security model (owner-only by default):
 * - Tasks with no channel source (CLI, gateway, autonomy/heartbeat) are always admin.
 * - The owner's own web/gateway dashboard is trusted.
 * - WhatsApp: the linked owner's own chat (self-chat) is admin; external contacts are admin ONLY
 *   when explicitly listed in `adminUsers.whatsapp`.
 * - Telegram/Discord/Slack/email: a sender is admin ONLY when explicitly listed in
 *   `adminUsers.<channel>`. When no list is configured the default is NON-admin, so a stranger
 *   who messages the bot cannot run elevated actions. Add your own id to `adminUsers.<channel>`
 *   to grant yourself full access.
 */

function localPart(value: unknown): string {
    return String(value ?? '').trim().split('@')[0].split(':')[0];
}

function normalizeList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => String(x).trim()).filter(Boolean);
}

/** Match sender identifiers against an admin list, tolerating phone-JID vs LID forms. */
function matchesAny(identifiers: Array<unknown>, list: string[]): boolean {
    if (list.length === 0) return false;
    const exact = new Set(identifiers.filter(Boolean).map((x) => String(x)));
    const locals = new Set([...exact].map(localPart));
    return list.some((entry) => exact.has(entry) || locals.has(localPart(entry)));
}

export function computeIsUserAdmin(adminUsers: any, payload: any): boolean {
    const source = payload?.source;

    // CLI / autonomy / heartbeat tasks have no channel source and are always admin.
    if (!source) return true;

    // The owner's own web dashboard is trusted.
    if (source === 'gateway-chat') return true;

    // WhatsApp owner (self-chat) is always admin. External contacts are admin only when listed.
    if (source === 'whatsapp') {
        if (payload?.isOwner === true || payload?.isSelfChat === true) return true;
        const list = normalizeList(adminUsers?.whatsapp);
        if (list.length === 0) return false;
        return matchesAny([payload?.userId, payload?.sourceId], list);
    }

    // Other channels: owner/admin must be explicitly listed (owner-only default).
    const list = normalizeList(adminUsers?.[source]);
    if (list.length === 0) return false;
    if (source === 'email') {
        const identity = String(payload?.sourceId || payload?.from || '').trim().toLowerCase();
        if (!identity) return false;
        return list.map((x) => x.toLowerCase()).includes(identity);
    }
    return matchesAny([payload?.userId, payload?.sourceId], list);
}
