import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'swrm');
export const DATA_DIR = path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'swrm');

export function expandHome(p) {
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

export function tildify(p) {
  if (p === HOME) return '~';
  if (p.startsWith(HOME + path.sep)) return '~' + p.slice(HOME.length);
  return p;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write through a temp file so a crash never leaves half a JSON file behind.
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function loadConfig() {
  return readJson(path.join(CONFIG_DIR, 'config.json'), {}) || {};
}

// The SDK ships its own ~330 MB claude binary. The AppImage leaves it out and runs the `claude`
// already installed on the machine; from a normal checkout this returns undefined (SDK default).
export function claudeBin() {
  try {
    createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk-linux-x64/package.json');
    return undefined;
  } catch { /* not bundled */ }
  const dirs = [...(process.env.PATH || '').split(':'), path.join(HOME, '.local', 'bin'), '/usr/local/bin', '/usr/bin'];
  for (const d of dirs) {
    const f = path.join(d, 'claude');
    if (d && fs.existsSync(f)) return f;
  }
  return undefined;
}
