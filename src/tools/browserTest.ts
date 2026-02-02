import { ConfigManager } from '../config/ConfigManager';
import { WebBrowser } from './WebBrowser';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function run() {
  const args = process.argv.slice(2);
  const urlArg = args.find(a => a.startsWith('--url='));
  const url = urlArg ? urlArg.split('=')[1] : args[0];
  const wantsScreenshot = args.includes('--screenshot');
  const wantsHtml = args.includes('--html');
  const outArg = args.find(a => a.startsWith('--out='));
  const outDir = outArg ? outArg.split('=')[1] : path.join(os.homedir(), '.orcbot', 'browser-test');
  const delayArg = args.find(a => a.startsWith('--delay='));
  const delayMs = delayArg ? parseInt(delayArg.split('=')[1], 10) : 0;

  if (!url) {
    console.error('Usage: npm run browser:test -- --url=https://example.com [--screenshot] [--html] [--out=path] [--delay=ms]');
    process.exit(1);
  }

  const config = new ConfigManager();
  const browser = new WebBrowser(
    config.get('serperApiKey'),
    config.get('captchaApiKey'),
    config.get('braveSearchApiKey'),
    config.get('searxngUrl'),
    config.get('searchProviderOrder'),
    config.get('browserProfileDir'),
    config.get('browserProfileName')
  );

  try {
    const result = await browser.navigate(url);
    console.log(result);
    if (delayMs > 0) {
      await browser.wait(delayMs);
    }
    const snapshot = await browser.getSemanticSnapshot();
    console.log('\n' + snapshot);

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (wantsScreenshot && browser.page) {
      const screenshotPath = path.join(outDir, `screenshot-${timestamp}.png`);
      await browser.page.screenshot({ path: screenshotPath, type: 'png', fullPage: true });
      console.log(`\nScreenshot saved: ${screenshotPath}`);
    } else if (wantsScreenshot) {
      const fallback = await browser.screenshot();
      console.log(`\n${fallback}`);
    }

    if (wantsHtml && browser.page) {
      const html = await browser.page.content();
      const htmlPath = path.join(outDir, `page-${timestamp}.html`);
      fs.writeFileSync(htmlPath, html);
      console.log(`HTML saved: ${htmlPath}`);
    }
  } catch (e) {
    console.error('Browser test failed:', e);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
