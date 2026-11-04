// JSON-lines logging to stdout and logs/pnn.log (LOG_DIR overrides the directory).
// log(level, msg, fields). Levels: debug | info | warn | error. Debug goes to the file only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.resolve(ROOT, process.env.LOG_DIR || 'logs');
fs.mkdirSync(DIR, { recursive: true });
export const LOG_FILE = path.join(DIR, process.env.LOG_FILE || 'pnn.log');
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
stream.on('error', (e) => console.error('log stream error', e.message));

export function log(level, msg, fields = {}) {
  let line;
  try {
    line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  } catch {
    line = JSON.stringify({ ts: new Date().toISOString(), level, msg, fields: String(fields) });
  }
  stream.write(line + '\n');
  if (level === 'debug') return;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

log.debug = (msg, f) => log('debug', msg, f);
log.info = (msg, f) => log('info', msg, f);
log.warn = (msg, f) => log('warn', msg, f);
log.error = (msg, f) => log('error', msg, f);

export default log;
