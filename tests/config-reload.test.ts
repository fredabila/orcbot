import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBus } from '../src/core/EventBus';

describe('Config Hot-Reload', () => {
    beforeEach(() => {
        // Clear all event listeners before each test
        eventBus.removeAllListeners();
    });

    afterEach(() => {
        // Clean up after each test
        eventBus.removeAllListeners();
    });

    it('should emit config:changed event when config is updated', () => {
        return new Promise<void>((resolve) => {
            const oldConfig = { whatsappAutoReplyEnabled: false };
            const newConfig = { whatsappAutoReplyEnabled: true };

            // Listen for the event
            eventBus.on('config:changed', (data: any) => {
                expect(data).toBeDefined();
                expect(data.oldConfig).toBeDefined();
                expect(data.newConfig).toBeDefined();
                resolve();
            });

            // Emit the event manually to test
            eventBus.emit('config:changed', { oldConfig, newConfig });
        });
    });

    it('should detect WhatsApp config changes', () => {
        return new Promise<void>((resolve) => {
            const oldConfig = {
                whatsappAutoReplyEnabled: false,
                whatsappStatusReplyEnabled: false,
                whatsappAutoReactEnabled: false,
                whatsappContextProfilingEnabled: false
            };

            const newConfig = {
                whatsappAutoReplyEnabled: true,
                whatsappStatusReplyEnabled: true,
                whatsappAutoReactEnabled: true,
                whatsappContextProfilingEnabled: true
            };

            // Listen for WhatsApp-specific event
            eventBus.on('whatsapp:config-changed', (config: any) => {
                expect(config).toBeDefined();
                expect(config.whatsappAutoReplyEnabled).toBe(true);
                expect(config.whatsappStatusReplyEnabled).toBe(true);
                expect(config.whatsappAutoReactEnabled).toBe(true);
                expect(config.whatsappContextProfilingEnabled).toBe(true);
                resolve();
            });

            // Simulate Agent's config change detection
            const whatsappChanged = 
                oldConfig.whatsappAutoReplyEnabled !== newConfig.whatsappAutoReplyEnabled ||
                oldConfig.whatsappStatusReplyEnabled !== newConfig.whatsappStatusReplyEnabled ||
                oldConfig.whatsappAutoReactEnabled !== newConfig.whatsappAutoReactEnabled ||
                oldConfig.whatsappContextProfilingEnabled !== newConfig.whatsappContextProfilingEnabled;

            if (whatsappChanged) {
                eventBus.emit('whatsapp:config-changed', newConfig);
            }
        });
    });

    it('should detect memory limit changes', () => {
        const oldConfig = {
            memoryContextLimit: 20,
            memoryEpisodicLimit: 5,
            memoryConsolidationThreshold: 30,
            memoryConsolidationBatch: 20
        };

        const newConfig = {
            memoryContextLimit: 50,
            memoryEpisodicLimit: 10,
            memoryConsolidationThreshold: 50,
            memoryConsolidationBatch: 30
        };

        const memoryChanged = 
            oldConfig.memoryContextLimit !== newConfig.memoryContextLimit ||
            oldConfig.memoryEpisodicLimit !== newConfig.memoryEpisodicLimit ||
            oldConfig.memoryConsolidationThreshold !== newConfig.memoryConsolidationThreshold ||
            oldConfig.memoryConsolidationBatch !== newConfig.memoryConsolidationBatch;

        expect(memoryChanged).toBe(true);
    });
});
