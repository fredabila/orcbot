import { WebBrowser } from '../src/tools/WebBrowser';
import { ConfigManager } from '../src/config/ConfigManager';

async function test() {
    console.log('Testing WebBrowser with puppeteer engine...');
    const browser = new WebBrowser(
        undefined, undefined, undefined, undefined, undefined,
        undefined, 'puppeteer-test', undefined, 'puppeteer'
    );

    try {
        const navResult = await browser.navigate('https://www.google.com');
        console.log('Navigation Result:', navResult);

        const snapshot = await browser.getSemanticSnapshot();
        console.log('Snapshot (first 500 chars):');
        console.log(snapshot.slice(0, 500) + '...');

        const searchBoxRef = snapshot.match(/(?:input|combobox|textarea) .*?"Search" \[ref=(\d+)\]/i);
        if (searchBoxRef) {
            const ref = searchBoxRef[1];
            console.log(`Typing into search box (ref=${ref})...`);
            await browser.type(ref, 'Puppeteer integrated into Orcbot');
            await browser.wait(1000);
            await browser.press('Enter');
            await browser.wait(3000);
            
            const resultsSnapshot = await browser.getSemanticSnapshot();
            console.log('Results Snapshot (first 500 chars):');
            console.log(resultsSnapshot.slice(0, 500) + '...');
        } else {
            console.log('Search box not found in snapshot.');
        }

    } catch (e) {
        console.error('Test failed:', e);
    } finally {
        await browser.close();
    }
}

test();
