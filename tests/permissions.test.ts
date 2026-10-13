import { describe, it, expect } from 'vitest';
import { computeIsUserAdmin } from '../src/core/permissions';

describe('computeIsUserAdmin', () => {
    it('treats tasks without a channel source as admin', () => {
        expect(computeIsUserAdmin(undefined, { source: undefined })).toBe(true);
        expect(computeIsUserAdmin(undefined, {})).toBe(true);
    });

    it('treats the WhatsApp owner self-chat as admin', () => {
        expect(computeIsUserAdmin(undefined, { source: 'whatsapp', isSelfChat: true })).toBe(true);
        expect(computeIsUserAdmin(undefined, { source: 'whatsapp', isOwner: true })).toBe(true);
    });

    it('does NOT treat external WhatsApp contacts as admin when no allowlist is set', () => {
        // This is the security fix: previously an unset adminUsers made everyone admin.
        expect(computeIsUserAdmin(undefined, { source: 'whatsapp', sourceId: '38582144229480@lid' })).toBe(false);
        expect(computeIsUserAdmin({}, { source: 'whatsapp', sourceId: '38582144229480@lid' })).toBe(false);
    });

    it('grants admin to explicitly listed WhatsApp contacts, matching LID or phone form', () => {
        const adminUsers = { whatsapp: ['233555505284@s.whatsapp.net'] };
        expect(computeIsUserAdmin(adminUsers, { source: 'whatsapp', sourceId: '233555505284@s.whatsapp.net' })).toBe(true);
        // Same account addressed by its LID form should still match.
        expect(computeIsUserAdmin(adminUsers, { source: 'whatsapp', sourceId: '233555505284:5@lid' })).toBe(true);
        expect(computeIsUserAdmin(adminUsers, { source: 'whatsapp', sourceId: '99999999999@lid' })).toBe(false);
    });

    it('defaults other channels to non-admin (owner-only) when no list is configured', () => {
        expect(computeIsUserAdmin(undefined, { source: 'telegram', userId: '123' })).toBe(false);
        expect(computeIsUserAdmin({}, { source: 'telegram', userId: '123' })).toBe(false);
        expect(computeIsUserAdmin(undefined, { source: 'discord', userId: '123' })).toBe(false);
    });

    it('trusts the owner web/gateway dashboard', () => {
        expect(computeIsUserAdmin(undefined, { source: 'gateway-chat', sourceId: 'local' })).toBe(true);
    });

    it('enforces explicit admin lists on non-WhatsApp channels', () => {
        const adminUsers = { telegram: ['555'] };
        expect(computeIsUserAdmin(adminUsers, { source: 'telegram', userId: '555' })).toBe(true);
        expect(computeIsUserAdmin(adminUsers, { source: 'telegram', userId: '111' })).toBe(false);
    });
});
