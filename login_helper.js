const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');

chromium.use(stealth());

const log = require('./logger');

async function loginManual() {
  const userDataDir = path.join(__dirname, 'user_data');
  log.info(`Launching browser at: ${userDataDir}`);
  
  // We use standard 'playwright' but with specific flags to hide automation
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome', 
    viewport: null,
    // This is the CRITICAL part: it removes the 'controlled by automation' flag
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });

  const page = await context.newPage();
  
  // Go to NotebookLM instead of accounts.google.com
  await page.goto('https://notebooklm.google.com/');

  log.info("PLEASE CLICK 'SIGN IN' AND LOG IN MANUALLY.");
  log.info('ONCE YOU ARE AT THE NOTEBOOKLM DASHBOARD, CLOSE THE BROWSER.');

  await new Promise((resolve) => {
    context.on('close', resolve);
  });

  log.success('Session saved!');
}

loginManual();
