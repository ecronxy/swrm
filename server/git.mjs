// Git for chats, after t3code's source control: a worktree per chat (kept in the
// app's data dir like t3code's worktreesDir), the working diff split by file
// (untracked files included), commit, and push. Never touches the index except
// on commit, never force-pushes.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';

export const WORKTREES_DIR = path.join(DATA_DIR, 'worktrees');
const MAX_PATCH = 400_000; // per file, bigger diffs show as "too large"

function run(cwd, args, { timeout = 20_000, ok = [0] } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      if (!ok.includes(code)) reject(new Error((stderr || err?.message || 'git failed').trim().split('\n').slice(-3).join('\n')));
      else resolve(stdout);
    });
  });
}

export async function repoRoot(dir) {
  try { return (await run(dir, ['rev-parse', '--show-toplevel'], { timeout: 4000 })).trim(); } catch { return null; }
}

// Fixed a/ b/ prefixes, so diff.mnemonicPrefix or diff.noprefix in the user's config can't break parsing.
const PREFIX = ['--src-prefix=a/', '--dst-prefix=b/'];
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const hasHead = (root) => run(root, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
const branchOf = async (root) => (await run(root, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim()
  || (await run(root, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim();

function slug(text) {
  return String(text || 'chat').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'chat';
}

// New branch off the current HEAD, checked out in its own folder.
export async function createWorktree(dir, id, name) {
  const root = await repoRoot(dir);
  if (!root) throw new Error('Not a git repository');
  if (!(await hasHead(root))) throw new Error('the repo has no commits yet');
  const base = await branchOf(root);
  const branch = `swrm/${slug(name)}-${id.slice(0, 6)}`;
  const where = path.join(WORKTREES_DIR, `${path.basename(root)}-${id.slice(0, 8)}`);
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  await run(root, ['worktree', 'add', '-b', branch, '--', where, 'HEAD'], { timeout: 60_000 });
  return { path: where, branch, base, root };
}

// Removes the folder only when nothing is left uncommitted in it.
export async function removeWorktree(wt) {
  if (!wt?.path || !fs.existsSync(wt.path)) return { removed: true };
  const dirty = (await run(wt.path, ['status', '--porcelain']).catch(() => '')).trim();
  if (dirty) return { removed: false, reason: 'uncommitted changes' };
  await run(wt.root, ['worktree', 'remove', '--', wt.path]);
  return { removed: true };
}

function parsePatch(text) {
  const files = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: '', status: 'modified', add: 0, del: 0, lines: [] };
      const m = line.match(/ b\/(.*)$/);
      cur.path = m ? m[1] : line.slice(11);
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.status = 'added';
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (line.startsWith('rename to ')) { cur.status = 'renamed'; cur.path = line.slice(10); }
    else if (line.startsWith('Binary files')) cur.binary = true;
    else if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('index ') || line.startsWith('similarity') || line.startsWith('rename from')) continue;
    else {
      if (line.startsWith('+')) cur.add++;
      else if (line.startsWith('-')) cur.del++;
      cur.lines.push(line);
    }
  }
  for (const f of files) {
    const patch = f.lines.join('\n');
    f.patch = patch.length > MAX_PATCH ? null : patch;
    delete f.lines;
  }
  return files;
}

// Everything that differs from HEAD in the chat's folder, tracked and new files.
export async function diff(dir) {
  const root = await repoRoot(dir);
  if (!root) return { files: [], repo: false };
  const head = (await hasHead(root)) ? 'HEAD' : EMPTY_TREE;
  const tracked = await run(root, ['diff', head, ...PREFIX, '--no-color', '--no-ext-diff', '-M', '--unified=3'], { ok: [0] }).catch(() => '');
  const files = parsePatch(tracked);
  const untracked = (await run(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).slice(0, 200);
  for (const f of untracked) {
    const out = await run(root, ['diff', ...PREFIX, '--no-color', '--no-index', '--', '/dev/null', f], { ok: [0, 1] }).catch(() => '');
    const parsed = parsePatch(out)[0];
    if (parsed) files.push({ ...parsed, path: f, status: 'added' });
  }
  const branch = await branchOf(root);
  const ahead = Number((await run(root, ['rev-list', '--count', '@{u}..HEAD']).catch(() => '')).trim()) || 0;
  const upstream = !!(await run(root, ['rev-parse', '--abbrev-ref', '@{u}']).catch(() => '')).trim();
  return { files, repo: true, branch, ahead, upstream };
}

export async function commit(dir, message) {
  const msg = String(message || '').trim();
  if (!msg) throw new Error('Write a commit message');
  const root = await repoRoot(dir);
  if (!root) throw new Error('Not a git repository');
  await run(root, ['add', '-A']);
  await run(root, ['commit', '-m', msg]);
  return (await run(root, ['rev-parse', '--short', 'HEAD'])).trim();
}

export async function push(dir) {
  const root = await repoRoot(dir);
  if (!root) throw new Error('Not a git repository');
  await run(root, ['push', '-u', 'origin', 'HEAD'], { timeout: 120_000 });
}
