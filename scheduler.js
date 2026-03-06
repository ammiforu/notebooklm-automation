const { CronJob } = require('cron');
const { execFile } = require('child_process');
const path = require('path');
const log = require('./logger');
require('dotenv').config();

const SCHEDULE = process.env.CRON_SCHEDULE || '0 8 * * *'; // Default: every day at 8:00 AM

function runBot() {
  log.info(`Scheduled run triggered at ${new Date().toISOString()}`);
  const botPath = path.join(__dirname, 'bot.js');

  const child = execFile('node', [botPath], { cwd: __dirname }, (error, stdout, stderr) => {
    if (error) {
      log.error('Bot run failed:', error.message);
    }
    if (stderr) {
      log.warn('Bot stderr:', stderr);
    }
  });

  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
}

log.info(`Scheduler started. Cron: "${SCHEDULE}"`);
log.info('Next run will happen at the scheduled time. Press Ctrl+C to stop.');

const job = new CronJob(SCHEDULE, runBot, null, true, Intl.DateTimeFormat().resolvedOptions().timeZone);

// Also allow a one-time immediate run with --now flag
if (process.argv.includes('--now')) {
  log.info('--now flag detected, running immediately...');
  runBot();
}
