#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/main.mjs';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(`usage: swrm [--no-open] | swrm app
  swrm           start the server and open the page in your browser
  swrm app       open swrm in its own window (no browser UI); starts the server in the background if needed
  SWRM_PORT=4141 port to listen on (127.0.0.1 only)
  SWRM_BROWSER   chromium-based browser for \`swrm app\` (default: chromium, google-chrome-stable, brave)`);
  process.exit(0);
}

const port = Number(process.env.SWRM_PORT) || 4141;

function up() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function findBrowser() {
  const names = [process.env.SWRM_BROWSER, 'chromium', 'google-chrome-stable', 'brave', 'chrome'].filter(Boolean);
  for (const n of names) {
    for (const dir of (process.env.PATH || '').split(':')) {
      if (dir && fs.existsSync(path.join(dir, n))) return n;
    }
  }
  return null;
}

// The window is a chromium --app window with its own small profile: no tabs, no address bar,
// no extensions, and it never touches the browser you use every day. The server keeps running
// after the window is closed, so chats go on (like herdr's server); the next `swrm app` reattaches.
async function openApp() {
  if (!(await up())) {
    const self = fileURLToPath(import.meta.url);
    spawn(process.execPath, ['--max-semi-space-size=1', self, '--no-open'], { detached: true, stdio: 'ignore', env: process.env }).unref();
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await up())) { console.error('swrm: server did not start'); process.exit(1); }
  }
  const browser = findBrowser();
  if (!browser) { console.error('swrm: no chromium-based browser found (set SWRM_BROWSER)'); process.exit(1); }
  const profile = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'swrm', 'app-profile');
  spawn(browser, [`--app=http://127.0.0.1:${port}`, `--user-data-dir=${profile}`, '--class=swrm', '--no-first-run', '--no-default-browser-check'],
    { detached: true, stdio: 'ignore' }).unref();
}

if (args[0] === 'app') await openApp();
else startServer({ open: !args.includes('--no-open') });
