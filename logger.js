const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'automation.log');

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'INFO'] ?? LEVELS.INFO;

function formatTimestamp() {
  return new Date().toISOString();
}

function writeLog(level, icon, ...args) {
  if (LEVELS[level] < currentLevel) return;
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level}]`;
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');

  // Console output (with emoji)
  console.log(`${prefix} ${icon} ${message}`);

  // File output (without emoji for cleaner logs)
  fs.appendFileSync(LOG_FILE, `${prefix} ${message}\n`);
}

const log = {
  debug: (...args) => writeLog('DEBUG', '🔧', ...args),
  info:  (...args) => writeLog('INFO',  '📋', ...args),
  warn:  (...args) => writeLog('WARN',  '⚠️', ...args),
  error: (...args) => writeLog('ERROR', '❌', ...args),
  step:  (n, msg) => writeLog('INFO',  '🚀', `Step ${n}: ${msg}`),
  success: (...args) => writeLog('INFO', '✅', ...args),
};

module.exports = log;
