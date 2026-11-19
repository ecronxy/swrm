// Claude Code sessions on disk: ~/.claude*/projects/<folder>/<sessionId>.jsonl.
// Listing reads each file once and caches what it finds by mtime+size (the files can be
// hundreds of MB, so nothing is parsed twice). A transcript is parsed only when it is resumed.
// Resuming makes a swrm chat with the same sessionId: the SDK continues the session on the
// next message, nothing is sent to Claude just by resuming.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, HOME, readJson, tildify, writeJson } from './paths.mjs';
import { previewOf, resultText, titleFrom, toolDetail, toolDiff, toolSummary } from './chats.mjs';

const INDEX_FILE = path.join(DATA_DIR, 'sessions-index.json');
const SESSION_ID = /^[0-9A-Za-z-]{8,64}$/;
const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/;
const BRANCH_RE = /"gitBranch":"((?:[^"\\]|\\.)*)"/;
const MSG_ID_RE = /"id":"(msg_[A-Za-z0-9]+)"/;
const LIST_LIMIT_THINKING = 20000;
const LIST_LIMIT_OUTPUT = 3000;

let index = readJson(INDEX_FILE, {}) || {}; // file path -> { mtimeMs, size, ...scan }
let dirty = false;
let saveTimer = null;
let scanning = null;
let lastAll = []; // full entries of the last listing, for search

const unesc = (s) => { try { return JSON.parse(`"${s}"`); } catch { return s; } };

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (dirty) { dirty = false; writeJson(INDEX_FILE, index); } }, 1500);
}

// A prompt the owner typed: text of a user record, not a tool result, a local command echo or meta.
function promptOf(o) {
  if (o.isMeta || o.isSidechain) return '';
  const c = o.message?.content;
  const t = (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '').trim();
  return t && !t.startsWith('<command-') && !t.startsWith('<local-command-') ? t : '';
}

// Lines of a file as Buffer views, read in 4 MB steps so a 200 MB transcript never sits in memory whole.
// A line is only valid until the next one is asked for: copy it if it has to be kept.
function* fileLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(4 << 20);
    let carry = null;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      const data = carry ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      let pos = 0;
      for (let nl = data.indexOf(10, pos); nl >= 0; nl = data.indexOf(10, pos)) {
        yield data.subarray(pos, nl);
        pos = nl + 1;
      }
      carry = Buffer.from(data.subarray(pos));
    }
    if (carry && carry.length) yield carry;
  } finally {
    fs.closeSync(fd);
  }
}

// Reads a file once and keeps only what the list needs. Works on the raw bytes: lines are
// checked as Buffers and only the few that matter are decoded, which is what makes 3 GB of history fast.
function scanFile(file) {
  const out = { messages: 0, firstPrompt: '', firstPromptId: '', customTitle: '', cwd: '', branch: '', createdAt: 0, preview: '' };
  const msgIds = new Set();
  let prompts = 0;
  let lastText = null;
  for (const line of fileLines(file)) {
    if (line.includes('"type":"user"')) {
      if (line.includes('"tool_result"') || line.includes('"isSidechain":true') || line.includes('"isMeta":true')) continue;
      let o;
      try { o = JSON.parse(line.toString('utf8')); } catch { continue; }
      if (!out.cwd && o.cwd) out.cwd = o.cwd;
      if (!out.branch && o.gitBranch) out.branch = o.gitBranch;
      const t = promptOf(o);
      if (!t) continue;
      prompts++;
      if (!out.firstPrompt) {
        out.firstPrompt = t.slice(0, 300);
        out.firstPromptId = o.uuid || '';
        out.createdAt = Date.parse(o.timestamp) || 0;
      }
    } else if (line.includes('"type":"assistant"')) {
      if (line.includes('"isSidechain":true')) continue;
      const k = line.indexOf('"id":"msg_');
      if (k >= 0) msgIds.add(line.toString('latin1', k + 6, line.indexOf(0x22, k + 6)));
      if (line.includes('"type":"text"')) lastText = Buffer.from(line);
      if (!out.cwd && line.includes('"cwd":"')) { const c = CWD_RE.exec(line.toString('utf8')); if (c) out.cwd = unesc(c[1]); }
    } else if (line.includes('"type":"custom-title"')) {
      try { out.customTitle = JSON.parse(line.toString('utf8')).customTitle || out.customTitle; } catch {}
    }
  }
  out.messages = prompts + msgIds.size;
  if (lastText) {
    try {
      const blocks = JSON.parse(lastText.toString('utf8')).message?.content || [];
      const b = [...blocks].reverse().find((x) => x?.type === 'text' && x.text?.trim());
      if (b) out.preview = previewOf(b.text, false);
    } catch {}
  }
  return out;
}

function readdirSafe(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

// Full listing for every account. Cached files are only stat-ed; the rest are scanned, yielding between files.
async function scanAll(accounts) {
  const all = [];
  const seen = new Set();
  for (const acc of accounts.list) {
    const root = path.join(acc.dir, 'projects');
    for (const d of readdirSafe(root)) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      for (const n of readdirSafe(dir).map((x) => x.name).filter((x) => x.endsWith('.jsonl'))) {
        const file = path.join(dir, n);
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        seen.add(file);
        let e = index[file];
        if (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size) {
          try { e = index[file] = { mtimeMs: st.mtimeMs, size: st.size, ...scanFile(file) }; } catch { continue; }
          dirty = true;
          await new Promise((r) => setImmediate(r));
        }
        if (!e.firstPrompt && !e.customTitle) continue; // nothing to resume into: only snapshots or commands
        const cwd = e.cwd || HOME;
        all.push({
          id: n.slice(0, -'.jsonl'.length),
          accountId: acc.id,
          accountName: acc.name,
          folder: d.name,
          cwd,
          cwdLabel: tildify(cwd),
          title: e.customTitle || titleFrom(e.firstPrompt),
          branch: e.branch || '',
          messages: e.messages,
          createdAt: e.createdAt || st.birthtimeMs || st.mtimeMs,
          updatedAt: st.mtimeMs,
          preview: e.preview || '',
          firstPrompt: e.firstPrompt,
          firstPromptId: e.firstPromptId,
        });
      }
    }
  }
  for (const f of Object.keys(index)) if (!seen.has(f)) { delete index[f]; dirty = true; }
  if (dirty) { dirty = false; writeJson(INDEX_FILE, index); }
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  lastAll = all;
  return all;
}

// Concurrent callers share one scan.
export function listSessions(accounts) {
  if (!scanning) scanning = scanAll(accounts).finally(() => { scanning = null; });
  return scanning;
}

// Warm the cache at boot so the first search and the first list are instant.
export function warmSessions(accounts) {
  listSessions(accounts).catch(() => {});
}

// What the page gets: no prompt text, only what a row shows.
export function publicSessions(all) {
  return all.map(({ firstPrompt, firstPromptId, ...s }) => s);
}

function findFile(accounts, accountId, sessionId) {
  const acc = accounts.get(accountId);
  if (!acc) throw new Error('Unknown account');
  const root = path.join(acc.dir, 'projects');
  for (const d of readdirSafe(root)) {
    if (!d.isDirectory()) continue;
    const file = path.join(root, d.name, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// Transcript -> chat items, in the same item types chats.mjs makes while streaming.
const UUID_RE = /"uuid":"([0-9a-f-]{36})"/;
const PARENT_RE = /"parentUuid":"([0-9a-f-]{36})"/;
const LOGICAL_RE = /"logicalParentUuid":"([0-9a-f-]{36})"/; // a compaction boundary has no parent but remembers where it continues

// After a rewind the file keeps the dead branch too. The live one is the chain of parentUuid from the last message back.
// Null when the chain cannot be read, then everything is imported as before.
function liveChain(buf) {
  const parent = new Map();
  let last = '';
  let pos = 0;
  while (pos < buf.length) {
    let nl = buf.indexOf(10, pos);
    if (nl < 0) nl = buf.length;
    const line = buf.subarray(pos, nl);
    pos = nl + 1;
    if (!line.includes('"uuid":"')) continue;
    const text = line.toString('latin1');
    const u = UUID_RE.exec(text);
    if (!u) continue;
    // The chain also runs through attachment and system entries, so every entry with a uuid is recorded.
    const p = PARENT_RE.exec(text);
    const l = p ? null : LOGICAL_RE.exec(text);
    parent.set(u[1], p ? p[1] : l ? l[1] : '');
    if ((line.includes('"type":"user"') || line.includes('"type":"assistant"')) && !line.includes('"isSidechain":true')) last = u[1];
  }
  if (!last) return null;
  const keep = new Set();
  for (let id = last; id && !keep.has(id); id = parent.get(id)) keep.add(id);
  return keep.size > 0 ? keep : null;
}

export function parseTranscript(file) {
  const buf = fs.readFileSync(file);
  const items = [];
  const tools = new Map(); // tool_use id -> item, for the results that come later
  const seen = new Set();
  const outTok = new Map(); // message id -> output tokens, summed per turn
  let cwd = '';
  let turn = null; // { id, start, end } of the prompt being answered
  const close = () => {
    if (turn?.end) {
      let out = 0;
      for (const v of outTok.values()) out += v;
      items.push({ t: 'done', id: `d-${turn.id}`, ok: true, durationMs: turn.start ? Math.max(0, turn.end - turn.start) : 0, outTokens: out, inTokens: 0, tokPerSec: 0, error: '' });
    }
    turn = null;
    outTok.clear();
  };
  const keep = liveChain(buf);
  let pos = 0;
  while (pos < buf.length) {
    let nl = buf.indexOf(10, pos);
    if (nl < 0) nl = buf.length;
    const line = buf.subarray(pos, nl);
    const at = pos;
    pos = nl + 1;
    const isUser = line.includes('"type":"user"');
    if (!isUser && !line.includes('"type":"assistant"')) continue;
    if (line.includes('"isSidechain":true')) continue;
    if (keep) { const u = UUID_RE.exec(line.toString('latin1')); if (u && !keep.has(u[1])) continue; }
    let o;
    try { o = JSON.parse(line.toString('utf8')); } catch { continue; }
    if (!cwd && o.cwd) cwd = o.cwd;
    const ts = Date.parse(o.timestamp) || 0;
    if (isUser) {
      const c = o.message?.content;
      if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) {
        for (const b of c) {
          const it = b?.type === 'tool_result' && tools.get(b.tool_use_id);
          if (!it) continue;
          it.status = b.is_error ? 'error' : 'ok';
          const out = resultText(b.content);
          if (out) it.output = out.slice(0, LIST_LIMIT_OUTPUT);
        }
        continue;
      }
      const t = promptOf(o);
      const id = o.uuid || `u-${at}`;
      if (!t || seen.has(id)) continue;
      seen.add(id);
      close();
      items.push({ t: 'user', id, text: t, ts });
      turn = { id, start: ts, end: 0 };
      continue;
    }
    const msg = o.message || {};
    if (turn) {
      if (ts) turn.end = ts;
      if (msg.id) outTok.set(msg.id, Number(msg.usage?.output_tokens) || 0);
    }
    (Array.isArray(msg.content) ? msg.content : []).forEach((b, i) => {
      const id = `${o.uuid || at}:${i}`;
      if (seen.has(id)) return;
      if (b?.type === 'text' && b.text?.trim()) {
        seen.add(id);
        items.push({ t: 'text', id, text: b.text, live: false });
      } else if (b?.type === 'thinking' && b.thinking) {
        seen.add(id);
        items.push({ t: 'thinking', id, text: b.thinking.slice(-LIST_LIMIT_THINKING), live: false, durationMs: 0 });
      } else if (b?.type === 'tool_use' && b.id && !tools.has(b.id)) {
        const input = b.input || {};
        const it = { t: 'tool', id: b.id, name: b.name, detail: toolDetail(b.name, input), summary: toolSummary(b.name, input), diff: toolDiff(b.name, input), status: 'stopped' };
        tools.set(b.id, it);
        items.push(it);
      }
    });
  }
  close();
  return { items, cwd };
}

// Opens a session as a swrm chat. A session that is already open in swrm is not duplicated.
// A session another Claude Code process is running right now: resuming it would give the transcript two writers.
function liveElsewhere(accounts, sessionId) {
  for (const acc of accounts.list) {
    const dir = path.join(acc.dir, 'sessions');
    for (const d of readdirSafe(dir)) {
      if (!d.name.endsWith('.json')) continue;
      try {
        const info = JSON.parse(fs.readFileSync(path.join(dir, d.name), 'utf8'));
        if (info.sessionId !== sessionId || !info.pid || info.pid === process.pid) continue;
        process.kill(info.pid, 0); // throws when the process is gone
        return info.pid;
      } catch {}
    }
  }
  return 0;
}

export function resumeSession({ accounts, chats, accountId, sessionId }) {
  if (!SESSION_ID.test(String(sessionId || ''))) throw new Error('Not a session id');
  const open = [...chats.chats.values()].find((c) => c.meta.sessionId === sessionId);
  if (open) return { type: 'resumed', chat: open.meta, existing: true };
  const file = findFile(accounts, accountId, sessionId);
  if (!file) throw new Error('Session file not found on disk');
  const pid = liveElsewhere(accounts, sessionId);
  if (pid) throw new Error(`This session is open in another Claude Code right now (pid ${pid}). Close it there first, two writers would tangle the history.`);
  const e = index[file] || scanFile(file);
  const { items, cwd } = parseTranscript(file);
  const meta = chats.create({
    accountId,
    cwd: e.cwd || cwd || HOME,
    sessionId,
    name: e.customTitle || titleFrom(e.firstPrompt),
    preview: e.preview || '',
    items,
  });
  return { type: 'resumed', chat: meta, existing: false };
}

// Text around the match, with the match itself kept apart so the page can mark it without HTML.
function snippet(text, at, len) {
  const s = Math.max(0, at - 40);
  const e = Math.min(text.length, at + len + 90);
  const flat = (x) => x.replace(/\s+/g, ' ');
  return {
    before: (s > 0 ? '…' : '') + flat(text.slice(s, at)),
    match: flat(text.slice(at, at + len)),
    after: flat(text.slice(at + len, e)) + (e < text.length ? '…' : ''),
  };
}

// Search over swrm chats (every message) and over session titles and first prompts from the cache.
// Full text of the session files is not searched: that would read gigabytes per keystroke.
export function searchAll({ chats, q }) {
  const needle = String(q || '').trim().slice(0, 100).toLowerCase();
  if (needle.length < 2) return [];
  const LIMIT = 60;
  const out = [];
  const sorted = [...chats.chats.values()].sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  for (const c of sorted) {
    let ts = c.meta.createdAt || 0;
    let hits = 0;
    for (const it of c.items) {
      if (it.t === 'user') ts = it.ts || ts;
      if (it.t !== 'user' && it.t !== 'text') continue;
      const text = it.text || '';
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      out.push({ kind: 'chat', chatId: c.meta.id, chatName: c.meta.name || 'New chat', itemId: it.id, ts, ...snippet(text, at, needle.length) });
      if (++hits >= 3 || out.length >= LIMIT) break;
    }
    if (out.length >= LIMIT) break;
  }
  const open = new Set([...chats.chats.values()].map((c) => c.meta.sessionId).filter(Boolean));
  for (const s of lastAll) {
    if (out.length >= LIMIT) break;
    if (open.has(s.id)) continue;
    let text = s.title;
    let at = text.toLowerCase().indexOf(needle);
    if (at < 0) { text = s.firstPrompt || ''; at = text.toLowerCase().indexOf(needle); }
    if (at < 0 || !s.firstPromptId) continue;
    out.push({ kind: 'session', accountId: s.accountId, sessionId: s.id, chatName: s.title, cwdLabel: s.cwdLabel, itemId: s.firstPromptId, ts: s.updatedAt, ...snippet(text, at, needle.length) });
  }
  return out;
}
