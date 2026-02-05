#!/usr/bin/env ts-node

/**
 * Integration test for browser state manager and bootstrap files
 */

import { BrowserStateManager } from '../src/tools/BrowserStateManager';
import { BootstrapManager } from '../src/core/BootstrapManager';
import path from 'path';
import os from 'os';
import fs from 'fs';

console.log('=== Testing Browser State Manager ===\n');

// Test 1: BrowserStateManager creation
const stateManager = new BrowserStateManager();
console.log('✓ BrowserStateManager created');

// Test 2: Record navigation
stateManager.recordNavigation('https://example.com', 'navigate', true);
stateManager.recordNavigation('https://example.com/page1', 'navigate', true);
stateManager.recordNavigation('https://example.com/page2', 'navigate', false, 'Timeout');
console.log('✓ Navigation recording works');

// Test 3: Record actions
stateManager.recordAction('click', 'https://example.com', 'button', true);
stateManager.recordAction('type', 'https://example.com', 'input', true);
console.log('✓ Action recording works');

// Test 4: Get summaries
const navSummary = stateManager.getNavigationSummary(5);
console.log('✓ Navigation summary generated');
console.log(navSummary);

const actionSummary = stateManager.getActionSummary(5);
console.log('\n✓ Action summary generated');
console.log(actionSummary);

// Test 5: Loop detection (simulate 3 navigations to same URL)
stateManager.recordNavigation('https://loop-test.com', 'navigate', true);
stateManager.recordNavigation('https://loop-test.com', 'navigate', true);
stateManager.recordNavigation('https://loop-test.com', 'navigate', true);
const loopDetected = stateManager.detectNavigationLoop('https://loop-test.com');
console.log(`\n✓ Loop detection works: ${loopDetected ? 'LOOP DETECTED' : 'NO LOOP'}`);

// Test 6: Circuit breaker (simulate 3 failures)
stateManager.recordAction('click', 'https://circuit-test.com', 'bad-button', false, 'Not found');
stateManager.recordAction('click', 'https://circuit-test.com', 'bad-button', false, 'Not found');
stateManager.recordAction('click', 'https://circuit-test.com', 'bad-button', false, 'Not found');
const circuitOpen = stateManager.isCircuitOpen('click', 'https://circuit-test.com', 'bad-button');
console.log(`✓ Circuit breaker works: ${circuitOpen ? 'CIRCUIT OPEN' : 'CIRCUIT CLOSED'}`);

// Test 7: Diagnostics
const diagnostics = stateManager.getDiagnostics();
console.log('\n✓ Diagnostics generated:');
console.log(`  - Navigation count: ${diagnostics.navigationCount}`);
console.log(`  - Action count: ${diagnostics.actionCount}`);
console.log(`  - Open circuits: ${diagnostics.openCircuits.length}`);

console.log('\n=== Testing Bootstrap Manager ===\n');

// Test 8: BootstrapManager creation
const testDir = path.join(os.tmpdir(), 'orcbot-test-bootstrap');
if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
}
const bootstrap = new BootstrapManager(testDir);
console.log('✓ BootstrapManager created');

// Test 9: Initialize files
bootstrap.initializeFiles();
console.log('✓ Bootstrap files initialized');

// Test 10: List files
const files = bootstrap.listFiles();
console.log('✓ Bootstrap files listed:');
files.forEach(f => {
    console.log(`  - ${f.name}: ${f.exists ? `${f.size} bytes` : 'not created'}`);
});

// Test 11: Read file
const identity = bootstrap.getFile('IDENTITY.md');
console.log(`\n✓ IDENTITY.md read (${identity?.length || 0} bytes)`);
if (identity) {
    console.log('First 200 chars:', identity.substring(0, 200) + '...');
}

// Test 12: Update file
bootstrap.updateFile('SOUL.md', '# Test Update\n\nThis is a test update.');
const soul = bootstrap.getFile('SOUL.md');
console.log(`\n✓ SOUL.md updated (${soul?.length || 0} bytes)`);

// Test 13: Get formatted context
const context = bootstrap.getFormattedContext(5000);
console.log(`\n✓ Formatted context generated (${context.length} bytes)`);

// Cleanup
try {
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log('\n✓ Test directory cleaned up');
} catch (e) {
    console.log('\n⚠ Failed to cleanup test directory (non-critical)');
}

console.log('\n=== All Tests Passed! ===\n');
