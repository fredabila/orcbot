#!/usr/bin/env node
/**
 * Minimal daemon mode test - just tests the daemonization without starting the full agent
 */

const { DaemonManager } = require('../dist/utils/daemon');
const path = require('path');
const os = require('os');

async function testDaemon() {
    console.log('🧪 Testing daemon mode functionality...\n');
    
    const testDir = path.join(os.tmpdir(), 'orcbot-daemon-manual-test');
    const daemonManager = new DaemonManager({
        pidFile: path.join(testDir, 'test.pid'),
        logFile: path.join(testDir, 'test.log'),
        dataDir: testDir
    });

    // Test 1: Check initial status
    console.log('1. Checking initial status...');
    const initialStatus = daemonManager.isRunning();
    console.log(`   Status: ${initialStatus.running ? 'Running' : 'Not running'}`);
    console.log(`   ✅ PASS\n`);

    // Test 2: Write PID file
    console.log('2. Writing PID file...');
    daemonManager.writePidFile(process.pid);
    console.log(`   ✅ PASS\n`);

    // Test 3: Check running status
    console.log('3. Checking running status...');
    const runningStatus = daemonManager.isRunning();
    console.log(`   Status: ${runningStatus.running ? 'Running' : 'Not running'} (PID: ${runningStatus.pid})`);
    if (runningStatus.running && runningStatus.pid === process.pid) {
        console.log(`   ✅ PASS\n`);
    } else {
        console.log(`   ❌ FAIL\n`);
        process.exit(1);
    }

    // Test 4: Get status string
    console.log('4. Getting status string...');
    const statusString = daemonManager.getStatus();
    console.log(`   ${statusString}`);
    console.log(`   ✅ PASS\n`);

    // Test 5: Clean up
    console.log('5. Cleaning up...');
    daemonManager.removePidFile();
    const cleanStatus = daemonManager.isRunning();
    if (!cleanStatus.running) {
        console.log(`   ✅ PASS\n`);
    } else {
        console.log(`   ❌ FAIL\n`);
        process.exit(1);
    }

    console.log('✅ All daemon functionality tests passed!\n');
}

testDaemon().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
