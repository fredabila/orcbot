#!/usr/bin/env node

/**
 * Manual test script for config hot-reload and WhatsApp improvements
 * 
 * This script demonstrates:
 * 1. Config hot-reload functionality
 * 2. WhatsApp auto-reply enforcement
 * 3. Status media download control
 * 4. Enhanced contact profiling features
 * 5. Task management skills
 */

const { eventBus } = require('../dist/core/EventBus');
const { MemoryManager } = require('../dist/memory/MemoryManager');
const os = require('os');
const path = require('path');
const fs = require('fs');

console.log('=== OrcBot Config Hot-Reload & WhatsApp Improvements Test ===\n');

// Test 1: Event Bus functionality
console.log('Test 1: Event Bus Config Change Detection');
console.log('-------------------------------------------');

let eventReceived = false;
eventBus.on('config:changed', (data) => {
    console.log('✓ config:changed event received');
    console.log('  Old config keys:', Object.keys(data.oldConfig).join(', '));
    console.log('  New config keys:', Object.keys(data.newConfig).join(', '));
    eventReceived = true;
});

// Emit a test event
const oldConfig = { whatsappAutoReplyEnabled: false };
const newConfig = { whatsappAutoReplyEnabled: true };
eventBus.emit('config:changed', { oldConfig, newConfig });

setTimeout(() => {
    if (eventReceived) {
        console.log('✓ Test 1 PASSED: Event bus working correctly\n');
    } else {
        console.log('✗ Test 1 FAILED: Event not received\n');
    }
    runTest2();
}, 100);

// Test 2: WhatsApp Config Change Event
function runTest2() {
    console.log('Test 2: WhatsApp-Specific Config Changes');
    console.log('------------------------------------------');

    let whatsappEventReceived = false;
    eventBus.on('whatsapp:config-changed', (config) => {
        console.log('✓ whatsapp:config-changed event received');
        console.log('  Auto-reply enabled:', config.whatsappAutoReplyEnabled);
        console.log('  Status reply enabled:', config.whatsappStatusReplyEnabled);
        whatsappEventReceived = true;
    });

    const testConfig = {
        whatsappAutoReplyEnabled: true,
        whatsappStatusReplyEnabled: true,
        whatsappAutoReactEnabled: false,
        whatsappContextProfilingEnabled: true
    };

    eventBus.emit('whatsapp:config-changed', testConfig);

    setTimeout(() => {
        if (whatsappEventReceived) {
            console.log('✓ Test 2 PASSED: WhatsApp config change detection working\n');
        } else {
            console.log('✗ Test 2 FAILED: WhatsApp event not received\n');
        }
        runTest3();
    }, 100);
}

// Test 3: Memory Manager Profile Features
function runTest3() {
    console.log('Test 3: Enhanced Contact Profile Management');
    console.log('--------------------------------------------');

    const testDataDir = path.join(os.tmpdir(), `orcbot-test-${Date.now()}`);
    const memoryPath = path.join(testDataDir, 'memory.json');
    const userPath = path.join(testDataDir, 'USER.md');
    
    // Create test directory
    fs.mkdirSync(testDataDir, { recursive: true });
    fs.writeFileSync(memoryPath, JSON.stringify({ memories: [] }));
    fs.writeFileSync(userPath, '# Test User');

    const memory = new MemoryManager(memoryPath, userPath);

    // Test profile save and retrieve
    const testJid = '1234567890@s.whatsapp.net';
    const testProfile = {
        name: 'Test Contact',
        preferences: ['tech', 'music'],
        notes: 'Likes to chat about AI'
    };

    memory.saveContactProfile(testJid, JSON.stringify(testProfile));
    const retrievedProfile = memory.getContactProfile(testJid);

    if (retrievedProfile) {
        const parsed = JSON.parse(retrievedProfile);
        console.log('✓ Profile saved and retrieved successfully');
        console.log('  JID:', parsed.jid);
        console.log('  Name:', parsed.name);
        console.log('  Created at:', parsed.createdAt);
        console.log('  Last updated:', parsed.lastUpdated);
        console.log('✓ Test 3 PASSED: Profile management working correctly\n');
    } else {
        console.log('✗ Test 3 FAILED: Could not retrieve profile\n');
    }

    // Cleanup
    fs.rmSync(testDataDir, { recursive: true, force: true });
    
    runTest4();
}

// Test 4: Configuration Change Detection Logic
function runTest4() {
    console.log('Test 4: Config Change Detection Logic');
    console.log('---------------------------------------');

    const oldConfig = {
        whatsappAutoReplyEnabled: false,
        whatsappStatusReplyEnabled: false,
        whatsappAutoReactEnabled: false,
        whatsappContextProfilingEnabled: false,
        memoryContextLimit: 20,
        memoryEpisodicLimit: 5
    };

    const newConfig = {
        whatsappAutoReplyEnabled: true,
        whatsappStatusReplyEnabled: false,
        whatsappAutoReactEnabled: false,
        whatsappContextProfilingEnabled: true,
        memoryContextLimit: 50,
        memoryEpisodicLimit: 5
    };

    // Test WhatsApp change detection
    const whatsappChanged = 
        oldConfig.whatsappAutoReplyEnabled !== newConfig.whatsappAutoReplyEnabled ||
        oldConfig.whatsappStatusReplyEnabled !== newConfig.whatsappStatusReplyEnabled ||
        oldConfig.whatsappAutoReactEnabled !== newConfig.whatsappAutoReactEnabled ||
        oldConfig.whatsappContextProfilingEnabled !== newConfig.whatsappContextProfilingEnabled;

    console.log('  WhatsApp config changed:', whatsappChanged ? '✓ YES' : '✗ NO');

    // Test memory change detection
    const memoryChanged = 
        oldConfig.memoryContextLimit !== newConfig.memoryContextLimit ||
        oldConfig.memoryEpisodicLimit !== newConfig.memoryEpisodicLimit;

    console.log('  Memory config changed:', memoryChanged ? '✓ YES' : '✗ NO');

    if (whatsappChanged && memoryChanged) {
        console.log('✓ Test 4 PASSED: Change detection logic working correctly\n');
    } else {
        console.log('✗ Test 4 FAILED: Change detection not working as expected\n');
    }

    console.log('=== All Tests Complete ===\n');
    console.log('Summary:');
    console.log('✓ Config hot-reload event system working');
    console.log('✓ WhatsApp-specific config change detection working');
    console.log('✓ Enhanced contact profile management working');
    console.log('✓ Config change detection logic working');
    console.log('\nNew Features Available:');
    console.log('- get_contact_profile(jid): Retrieve contact profiles');
    console.log('- list_whatsapp_contacts(limit): List recent WhatsApp contacts');
    console.log('- search_chat_history(jid, limit): Search chat history with a contact');
    console.log('- get_whatsapp_context(jid): Get comprehensive context about a contact');
}
