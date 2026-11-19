// File search for the composer's @ mentions: paths of the chat's folder that match what was typed.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_MS = 10_000;
const MAX_FILES = 30_000;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'target']);
const cache = new Map(); // cwd -> { at, files }

function gitFiles(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'ls-files', '-co', '--exclude-standard'], { maxBuffer: 32 * 1024 * 1024, timeout: 8000 }, (err, out) => {
      if (err) return resolve(null);
      resolve(String(out).split('\n').filter(Boolean).slice(0, MAX_FILES));
    });
  });
}

// Outside git: a bounded walk that skips the usual heavy folders.
function walk(cwd) {
  const out = [];
  const stack = [['', 0]];
  while (stack.length && out.length < MAX_FILES) {
    const [rel, depth] = stack.shift(); // breadth first: shallow files come before the deep ones
    let entries = [];
    try { entries = fs.readdirSync(path.join(cwd, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < 5) stack.push([r, depth + 1]); } else if (e.isFile()) out.push(r);
    }
  }
  return out;
}

async function filesOf(cwd) {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;
  const files = (await gitFiles(cwd)) || walk(cwd);
  cache.set(cwd, { at: Date.now(), files });
  return files;
}

// Best matches first: file name starts with the query, name contains it, then the path contains it.
export async function searchFiles(cwd, query, limit = 30) {
  if (!cwd) return [];
  const files = await filesOf(cwd);
  const q = String(query || '').toLowerCase();
  if (!q) return files.slice().sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length).slice(0, limit);
  const scored = [];
  for (const f of files) {
    const low = f.toLowerCase();
    const base = low.slice(low.lastIndexOf('/') + 1);
    let score = -1;
    if (base.startsWith(q)) score = 0;
    else if (base.includes(q)) score = 1;
    else if (low.includes(q)) score = 2;
    else {
      let i = 0;
      for (const ch of base) if (ch === q[i]) i++;
      if (i === q.length && q.length >= 3) score = 3; // letters of the name in order, like a fuzzy finder
    }
    if (score >= 0) scored.push([score, f.length, f]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((s) => s[2]);
}
