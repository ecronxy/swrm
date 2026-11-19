// Every chat is one Claude Code session driven through the Agent SDK.
// The SDK spawns the real `claude` binary with the chat's account dir, so skills,
// CLAUDE.md, MCP servers and settings load exactly like in the terminal.
// Idle chats close their process and resume by session id on the next message.
import { query, forkSession } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, HOME, claudeBin, expandHome, readJson, tildify, writeJson } from './paths.mjs';
import * as gitops from './git.mjs';
import * as att from './attachments.mjs';
import { TaskRegistry, taskView } from './tasks.mjs';
import { fetchMcp, mcpAction } from './mcp.mjs';
import { readRules, removeRule } from './rules.mjs';

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const uid = () => crypto.randomUUID();
// Where the agent works: its own worktree once one exists, the project folder otherwise.
const workdir = (meta) => (meta.worktree?.path && fs.existsSync(meta.worktree.path) ? meta.worktree.path : meta.cwd);
// Shared with sessions.mjs, so an imported transcript looks like a live one.
export { previewOf, resultText, titleFrom, toolDetail, toolDiff, toolSummary };

class InputQueue {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(m) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: m, done: false });
    else this.items.push(m);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

// A saved or copied item from a process that is gone: nothing in it can still be running.
function settle(it) {
  if (it.t === 'perm' && it.state === 'pending') return { ...it, state: 'cancelled' };
  if (it.t === 'tool' && it.status === 'running') return { ...it, status: 'stopped' };
  if (it.t === 'tool' && it.task && it.task.status === 'running') return { ...it, task: { ...it.task, status: 'stopped' } };
  if ((it.t === 'text' || it.t === 'thinking') && it.live) return { ...it, live: false };
  return it;
}

// The SDK keeps the transcript per account dir, and forkSession reads that dir from the environment.
async function withAccountDir(acc, fn) {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = acc.dir;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
}

const base = (p) => String(p || '').split('/').filter(Boolean).pop() || String(p || '');
const lines = (s) => (s ? String(s).split('\n').length : 0);

function toolSummary(name, i = {}) {
  switch (name) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': return base(i.file_path);
    case 'NotebookEdit': case 'NotebookRead': return base(i.notebook_path);
    case 'Bash': return String(i.command || '').split('\n')[0].slice(0, 200);
    case 'Grep': case 'Glob': return String(i.pattern || '');
    case 'WebFetch': return String(i.url || '');
    case 'WebSearch': return String(i.query || '');
    case 'Task': case 'Agent': return String(i.description || i.subagent_type || '');
    case 'Skill': return String(i.skill || i.command || i.name || '');
    case 'TodoWrite': return `${(i.todos || []).length} items`;
    default: return '';
  }
}

// What a tool was asked to do, for the expanded row: a command, a diff, a pattern. Capped so history stays light.
function prefixed(text, mark, max = 30) {
  const ls = String(text || '').split('\n');
  const out = ls.slice(0, max).map((l) => `${mark} ${l}`.slice(0, 300));
  if (ls.length > max) out.push(`${mark} … ${ls.length - max} more lines`);
  return out;
}
function toolDetail(name, i = {}) {
  switch (name) {
    case 'Bash': return { kind: 'code', text: String(i.command || '').slice(0, 1500) };
    case 'Edit': return { kind: 'diff', text: [...prefixed(i.old_string, '-'), ...prefixed(i.new_string, '+')].join('\n') };
    case 'MultiEdit': return { kind: 'diff', text: (i.edits || []).slice(0, 6).flatMap((e) => [...prefixed(e.old_string, '-', 12), ...prefixed(e.new_string, '+', 12)]).join('\n') };
    case 'Write': return { kind: 'diff', text: prefixed(i.content, '+', 40).join('\n') };
    case 'Read': return { kind: 'text', text: [i.file_path, i.offset ? `from line ${i.offset}` : '', i.limit ? `${i.limit} lines` : ''].filter(Boolean).join(' · ') };
    case 'Grep': return { kind: 'text', text: [i.pattern, i.path && `in ${i.path}`, i.glob && `glob ${i.glob}`].filter(Boolean).join(' · ') };
    case 'Glob': return { kind: 'text', text: [i.pattern, i.path && `in ${i.path}`].filter(Boolean).join(' · ') };
    case 'WebFetch': return { kind: 'text', text: [i.url, i.prompt].filter(Boolean).join('\n') };
    case 'WebSearch': return { kind: 'text', text: String(i.query || '') };
    case 'TodoWrite': return { kind: 'text', text: (i.todos || []).map((t) => `${t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]'} ${t.content}`).join('\n').slice(0, 1500) };
    case 'Task': case 'Agent': return { kind: 'text', text: String(i.prompt || i.description || '').slice(0, 1500) };
    default: { let t = ''; try { t = JSON.stringify(i, null, 1); } catch {} return { kind: 'code', text: t.slice(0, 1200) }; }
  }
}

function toolDiff(name, i = {}) {
  if (name === 'Edit') return { add: lines(i.new_string), del: lines(i.old_string) };
  if (name === 'MultiEdit') {
    return (i.edits || []).reduce((d, e) => ({ add: d.add + lines(e.new_string), del: d.del + lines(e.old_string) }), { add: 0, del: 0 });
  }
  if (name === 'Write') return { add: lines(i.content), del: 0 };
  return null;
}

function activityOf(name, i = {}) {
  switch (name) {
    case 'Read': return `reading ${base(i.file_path)}`;
    case 'Edit': case 'MultiEdit': case 'Write': return `editing ${base(i.file_path)}`;
    case 'Bash': return `running ${String(i.command || '').trim().split(/\s+/)[0] || 'command'}`;
    case 'Grep': case 'Glob': return 'searching';
    case 'WebFetch': case 'WebSearch': return 'browsing';
    case 'Task': case 'Agent': return 'running an agent';
    case 'Skill': return `using ${i.skill || 'a skill'}`;
    case 'TodoWrite': return 'planning';
    default: return name.startsWith('mcp__') ? name.split('__').slice(1).join(' ') : name;
  }
}

function permDetail(name, i = {}) {
  if (name === 'Bash') return String(i.command || '').slice(0, 4000);
  if (i.file_path) return tildify(String(i.file_path));
  if (name === 'WebFetch') return String(i.url || '');
  try { return JSON.stringify(i, null, 2).slice(0, 1500); } catch { return ''; }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === 'text' ? c.text : '')).join('\n');
  return '';
}

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 4000 }, (err, out) => resolve(err ? null : out.trim()));
  });
}

async function gitInfo(cwd) {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch) return null;
  const stat = (await git(cwd, ['diff', 'HEAD', '--shortstat'])) || '';
  return {
    branch,
    add: Number(stat.match(/(\d+) insertion/)?.[1] || 0),
    del: Number(stat.match(/(\d+) deletion/)?.[1] || 0),
  };
}

function titleFrom(text) {
  const first = String(text).trim().split('\n')[0].trim();
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()}...` : first || 'New chat';
}

// One line for the chat list: markdown stripped, like a messenger preview.
function previewOf(text, mine) {
  const line = String(text || '').replace(/```[\s\S]*?```/g, ' code ').replace(/[#*_`>|~\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return mine ? `You: ${line}` : line;
}

// "Allow in this chat" must not turn one approved command into every command: Bash is keyed by the exact command.
const allowKey = (name, input) => (name === 'Bash' ? `Bash:${String(input?.command || '')}` : name);

export class Chats {
  constructor({ accounts, config, broadcast }) {
    this.accounts = accounts;
    this.config = config;
    this.broadcast = broadcast;
    this.idleMs = (Number(config.idleMinutes) || 3) * 60_000;
    this.chats = new Map(); // id -> { meta, items, rt }
    this.models = {}; // accountId -> [{value, label}]
    this.commands = {}; // accountId -> [{name, description, argumentHint}] (slash commands and skills)
    setInterval(() => this.#wakeDue(), 15_000).unref();
    const saved = readJson(STATE_FILE, {}) || {};
    this.spaces = (saved.spaces?.length ? saved.spaces : [HOME]).filter((p) => fs.existsSync(p));
    if (!this.spaces.length) this.spaces = [HOME];
    this.settings = {
      defaultAccount: saved.settings?.defaultAccount || config.defaultAccount || '',
      defaultMode: saved.settings?.defaultMode || config.defaultMode || 'default',
      defaultModel: saved.settings?.defaultModel || '',
      defaultEffort: EFFORTS.includes(saved.settings?.defaultEffort) ? saved.settings.defaultEffort : '',
    };
    for (const meta of saved.chats || []) {
      const items = (readJson(path.join(CHATS_DIR, `${meta.id}.json`), []) || []).map(settle);
      this.chats.set(meta.id, {
        meta: { ...meta, status: 'idle', activity: '', pending: 0, turnStartedAt: 0, queued: meta.queued || [] },
        items,
        rt: { ...this.#runtime(), queue: (meta.queued || []).map((q) => ({ id: q.id, text: q.text, refs: q.refs || [] })) },
      });
    }
    // Messages that were waiting when swrm went down go out now, as they were meant to.
    setTimeout(() => { for (const c of this.chats.values()) if (c.rt.queue.length) this.#drain(c); }, 2000);
  }

  #runtime() {
    return { q: null, input: null, loop: null, perms: new Map(), allowed: new Set(), live: new Map(), curMsg: '', dirty: new Map(), flush: null, idle: null, save: null, metaDirty: false, queue: [], tasks: new TaskRegistry(), lastUuid: '' };
  }

  snapshot() {
    return {
      type: 'snapshot',
      chats: [...this.chats.values()].map((c) => c.meta),
      spaces: this.spaces.map((p) => ({ path: p, label: tildify(p) })),
      settings: this.settings,
      models: this.models,
      commands: this.commands,
    };
  }

  history(id) {
    const c = this.chats.get(id);
    return c ? { type: 'history', id, items: c.items } : null;
  }

  // ---- persistence -------------------------------------------------------

  #saveState() {
    clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => this.saveStateNow(), 500);
  }

  saveStateNow() {
    clearTimeout(this.stateTimer);
    writeJson(STATE_FILE, {
      spaces: this.spaces,
      settings: this.settings,
      chats: [...this.chats.values()].map((c) => ({ ...c.meta, mcp: undefined })), // MCP status is live, never saved
    });
  }

  #saveItems(c) {
    clearTimeout(c.rt.save);
    c.rt.save = setTimeout(() => writeJson(path.join(CHATS_DIR, `${c.meta.id}.json`), c.items), 800);
  }

  flushAll() {
    for (const c of this.chats.values()) {
      if (c.rt.save) {
        clearTimeout(c.rt.save);
        writeJson(path.join(CHATS_DIR, `${c.meta.id}.json`), c.items);
      }
    }
    this.saveStateNow();
  }

  // ---- broadcasting (batched so streaming text costs one frame per 40ms) --

  #touch(c, item) {
    c.rt.dirty.set(item.id, item);
    this.#schedule(c);
  }

  #metaChanged(c) {
    c.rt.metaDirty = true;
    this.#schedule(c);
  }

  #schedule(c) {
    if (c.rt.flush) return;
    c.rt.flush = setTimeout(() => {
      c.rt.flush = null;
      if (c.rt.dirty.size) {
        this.broadcast({ type: 'items', id: c.meta.id, items: [...c.rt.dirty.values()] });
        c.rt.dirty.clear();
        this.#saveItems(c);
      }
      if (c.rt.metaDirty) {
        c.rt.metaDirty = false;
        this.broadcast({ type: 'chat', chat: c.meta });
        this.#saveState();
      }
    }, 40);
  }

  #push(c, item) {
    c.items.push(item);
    this.#touch(c, item);
    return item;
  }

  #find(c, id) {
    for (let i = c.items.length - 1; i >= 0; i--) if (c.items[i].id === id) return c.items[i];
    return null;
  }

  #setStatus(c, patch) {
    Object.assign(c.meta, patch, { updatedAt: Date.now() });
    // A snoozed chat that needs the owner comes back right away.
    if (c.meta.snoozedUntil && (patch.status === 'approval' || patch.status === 'error')) c.meta.snoozedUntil = 0;
    this.#metaChanged(c);
  }

  // ---- spaces & settings -------------------------------------------------

  addSpace(p) {
    const abs = path.resolve(expandHome(String(p || '').trim()));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`No such folder: ${tildify(abs)}`);
    if (!this.spaces.includes(abs)) this.spaces.push(abs);
    this.#broadcastSpaces();
    return abs;
  }

  removeSpace(p) {
    if (this.spaces.length <= 1) return;
    this.spaces = this.spaces.filter((s) => s !== p);
    this.#broadcastSpaces();
  }

  #broadcastSpaces() {
    this.broadcast({ type: 'spaces', spaces: this.spaces.map((p) => ({ path: p, label: tildify(p) })) });
    this.#saveState();
  }

  setSettings(patch) {
    if (patch.defaultMode && MODES.includes(patch.defaultMode)) this.settings.defaultMode = patch.defaultMode;
    if (patch.defaultAccount && this.accounts.get(patch.defaultAccount)) this.settings.defaultAccount = patch.defaultAccount;
    this.broadcast({ type: 'settings', settings: this.settings });
    this.#saveState();
  }

  // ---- chat lifecycle ----------------------------------------------------

  // sessionId + items: resuming a Claude Code session from disk (see sessions.mjs).
  create({ accountId, cwd, useWorktree, sessionId = '', name = '', items = [], preview = '' }) {
    const acc = this.accounts.get(accountId);
    if (!acc) throw new Error('Unknown account');
    const dir = this.addSpace(cwd || this.spaces[0]);
    const now = Date.now();
    const meta = {
      id: uid(),
      name,
      accountId,
      cwd: dir,
      cwdLabel: tildify(dir),
      sessionId,
      preview,
      model: this.settings.defaultModel,
      effort: this.settings.defaultEffort,
      mode: this.settings.defaultMode,
      status: 'idle',
      activity: '',
      pending: 0,
      unread: false,
      createdAt: now,
      updatedAt: now,
      turnStartedAt: 0,
      git: null,
      useWorktree: !!useWorktree,
      queued: [],
      worktree: null,
      workdir: dir,
    };
    const c = { meta, items, rt: this.#runtime() };
    this.chats.set(meta.id, c);
    if (items.length) this.#saveItems(c);
    this.settings.defaultAccount = accountId;
    this.broadcast({ type: 'settings', settings: this.settings });
    this.#metaChanged(c);
    this.#refreshGit(c);
    return meta;
  }

  async remove(id) {
    const c = this.chats.get(id);
    if (!c) return;
    this.#stop(c);
    c.rt.removed = true;
    if (c.rt.wt) await c.rt.wt.catch(() => {}); // a worktree still being made would be left behind
    // A fork shares its source's worktree: the folder goes only with the last chat that uses it.
    const shared = [...this.chats.values()].some((o) => o !== c && o.meta.worktree?.path && o.meta.worktree.path === c.meta.worktree?.path);
    if (c.meta.worktree && !shared) {
      const r = await gitops.removeWorktree(c.meta.worktree).catch((e) => ({ removed: false, reason: e.message }));
      if (!r.removed) this.broadcast({ type: 'toast', kind: 'info', text: `Worktree kept: ${r.reason}`, description: tildify(c.meta.worktree.path) });
    }
    clearTimeout(c.rt.save);
    clearTimeout(c.rt.flush);
    this.chats.delete(id);
    fs.rm(path.join(CHATS_DIR, `${id}.json`), { force: true }, () => {});
    att.removeChat(id);
    this.broadcast({ type: 'chatRemoved', id });
    this.#saveState();
  }

  rename(id, name) {
    const c = this.chats.get(id);
    if (!c) return;
    c.meta.name = String(name || '').trim().slice(0, 120) || c.meta.name;
    this.#metaChanged(c);
  }

  seen(id) {
    const c = this.chats.get(id);
    if (c?.meta.unread) {
      c.meta.unread = false;
      this.#metaChanged(c);
    }
  }

  async setModel(id, model) {
    const c = this.chats.get(id);
    if (!c) return;
    c.meta.model = String(model || '');
    this.settings.defaultModel = c.meta.model; // the next new chat starts with the same model
    this.broadcast({ type: 'settings', settings: this.settings });
    this.#saveState();
    this.#metaChanged(c);
    if (c.rt.q) await c.rt.q.setModel(c.meta.model || undefined).catch(() => {});
  }

  async setEffort(id, effort) {
    const c = this.chats.get(id);
    if (!c) return;
    c.meta.effort = EFFORTS.includes(effort) ? effort : '';
    this.settings.defaultEffort = c.meta.effort; // same for effort
    this.broadcast({ type: 'settings', settings: this.settings });
    this.#saveState();
    this.#metaChanged(c);
    if (c.rt.q) await c.rt.q.applyFlagSettings({ effortLevel: c.meta.effort || null }).catch(() => {});
  }

  async setMode(id, mode) {
    const c = this.chats.get(id);
    if (!c || !MODES.includes(mode)) return;
    c.meta.mode = mode;
    this.#metaChanged(c);
    if (c.rt.q) await c.rt.q.setPermissionMode(mode).catch(() => {});
  }

  // Snooze, after t3code: the chat leaves the list until the time comes, then
  // returns unread. until = 0 wakes it now.
  snooze(id, until) {
    const c = this.chats.get(id);
    if (!c) return;
    const t = Number(until) || 0;
    c.meta.snoozedUntil = t > Date.now() ? t : 0;
    this.#metaChanged(c);
  }

  #wakeDue() {
    const now = Date.now();
    for (const c of this.chats.values()) {
      if (c.meta.snoozedUntil && c.meta.snoozedUntil <= now) {
        c.meta.snoozedUntil = 0;
        c.meta.unread = true;
        c.meta.updatedAt = now;
        this.#metaChanged(c);
      }
    }
  }

  // Local or worktree is picked before the first message, like t3code's env mode.
  setWorktree(id, on) {
    const c = this.chats.get(id);
    if (!c || c.meta.sessionId || c.meta.worktree || c.items.length) return;
    c.meta.useWorktree = !!on;
    this.#metaChanged(c);
  }

  // One turn at a time: a message sent while the agent is busy waits in the queue and goes out
  // when the turn ends. An idle chat takes it straight away.
  send(id, text, atts) {
    const c = this.chats.get(id);
    const body = String(text || '').trim();
    const refs = att.refsFrom(id, atts);
    if (!c || (!body && !refs.length)) return;
    c.rt.queue.push({ id: `q-${uid()}`, text: body, refs });
    this.#syncQueue(c);
    this.#drain(c);
  }

  // Queued messages as the page shows them: a chip each, nothing heavy.
  #syncQueue(c) {
    // refs are kept so a queue that survived a restart still carries its attachments
    c.meta.queued = c.rt.queue.map((q) => ({ id: q.id, text: q.text, files: q.refs.length, refs: q.refs }));
    this.#metaChanged(c);
  }

  #drain(c) {
    if (c.meta.status === 'working' || c.meta.status === 'approval' || !c.rt.queue.length) return;
    const item = c.rt.queue.shift();
    this.#syncQueue(c);
    this.#dispatch(c, item).catch((e) => {
      this.#push(c, { t: 'error', id: `e-${uid()}`, text: `Message not sent: ${e.message || e}` });
      this.#metaChanged(c);
    });
  }

  unqueue(id, qid) {
    const c = this.chats.get(id);
    if (!c) return;
    const before = c.rt.queue.length;
    c.rt.queue = c.rt.queue.filter((q) => q.id !== qid);
    if (c.rt.queue.length !== before) this.#syncQueue(c);
  }

  // Moves the chip to the front and stops the running turn; the turn's result then sends it.
  sendNow(id, qid) {
    const c = this.chats.get(id);
    const i = c ? c.rt.queue.findIndex((q) => q.id === qid) : -1;
    if (i < 0) return;
    c.rt.queue.unshift(...c.rt.queue.splice(i, 1));
    this.#syncQueue(c);
    if (c.meta.status === 'working' || c.meta.status === 'approval') this.interrupt(id);
    else this.#drain(c);
  }

  async #dispatch(c, item) {
    const body = item.text;
    const content = att.compose(c.meta.id, body, item.refs);
    clearTimeout(c.rt.idle);
    if (!c.meta.name) c.meta.name = titleFrom(body || item.refs[0]?.name || 'Attachment');
    c.meta.snoozedUntil = 0;
    // The uuid names this turn in the transcript: file checkpoints and rewind point at it.
    // parentUuid is the chain entry right before it, where a conversation rewind cuts.
    const uuid = uid();
    c.rt.lastSent = body;
    this.#push(c, {
      t: 'user',
      id: `u-${uid()}`,
      text: body,
      ts: Date.now(),
      uuid,
      parentUuid: c.rt.lastUuid || '',
      ...(item.refs.length && { atts: item.refs.map((r) => att.view(c.meta.id, r)) }),
    });
    c.meta.preview = previewOf(body || `${item.refs.length} attachment${item.refs.length > 1 ? 's' : ''}`, true);
    if (c.meta.useWorktree && !c.meta.worktree) {
      // Messages sent while the worktree is being made wait for the same promise.
      if (!c.rt.wt) {
        this.#setStatus(c, { status: 'working', activity: 'creating worktree', turnStartedAt: Date.now(), error: '' });
        c.rt.wt = gitops.createWorktree(c.meta.cwd, c.meta.id, c.meta.name).then((wt) => {
          c.meta.worktree = wt;
          c.meta.workdir = wt.path;
          this.#push(c, { t: 'note', id: `n-${uid()}`, text: `Worktree ${wt.branch} from ${wt.base}` });
          this.#metaChanged(c);
          this.#refreshGit(c);
        }).catch((e) => {
          c.meta.useWorktree = false;
          this.#push(c, { t: 'error', id: `e-${uid()}`, text: `No worktree, working in the folder: ${e.message}` });
          this.#metaChanged(c);
        });
      }
      await c.rt.wt;
      if (c.rt.removed) return; // deleted meanwhile
    }
    // A process that is just shutting down (idle stop) would swallow the message: wait until it is gone, then start a fresh one.
    if (c.rt.q && c.rt.input?.closed) await c.rt.loop?.catch(() => {});
    if (c.rt.removed) return;
    if (!c.rt.q) this.#start(c);
    c.rt.input.push({
      type: 'user',
      uuid,
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: c.meta.sessionId || '',
    });
    if (c.meta.status !== 'working') c.rt.limitFrom = this.#sessionPct(c.meta.accountId);
    this.#setStatus(c, {
      status: c.meta.pending ? 'approval' : 'working',
      activity: 'thinking',
      turnStartedAt: c.meta.status === 'working' ? c.meta.turnStartedAt : Date.now(),
      error: '',
    });
  }

  async interrupt(id) {
    const c = this.chats.get(id);
    if (!c?.rt.q) return;
    for (const [permId, p] of c.rt.perms) this.#resolvePerm(c, permId, p, { behavior: 'deny', message: 'Stopped by the user', interrupt: true }, 'cancelled');
    await c.rt.q.interrupt().catch(() => {});
  }

  // ---- fork, rewind, background tasks --------------------------------------

  // A new chat on a copy of this session: same transcript, its own process from its first message on.
  async fork(id) {
    const c = this.chats.get(id);
    if (!c) throw new Error('No such chat');
    if (!c.meta.sessionId) throw new Error('Send a message first, there is nothing to fork yet');
    if (c.meta.status !== 'idle') throw new Error('Wait for the turn to finish, then fork');
    const acc = this.accounts.get(c.meta.accountId);
    if (!acc) throw new Error('This chat\'s account is gone');
    const name = `${c.meta.name || 'New chat'} (fork)`;
    const { sessionId } = await withAccountDir(acc, () => forkSession(c.meta.sessionId, { title: name }));
    const now = Date.now();
    const meta = { ...c.meta, id: uid(), name, sessionId, status: 'idle', activity: '', pending: 0, unread: false, snoozedUntil: 0, createdAt: now, updatedAt: now, turnStartedAt: 0, queued: [] };
    // forkSession gives every copied message a new uuid, so rewind points of the source are void in the copy.
    const nc = { meta, items: c.items.map(settle).map((it) => (it.t === 'user' ? { ...it, uuid: '', parentUuid: '' } : it)), rt: this.#runtime() };
    this.chats.set(meta.id, nc);
    writeJson(path.join(CHATS_DIR, `${meta.id}.json`), nc.items);
    this.#metaChanged(nc);
    return meta;
  }

  // A user message can be rewound when it was sent by this build (it has the uuid the SDK saves it under).
  #rewindItem(c, itemId) {
    const it = c?.items.find((x) => x.id === itemId && x.t === 'user');
    if (!it) throw new Error('That message is gone');
    if (!it.uuid) throw new Error('Messages from before this version cannot be rewound');
    // No parent only means "first message of the session" for the very first user message; after a restart the chain is unknown.
    if (!it.parentUuid && c.items.some((x) => x.t === 'user' && c.items.indexOf(x) < c.items.indexOf(it))) throw new Error('This message cannot be rewound after a restart');
    if (c.meta.status !== 'idle') throw new Error('Wait for the turn to finish, then rewind');
    return it;
  }

  // File backups are per process, so one is resumed for the call when the chat is closed.
  async #files(c, uuid, dryRun) {
    if (!c.rt.q) this.#start(c);
    return c.rt.q.rewindFiles(uuid, { dryRun }).catch((e) => ({ canRewind: false, error: String(e?.message || e) }));
  }

  async rewindPreview(id, itemId) {
    const c = this.chats.get(id);
    const it = this.#rewindItem(c, itemId);
    try {
      return await this.#files(c, it.uuid, true);
    } finally {
      this.#armIdle(c);
    }
  }

  // mode: 'conversation' cuts the transcript before the message, 'files' puts the files back, 'both' does both.
  // Files go first: if they cannot be restored, the conversation stays as it was.
  async rewind(id, itemId, mode = 'both') {
    const c = this.chats.get(id);
    const it = this.#rewindItem(c, itemId);
    if (mode !== 'conversation') {
      const r = await this.#files(c, it.uuid, false);
      if (!r.canRewind) throw new Error(r.error || 'The files cannot be rewound to that message');
    }
    if (mode === 'files') { this.#armIdle(c); return; }
    await this.#halt(c);
    const acc = this.accounts.get(c.meta.accountId);
    // The transcript up to the entry before the message becomes the new session. With no entry before it, the chat starts over.
    c.meta.sessionId = it.parentUuid
      ? (await withAccountDir(acc, () => forkSession(c.meta.sessionId, { upToMessageId: it.parentUuid }))).sessionId
      : '';
    c.items.splice(c.items.indexOf(it));
    c.rt.lastUuid = it.parentUuid || '';
    c.meta.context = null;
    this.#saveItems(c);
    this.broadcast({ type: 'history', id, items: c.items });
    this.#metaChanged(c);
  }

  async stopTask(id, taskId) {
    const c = this.chats.get(id);
    if (!c?.rt.q) return;
    await c.rt.q.stopTask(String(taskId)).catch(() => {});
  }

  // The last 8 KiB of a shell task's output. The SDK names the file when the task ends, so this is empty while it runs.
  async taskOutput(id, taskId) {
    const rec = this.chats.get(id)?.rt.tasks.get(String(taskId));
    if (!rec?.outputFile) return '';
    const fh = await fs.promises.open(rec.outputFile, 'r').catch(() => null);
    if (!fh) return '';
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 8192);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally {
      await fh.close();
    }
  }

  #start(c) {
    const acc = this.accounts.get(c.meta.accountId);
    if (!acc) throw new Error('This chat\'s account is gone');
    const env = { ...process.env, CLAUDE_CONFIG_DIR: acc.dir };
    // Never let an API key or a parent Claude Code session hijack the subscription login.
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const input = new InputQueue();
    const q = query({
      prompt: input,
      options: {
        pathToClaudeCodeExecutable: claudeBin(),
        cwd: workdir(c.meta),
        env,
        resume: c.meta.sessionId || undefined,
        model: c.meta.model || undefined,
        effort: c.meta.effort || undefined,
        permissionMode: c.meta.mode,
        allowDangerouslySkipPermissions: true,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        thinking: { type: 'adaptive', display: 'summarized' }, // without this the thinking text arrives empty
        settingSources: ['user', 'project', 'local'],
        includePartialMessages: true,
        enableFileCheckpointing: true, // rewind can put files back to the state before a message
        canUseTool: (name, toolInput, opts) => this.#canUseTool(c, name, toolInput, opts),
      },
    });
    c.rt.q = q;
    c.rt.input = input;
    c.rt.loop = (async () => {
      try {
        for await (const m of q) this.#onMessage(c, m);
      } catch (e) {
        if (c.rt.q === q) {
          this.#push(c, { t: 'error', id: `e-${uid()}`, text: String(e?.message || e).slice(0, 2000) });
          this.#setStatus(c, { status: 'error', activity: '', error: String(e?.message || e).slice(0, 200) });
        }
      } finally {
        if (c.rt.q === q) {
          c.rt.q = null;
          c.rt.input = null;
          clearTimeout(c.rt.mcpTimer);
          for (const [permId, p] of c.rt.perms) this.#resolvePerm(c, permId, p, { behavior: 'deny', message: 'Session ended' }, 'cancelled');
          // Background tasks die with the process they run in.
          c.rt.tasks.endAll('stopped');
          for (const it of c.items) {
            if (it.t === 'tool' && it.status === 'running') { it.status = 'stopped'; this.#touch(c, it); }
            if (it.t === 'tool' && it.task?.status === 'running') { it.task = { ...it.task, status: 'stopped', endedAt: Date.now() }; this.#touch(c, it); }
            if ((it.t === 'text' || it.t === 'thinking') && it.live) { it.live = false; this.#touch(c, it); }
          }
          if (c.meta.status !== 'error') this.#setStatus(c, { status: 'idle', activity: '', pending: 0 });
          if (!c.rt.removed && this.chats.get(c.meta.id) === c) this.#drain(c);
        }
      }
    })();
  }

  #stop(c) {
    clearTimeout(c.rt.idle);
    const q = c.rt.q;
    if (!q) return;
    c.rt.input?.close();
    try { q.close(); } catch {}
  }

  // Closes the process and waits until its message loop has settled, so a new one can start cleanly.
  async #halt(c) {
    const loop = c.rt.loop;
    this.#stop(c);
    await loop?.catch(() => {});
  }

  // Feeds one SDK message in as if the chat's process had sent it (used to replay recorded streams in tests).
  ingest(id, m) {
    const c = this.chats.get(id);
    if (c) this.#onMessage(c, m);
  }

  stopAll() {
    for (const c of this.chats.values()) this.#stop(c);
  }

  #armIdle(c) {
    clearTimeout(c.rt.idle);
    c.rt.idle = setTimeout(() => {
      if (c.meta.status === 'idle' && !c.rt.perms.size) this.#stop(c);
    }, this.idleMs);
  }

  async #refreshGit(c) {
    const info = await gitInfo(workdir(c.meta));
    if (JSON.stringify(info) !== JSON.stringify(c.meta.git)) {
      c.meta.git = info;
      this.#metaChanged(c);
    }
  }

  workdirOf(id) {
    const c = this.chats.get(id);
    return c ? workdir(c.meta) : null;
  }

  // ---- source control (diff panel) ----------------------------------------

  async diff(id) {
    const c = this.chats.get(id);
    if (!c) return null;
    return { type: 'diff', id, ...(await gitops.diff(workdir(c.meta))) };
  }

  async commit(id, message) {
    const c = this.chats.get(id);
    if (!c) return null;
    const sha = await gitops.commit(workdir(c.meta), message);
    this.#refreshGit(c);
    this.broadcast({ type: 'toast', kind: 'done', text: `Committed ${sha}` });
    return this.diff(id);
  }

  async push(id) {
    const c = this.chats.get(id);
    if (!c) return null;
    await gitops.push(workdir(c.meta));
    this.broadcast({ type: 'toast', kind: 'done', text: 'Pushed' });
    return this.diff(id);
  }

  // ---- SDK stream --------------------------------------------------------

  #onMessage(c, m) {
    switch (m.type) {
      case 'system':
        if (String(m.subtype).startsWith('task_')) { this.#onTask(c, m); return; }
        if (m.subtype === 'init') {
          if (m.session_id && m.session_id !== c.meta.sessionId) {
            c.meta.sessionId = m.session_id;
            this.#metaChanged(c);
          }
          if (!this.models[c.meta.accountId]) this.#loadModels(c);
          c.rt.q?.supportedCommands().then((list) => this.#saveCommands(c.meta.accountId, list)).catch(() => {});
          this.#refreshMcp(c);
        } else if (m.subtype === 'compact_boundary') {
          this.#push(c, { t: 'note', id: `n-${uid()}`, text: 'Context compacted' });
        } else if (m.subtype === 'local_command_output') {
          // A slash command ran inside Claude Code itself: its output is not an answer of the model.
          this.#push(c, { t: 'cmdout', id: `lc-${uid()}`, text: String(m.content || '').replace(/<\/?local-command-std(out|err)>/g, '').trim() });
        } else if (m.subtype === 'api_retry') {
          this.#setStatus(c, { activity: 'retrying' });
        }
        return;
      case 'stream_event':
        if (!m.parent_tool_use_id) this.#onStream(c, m.event);
        return;
      case 'assistant':
        // A subagent's calls come with its Agent call's id: they nest under that card instead of the timeline.
        if (m.uuid && !m.parent_tool_use_id) c.rt.lastUuid = m.uuid;
        this.#onAssistant(c, m.message, m.parent_tool_use_id || '');
        return;
      case 'user':
        if (m.uuid && !m.parent_tool_use_id) c.rt.lastUuid = m.uuid;
        this.#onToolResults(c, m.message);
        return;
      case 'result':
        this.#onResult(c, m);
        return;
      case 'rate_limit_event':
        this.accounts.scheduleRefresh(c.meta.accountId, 2000);
        if (m.rate_limit_info?.status === 'rejected') {
          this.#push(c, { t: 'error', id: `e-${uid()}`, text: 'Plan limit reached on this account', resetsAt: m.rate_limit_info.resetsAt || null });
        }
        return;
      default:
    }
  }

  #onStream(c, e) {
    if (!e) return;
    if (e.type === 'message_start') {
      c.rt.curMsg = e.message?.id || uid();
    } else if (e.type === 'content_block_start') {
      const kind = e.content_block?.type;
      if (kind === 'text') {
        const item = this.#push(c, { t: 'text', id: `${c.rt.curMsg}:${e.index}`, text: '', live: true });
        const list = c.rt.live.get(c.rt.curMsg) || [];
        list.push(item.id);
        c.rt.live.set(c.rt.curMsg, list);
        if (c.meta.activity !== 'writing') this.#setStatus(c, { activity: 'writing' });
      } else if (kind === 'thinking') {
        this.#push(c, { t: 'thinking', id: `${c.rt.curMsg}:${e.index}`, text: '', live: true, startedAt: Date.now() });
        if (c.meta.activity !== 'thinking') this.#setStatus(c, { activity: 'thinking' });
      }
    } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
      const item = this.#find(c, `${c.rt.curMsg}:${e.index}`);
      if (item) {
        item.text += e.delta.text;
        this.#touch(c, item);
      }    } else if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta') {
      const item = this.#find(c, `${c.rt.curMsg}:${e.index}`);
      if (item) {
        item.text = (item.text + e.delta.thinking).slice(-20000);
        this.#touch(c, item);
      }
    } else if (e.type === 'content_block_stop') {
      const item = this.#find(c, `${c.rt.curMsg}:${e.index}`);
      if (item?.t === 'thinking' && item.live) {
        item.live = false;
        item.durationMs = Date.now() - item.startedAt;
        this.#touch(c, item);
      }
    }
  }

  #onAssistant(c, msg, parent = '') {
    if (!msg?.content) return;
    // A slash command Claude Code answers itself (/usage, /context ...) comes as a synthetic assistant message: no model ran.
    if (!parent && msg.model === '<synthetic>' && String(c.rt.lastSent || '').startsWith('/')) {
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) this.#push(c, { t: 'cmdout', id: `lc-${uid()}`, text });
      return;
    }
    for (const block of msg.content) {
      if (parent) {
        // Inside a subagent only its tool calls are kept, its text is the Agent card's result.
        if (block.type === 'tool_use') this.#onChildTool(c, parent, block);
        continue;
      }
      if (block.type === 'text') {
        const list = c.rt.live.get(msg.id) || [];
        const liveId = list.shift();
        const item = liveId && this.#find(c, liveId);
        if (item) {
          item.text = block.text;
          item.live = false;
          this.#touch(c, item);
        } else if (block.text?.trim()) {
          this.#push(c, { t: 'text', id: `${msg.id}:${uid()}`, text: block.text, live: false });
        }
      } else if (block.type === 'thinking') {
        const item = [...c.items].reverse().find((it) => it.t === 'thinking' && it.live !== undefined && it.id.startsWith(`${msg.id}:`));
        if (item) {
          if (block.thinking) item.text = block.thinking.slice(-20000);
          item.live = false;
          item.durationMs = item.durationMs || Date.now() - item.startedAt;
          this.#touch(c, item);
        } else if (block.thinking) {
          this.#push(c, { t: 'thinking', id: `${msg.id}:${uid()}`, text: block.thinking.slice(-20000), live: false, durationMs: 0 });
        }
      } else if (block.type === 'tool_use') {
        const input = block.input || {};
        this.#push(c, {
          t: 'tool',
          id: block.id,
          name: block.name,
          detail: toolDetail(block.name, input),
          summary: toolSummary(block.name, input),
          diff: toolDiff(block.name, input),
          status: 'running',
        });
        this.#setStatus(c, { activity: activityOf(block.name, input) });
      }
    }
  }

  // A call made inside a subagent: kept as a tool item with `parent` set, and it moves the agent's current action.
  #onChildTool(c, parent, block) {
    const input = block.input || {};
    const action = activityOf(block.name, input);
    this.#push(c, {
      t: 'tool',
      id: block.id,
      name: block.name,
      parent,
      detail: toolDetail(block.name, input),
      summary: toolSummary(block.name, input),
      diff: toolDiff(block.name, input),
      status: 'running',
    });
    const rec = c.rt.tasks.step(parent, action);
    const owner = this.#find(c, parent);
    if (owner && rec) { owner.task = taskView(rec); this.#touch(c, owner); }
    this.#setStatus(c, { activity: action });
  }

  // Task events of background shells, monitors and subagents. Each one has a tool item to show on, or a
  // fallback item when the tool call never got one (a task the SDK started on its own).
  #onTask(c, m) {
    const reg = c.rt.tasks;
    if (m.subtype === 'task_started') {
      if (m.ambient || m.skip_transcript) return;
      const rec = reg.start(m);
      let item = this.#taskItem(c, rec);
      if (!item) {
        item = this.#push(c, {
          t: 'tool',
          id: `task-${rec.taskId}`,
          name: rec.kind === 'agent' ? 'Task' : rec.kind === 'monitor' ? 'Monitor' : 'Bash',
          detail: null,
          summary: rec.description,
          status: 'ok',
        });
      }
      item.task = taskView(rec);
      this.#touch(c, item);
      return;
    }
    const rec = m.subtype === 'task_progress' ? reg.progress(m) : m.subtype === 'task_updated' ? reg.update(m) : m.subtype === 'task_notification' ? reg.finish(m) : null;
    const item = rec && this.#taskItem(c, rec);
    if (!item) return;
    item.task = taskView(rec);
    this.#touch(c, item);
  }

  #taskItem(c, rec) {
    return (rec.toolUseId && this.#find(c, rec.toolUseId)) || this.#find(c, `task-${rec.taskId}`);
  }

  #onToolResults(c, msg) {
    if (!Array.isArray(msg?.content)) return;
    for (const block of msg.content) {
      if (block.type !== 'tool_result') continue;
      const item = this.#find(c, block.tool_use_id);
      if (!item || item.t !== 'tool') continue;
      item.status = block.is_error ? 'error' : 'ok';
      const out = resultText(block.content);
      if (out) item.output = out.slice(0, 3000);
      // A background command's start result says where its output is written.
      const where = /written to:?\s*(\S+)/i.exec(out || '')?.[1];
      if (where) c.rt.tasks.outputFor(block.tool_use_id, where.replace(/[).,]+$/, ''));
      this.#touch(c, item);
    }
  }

  #onResult(c, m) {
    for (const it of c.items) {
      if ((it.t === 'text' || it.t === 'thinking') && it.live) { it.live = false; this.#touch(c, it); }
      if (it.t === 'tool' && it.status === 'running') { it.status = 'stopped'; this.#touch(c, it); }
    }
    c.rt.live.clear();
    const ok = m.subtype === 'success' && !m.is_error;
    const durationMs = Number(m.duration_ms) || (c.meta.turnStartedAt ? Date.now() - c.meta.turnStartedAt : 0);
    const outTokens = Number(m.usage?.output_tokens) || 0;
    const inTokens = (Number(m.usage?.input_tokens) || 0) + (Number(m.usage?.cache_read_input_tokens) || 0) + (Number(m.usage?.cache_creation_input_tokens) || 0);
    const limitFrom = c.rt.limitFrom ?? null;
    const doneItem = {
      t: 'done',
      id: `d-${uid()}`,
      ok,
      durationMs,
      outTokens,
      inTokens,
      tokPerSec: outTokens && durationMs > 500 ? Math.round((outTokens / (durationMs / 1000)) * 10) / 10 : 0,
      error: ok ? '' : String(m.result || (m.errors || []).join('\n') || m.subtype).slice(0, 1000),
    };
    this.#push(c, doneItem);
    this.#fillLimitDelta(c, doneItem, limitFrom);
    const last = [...c.items].reverse().find((it) => (it.t === 'text' && it.text?.trim()) || it.t === 'user');
    if (last?.t === 'text') c.meta.preview = previewOf(last.text, false);
    this.#setStatus(c, { status: 'idle', activity: '', unread: true, turnStartedAt: 0, pending: 0 });
    this.accounts.scheduleRefresh(c.meta.accountId);
    this.#refreshGit(c);
    this.#refreshMcp(c);
    this.#refreshContext(c);
    this.#armIdle(c);
    this.#drain(c); // the next queued message goes out when the turn ends
  }

  // Filled from the SDK's own count after each turn (no model call), kept in meta so the ring shows it
  // even while the process is closed.
  async #refreshContext(c) {
    const q = c.rt.q;
    if (!q) return;
    try {
      const u = await q.getContextUsage({ detail: 'summary' });
      const max = Number(u.maxTokens) || 0;
      const tokens = Number(u.totalTokens) || 0;
      c.meta.context = { tokens, max, pct: max ? Math.round((tokens / max) * 1000) / 10 : 0, model: u.model || '' };
      this.#metaChanged(c);
    } catch {}
  }

  // 5h window utilisation of an account from the last poll (no extra API calls).
  #sessionPct(accountId) {
    const w = this.accounts.get(accountId)?.limits?.find((l) => l.label === '5h');
    return w ? w.pct : null;
  }

  // The usage endpoint is refreshed once after every turn; when that fresh reading lands, the difference
  // against the reading from before the turn is what this turn cost.
  #fillLimitDelta(c, item, from) {
    if (from == null) return;
    const startedAt = Date.now();
    const tryFill = (n) => {
      const acc = this.accounts.get(c.meta.accountId);
      const w = acc?.limits?.find((l) => l.label === '5h');
      if (w && acc.limitsAt > startedAt) {
        item.limitPct = Math.max(0, Math.round((w.pct - from) * 10) / 10);
        this.#touch(c, item);
      } else if (n < 6) setTimeout(() => tryFill(n + 1), 2500);
    };
    setTimeout(() => tryFill(0), 5000);
  }

  #saveCommands(accountId, list) {
    if (!Array.isArray(list) || !list.length) return;
    this.commands[accountId] = list.map((x) => ({ name: x.name, description: x.description || '', argumentHint: x.argumentHint || '' }));
    this.broadcast({ type: 'commands', accountId, commands: this.commands[accountId] });
  }

  // Model lists come from the SDK, which only talks once a process runs. Ask each logged-in
  // account once at startup with an empty throwaway query, so the picker is full before the first message.
  async preloadModels() {
    for (const acc of this.accounts.list) {
      if (!acc.loggedIn || this.models[acc.id]?.length) continue;
      const env = { ...process.env, CLAUDE_CONFIG_DIR: acc.dir };
      delete env.ANTHROPIC_API_KEY;
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;
      const input = new InputQueue();
      let q;
      try {
        q = query({ prompt: input, options: { pathToClaudeCodeExecutable: claudeBin(), cwd: HOME, env, settingSources: [] } });
        const list = await Promise.race([q.supportedModels(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 30000))]);
        this.#saveCommands(acc.id, await q.supportedCommands().catch(() => null));
        if (Array.isArray(list) && list.length) {
          this.models[acc.id] = list.map((x) => ({ value: x.value, label: x.displayName || x.value, description: x.description || '', efforts: x.supportedEffortLevels || [] }));
          this.broadcast({ type: 'models', accountId: acc.id, models: this.models[acc.id] });
        }
      } catch {}
      input.close();
      try { q?.close(); } catch {}
    }
  }

  async #loadModels(c) {
    try {
      const list = await c.rt.q?.supportedModels();
      if (Array.isArray(list) && list.length) {
        this.models[c.meta.accountId] = list.map((x) => ({ value: x.value, label: x.displayName || x.value, description: x.description || '', efforts: x.supportedEffortLevels || [] }));
        this.broadcast({ type: 'models', accountId: c.meta.accountId, models: this.models[c.meta.accountId] });
      }
    } catch {}
  }

  // ---- MCP servers & permission rules (server/mcp.mjs, server/rules.mjs) ---

  // Servers still connecting show as pending: look again a few times, then stop.
  async #refreshMcp(c, left = 10) {
    const q = c.rt.q;
    if (!q) return;
    clearTimeout(c.rt.mcpTimer);
    let list;
    try { list = await fetchMcp(q); } catch { return; }
    if (c.rt.q !== q) return;
    c.meta.mcp = list;
    this.#metaChanged(c);
    if (left > 0 && list.some((s) => s.status === 'pending')) c.rt.mcpTimer = setTimeout(() => this.#refreshMcp(c, left - 1), 3000);
  }

  async mcpAction(id, action, name, enabled) {
    const c = this.chats.get(id);
    if (!c?.rt.q) throw new Error('Send a message first, the MCP servers start with the chat');
    await mcpAction(c.rt.q, action, name, enabled);
    await this.#refreshMcp(c);
  }

  #folderOf(c) {
    return workdir(c.meta);
  }

  rulesOf(id) {
    const c = this.chats.get(id);
    const acc = c && this.accounts.get(c.meta.accountId);
    return acc ? readRules(acc, this.#folderOf(c)) : [];
  }

  removeRule(id, scope, behavior, rule) {
    const c = this.chats.get(id);
    const acc = c && this.accounts.get(c.meta.accountId);
    if (!acc) throw new Error('This chat\'s account is gone');
    removeRule(acc, this.#folderOf(c), scope, behavior, rule);
    return this.rulesOf(id);
  }

  // ---- permissions -------------------------------------------------------

  #canUseTool(c, name, input, opts) {
    if (c.rt.allowed.has(allowKey(name, input)) && name !== 'AskUserQuestion') return Promise.resolve({ behavior: 'allow', updatedInput: input });
    const permId = `p-${uid()}`;
    const item = this.#push(c, {
      t: 'perm',
      id: permId,
      tool: name,
      summary: toolSummary(name, input),
      detail: name === 'AskUserQuestion' ? '' : permDetail(name, input),
      questions: name === 'AskUserQuestion' ? (input.questions || []).map((q) => ({
        question: q.question,
        header: q.header,
        multiSelect: !!q.multiSelect,
        options: (q.options || []).map((o) => ({ label: o.label, description: o.description || '' })),
      })) : null,
      state: 'pending',
    });
    return new Promise((resolve) => {
      const p = { resolve, input, name, item, suggestions: opts?.suggestions || [] };
      c.rt.perms.set(permId, p);
      this.#setStatus(c, { status: 'approval', pending: c.rt.perms.size, activity: name === 'AskUserQuestion' ? 'asking you' : 'waiting for approval' });
      opts?.signal?.addEventListener('abort', () => this.#resolvePerm(c, permId, p, { behavior: 'deny', message: 'Cancelled' }, 'cancelled'), { once: true });
    });
  }

  #resolvePerm(c, permId, p, result, state) {
    if (!c.rt.perms.has(permId)) return;
    c.rt.perms.delete(permId);
    p.item.state = state;
    this.#touch(c, p.item);
    p.resolve(result);
    const pending = c.rt.perms.size;
    this.#setStatus(c, pending ? { pending } : { pending: 0, status: c.rt.q ? 'working' : 'idle', activity: c.rt.q ? 'working' : '' });
  }

  answer(id, permId, decision, answers) {
    const c = this.chats.get(id);
    const p = c?.rt.perms.get(permId);
    if (!p) return;
    if (decision === 'deny') {
      this.#resolvePerm(c, permId, p, { behavior: 'deny', message: 'The user declined this action' }, 'denied');
      return;
    }
    if (decision === 'always' && p.name !== 'AskUserQuestion') {
      // The CLI's own suggestions (for Bash a command rule) are saved to this folder's .claude/settings.local.json.
      const fromCli = p.suggestions.filter((u) => u.type === 'addRules').map((u) => ({ ...u, behavior: 'allow', destination: 'localSettings' }));
      if (!fromCli.length) {
        // No narrow rule to offer: never fall back to "this whole tool forever", allow just this call.
        this.broadcast({ type: 'toast', kind: 'info', text: 'No rule to save for this call, allowed once', id });
        this.#resolvePerm(c, permId, p, { behavior: 'allow', updatedInput: p.input }, 'allowed');
        return;
      }
      this.#resolvePerm(c, permId, p, { behavior: 'allow', updatedInput: p.input, updatedPermissions: fromCli }, 'allowedAlways');
      return;
    }
    if (decision === 'session') c.rt.allowed.add(allowKey(p.name, p.input));
    const updatedInput = p.name === 'AskUserQuestion' && answers ? { ...p.input, answers } : p.input;
    if (p.name === 'AskUserQuestion' && answers) p.item.answers = answers;
    this.#resolvePerm(c, permId, p, { behavior: 'allow', updatedInput }, decision === 'session' ? 'allowedSession' : 'allowed');
  }
}
