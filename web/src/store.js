// One websocket, one plain object, one version counter. Components re-render on bump().
import { useEffect, useState } from 'react';

const listeners = new Set();
let version = 0;
let ws = null;
let retry = 0;
const queue = [];
const waiting = new Map();

function loadUi() {
  try {
    return JSON.parse(localStorage.getItem('swrm.ui') || '{}');
  } catch {
    return {};
  }
}

const ui = loadUi();

export const state = {
  connected: false,
  chats: {}, // id -> meta
  items: {}, // id -> array (only for chats open in panes)
  accounts: [],
  spaces: [],
  settings: { defaultAccount: '', defaultMode: 'default' },
  models: {},
  commands: {}, // accountId -> slash commands
  toasts: [],
  panes: Array.isArray(ui.panes) ? ui.panes : [],
  focused: Number(ui.focused) || 0,
  solo: null,
  spaceFilter: ui.spaceFilter || '',
  grouped: !!ui.grouped,
  sidebar: ui.sidebar !== false,
  sidebarW: Math.min(560, Math.max(240, ui.sidebarW || 320)),
  paneW: ui.paneW && typeof ui.paneW === 'object' ? ui.paneW : {}, // chat id -> width weight inside its row
  rowW: Array.isArray(ui.rowW) ? ui.rowW : [1, 1], // height weight of the two rows
  termH: Math.min(800, Math.max(120, ui.termH || 256)),
  limitsOpen: ui.limitsOpen !== false,
  diffOpen: !!ui.diffOpen,
  diffs: {}, // id -> { files, repo, branch, ahead, upstream }
  diffBusy: {}, // id -> 'load' | 'commit' | 'push'
  terms: {}, // id -> true while the chat's terminal drawer is open
  scripts: {}, // id -> { scripts: [{ name, command }], runner }
  palette: null, // null | 'all' | 'messages', see openPalette
  resume: false, // the resume-session list is open, see sessions.jsx
  jump: null, // { chat, id }: scroll that chat to that message once it is rendered
  attachments: {}, // chat id -> files waiting in its composer (attach.jsx)
  viewer: null, // picture open in the full-size viewer
  rewindOpen: null, // chat id whose rewind picker is open (double Esc, or "Rewind here" on a message)
  rewindItem: '', // the user message picked in that chat, '' while the list of messages is shown
};

// Terminal output skips React: the mounted xterm subscribes here.
export const termListeners = new Map(); // id -> (msg) => void

function flush() {
  pending = false;
  version++;
  for (const fn of listeners) fn(version);
}

// Messages from the server only mark the state dirty and render once per frame, so a burst of
// stream chunks is one render instead of dozens. Anything the user does renders at once.
let pending = false;
let inMessage = false;
let frame = 0;
export function bump() {
  if (inMessage) { pending = true; return; }
  flush();
}

export function useStore() {
  const [, set] = useState(0);
  useEffect(() => {
    listeners.add(set);
    return () => listeners.delete(set);
  }, []);
  return state;
}

export function saveUi() {
  try {
    localStorage.setItem('swrm.ui', JSON.stringify({
      panes: state.panes,
      focused: state.focused,
      spaceFilter: state.spaceFilter,
      grouped: state.grouped,
      sidebar: state.sidebar,
      sidebarW: state.sidebarW,
      paneW: state.paneW,
      rowW: state.rowW,
      termH: state.termH,
      limitsOpen: state.limitsOpen,
      diffOpen: state.diffOpen,
    }));
  } catch {}
}

export function send(msg) {
  const data = JSON.stringify(msg);
  if (ws && ws.readyState === 1) ws.send(data);
  else queue.push(data);
}

// Round trip for calls that answer with a nonce (create).
export function request(msg) {
  const nonce = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    waiting.set(nonce, resolve);
    send({ ...msg, nonce });
  });
}

export function toast(text, kind = 'info', extra = {}) {
  const t = { id: Math.random(), text, kind, ...extra };
  state.toasts = [...state.toasts, t];
  bump();
  setTimeout(() => {
    state.toasts = state.toasts.filter((x) => x !== t);
    bump();
  }, extra.action ? 8000 : 4200);
}

export function dismissToast(t) {
  state.toasts = state.toasts.filter((x) => x !== t);
  bump();
}

// Ported from t3code's ThreadNotificationCoordinator: tell the owner when a chat
// needs them or finished. In the app it's a toast with Open, in the background a
// system notification. The chat on screen in the focused pane never notifies.
function attention(prev, next) {
  if (!prev) return null;
  // Woken by the timer (a manual wake comes before the time): it's back in the list.
  if (prev.snoozedUntil && !next.snoozedUntil && prev.snoozedUntil <= Date.now() + 20_000 && next.status === 'idle') return { kind: 'done', title: 'Back from snooze' };
  // Snoozed means quiet: only approvals and failures get through (they wake it on the server).
  if (next.snoozedUntil && !(next.status === 'approval' || next.status === 'error')) return null;
  if (next.status === 'approval' && prev.status !== 'approval') {
    return { kind: 'input', title: next.activity === 'asking you' ? 'Input needed' : 'Approval needed' };
  }
  if (next.status === 'error' && prev.status !== 'error') return { kind: 'error', title: 'Chat failed' };
  if (prev.status === 'working' && next.status === 'idle' && next.unread) return { kind: 'done', title: 'Chat completed' };
  return null;
}

function notifyChat(chat, { kind, title }) {
  const visible = document.visibilityState === 'visible' && document.hasFocus();
  const name = chat.name || 'New chat';
  if (visible) {
    if (state.panes[state.focused] === chat.id) return;
    toast(title, kind, { description: name, action: { label: 'Open', run: () => openChat(chat.id) } });
    return;
  }
  send({ type: 'notify', title, body: name, urgent: kind !== 'done' });
}

function upsertItems(id, list) {
  const arr = state.items[id];
  if (!arr) return;
  const next = arr.slice();
  for (const it of list) {
    let i = next.length - 1;
    while (i >= 0 && next[i].id !== it.id) i--;
    if (i >= 0) next[i] = it;
    else next.push(it);
  }
  state.items[id] = next;
}

function onMessage(m) {
  switch (m.type) {
    case 'snapshot':
      state.chats = Object.fromEntries(m.chats.map((c) => [c.id, c]));
      state.accounts = m.accounts;
      state.spaces = m.spaces;
      state.settings = m.settings;
      state.models = m.models || {};
      state.commands = m.commands || {};
      state.panes = state.panes.filter((id) => state.chats[id]);
      state.focused = Math.min(state.focused, Math.max(0, state.panes.length - 1));
      state.items = {};
      for (const id of state.panes) send({ type: 'history', id });
      break;
    case 'chat': {
      const prev = state.chats[m.chat.id];
      state.chats = { ...state.chats, [m.chat.id]: m.chat };
      const a = attention(prev, m.chat);
      if (a) notifyChat(m.chat, a);
      break;
    }
    case 'created':
      state.chats = { ...state.chats, [m.chat.id]: m.chat };
      waiting.get(m.nonce)?.(m.chat);
      waiting.delete(m.nonce);
      break;
    case 'resumed': // answer to request({type:'resume'}), see sessions.jsx
      state.chats = { ...state.chats, [m.chat.id]: m.chat };
      waiting.get(m.nonce)?.(m);
      waiting.delete(m.nonce);
      break;
    case 'sessions': // answers to request({type:'sessions'}) and request({type:'search'})
    case 'search':
      waiting.get(m.nonce)?.(m);
      waiting.delete(m.nonce);
      return;
    case 'chatRemoved': {
      const { [m.id]: _, ...rest } = state.chats;
      state.chats = rest;
      delete state.items[m.id];
      closeChatPanes(m.id);
      break;
    }
    case 'history':
      if (state.panes.includes(m.id)) state.items[m.id] = m.items;
      break;
    case 'reply':
      waiting.get(m.nonce)?.(m);
      waiting.delete(m.nonce);
      break;
    case 'items':
      upsertItems(m.id, m.items);
      break;
    case 'accounts':
      state.accounts = m.accounts;
      break;
    case 'spaces':
      state.spaces = m.spaces;
      break;
    case 'settings':
      state.settings = m.settings;
      break;
    case 'models':
      state.models = { ...state.models, [m.accountId]: m.models };
      break;
    case 'commands':
      state.commands = { ...state.commands, [m.accountId]: m.commands };
      break;
    case 'files': // answer to request({type:'files'}), the @ mention menu in the composer
      waiting.get(m.nonce)?.(m.list);
      waiting.delete(m.nonce);
      return;
    case 'rules': // answer to request({type:'rules'}) or request({type:'ruleRemove'}), see mcp.jsx
      waiting.get(m.nonce)?.(m.rules);
      waiting.delete(m.nonce);
      return;
    case 'diff': {
      const { type, id, ...d } = m;
      state.diffs = { ...state.diffs, [id]: d };
      state.diffBusy = { ...state.diffBusy, [id]: null };
      break;
    }
    case 'termData':
    case 'termReplay':
      termListeners.get(m.id)?.(m);
      return;
    case 'termExit':
      termListeners.get(m.id)?.(m);
      if (state.terms[m.id]) state.terms = { ...state.terms, [m.id]: false };
      break;
    case 'scripts': {
      const { type, id, ...d } = m;
      state.scripts = { ...state.scripts, [id]: d };
      break;
    }
    case 'toast':
      // A failed request still gets an answer (null), so the waiting UI can let go.
      if (m.nonce) { waiting.get(m.nonce)?.(null); waiting.delete(m.nonce); }
      if (m.id && state.diffBusy[m.id]) state.diffBusy = { ...state.diffBusy, [m.id]: null };
      toast(m.text, m.kind, m.description ? { description: m.description } : {});
      return;
    default:
      return;
  }
  bump();
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  // A socket can hang in CONNECTING (server restarting, sleeping laptop): retry instead of waiting forever.
  const stuck = setTimeout(() => sock.readyState === 0 && sock.close(), 4000);
  ws.onopen = () => {
    clearTimeout(stuck);
    retry = 0;
    state.connected = true;
    for (const d of queue.splice(0)) ws.send(d);
    bump();
  };
  ws.onmessage = (e) => {
    inMessage = true;
    try {
      onMessage(JSON.parse(e.data));
    } catch (err) {
      console.error('[swrm]', err);
    }
    inMessage = false;
    if (pending && !frame) frame = requestAnimationFrame(() => { frame = 0; if (pending) flush(); });
  };
  ws.onclose = () => {
    state.connected = false;
    bump();
    setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
}

// ---- panes ---------------------------------------------------------------

export const MAX_PANES = 6;

function ensureHistory(id) {
  if (!state.items[id]) {
    state.items[id] = [];
    send({ type: 'history', id });
  }
}

function dropUnused() {
  for (const id of Object.keys(state.items)) if (!state.panes.includes(id)) delete state.items[id];
}

export function openChat(id, { split = false } = {}) {
  const at = state.panes.indexOf(id);
  if (at >= 0) {
    state.focused = at;
  } else if (split && state.panes.length < MAX_PANES) {
    state.panes = [...state.panes, id];
    state.focused = state.panes.length - 1;
  } else if (!state.panes.length) {
    state.panes = [id];
    state.focused = 0;
  } else {
    const panes = state.panes.slice();
    panes[state.focused] = id;
    state.panes = panes;
  }
  state.solo = null;
  ensureHistory(id);
  dropUnused();
  send({ type: 'seen', id });
  saveUi();
  bump();
}

export function placeChat(id, index) {
  const panes = state.panes.slice();
  const from = panes.indexOf(id);
  if (from >= 0) {
    [panes[from], panes[index]] = [panes[index], panes[from]];
  } else {
    panes[index] = id;
  }
  state.panes = panes;
  state.focused = index;
  ensureHistory(id);
  dropUnused();
  saveUi();
  bump();
}

export function closePane(index) {
  state.panes = state.panes.filter((_, i) => i !== index);
  state.focused = Math.max(0, Math.min(state.focused, state.panes.length - 1));
  state.solo = null;
  dropUnused();
  saveUi();
  bump();
}

function closeChatPanes(id) {
  const i = state.panes.indexOf(id);
  if (i >= 0) {
    state.panes = state.panes.filter((x) => x !== id);
    state.focused = Math.max(0, Math.min(state.focused, state.panes.length - 1));
    state.solo = null;
    saveUi();
  }
}

export function focusPane(index) {
  if (state.focused === index) return;
  state.focused = index;
  const id = state.panes[index];
  if (id && state.chats[id]?.unread) send({ type: 'seen', id });
  saveUi();
  bump();
}

// ---- source control --------------------------------------------------------

export function loadDiff(id, busy = 'load') {
  if (!id) return;
  state.diffBusy = { ...state.diffBusy, [id]: busy };
  if (busy === 'load') send({ type: 'diff', id });
  bump();
}

export function toggleDiff(open = !state.diffOpen) {
  state.diffOpen = open;
  saveUi();
  bump();
}

// ---- palette (Ctrl K) and search ----------------------------------------------

export function openPalette(mode = 'all') {
  state.palette = mode;
  bump();
}

export function closePalette() {
  state.palette = null;
  bump();
}

// ---- terminal and project scripts ---------------------------------------------

export function toggleTerm(id, open = !state.terms[id]) {
  if (!id) return;
  // Hiding keeps the shell alive (a dev server keeps running), output replays on reopen.
  state.terms = { ...state.terms, [id]: open };
  bump();
}

// Opens the drawer if needed and types the script in, like t3code's script buttons.
export function runScript(id, script) {
  const cmd = `${state.scripts[id]?.runner || 'npm'} run ${script.name}`;
  if (!state.terms[id]) {
    state.terms = { ...state.terms, [id]: true };
    bump();
  }
  send({ type: 'termRun', id, command: cmd });
}

// ---- composer and timeline hooks -------------------------------------------------

export function openViewer(src) {
  state.viewer = src;
  bump();
}

export function closeViewer() {
  if (!state.viewer) return;
  state.viewer = null;
  bump();
}

// Double Esc in an idle composer, or "Rewind here" on a message. rewind.jsx renders the picker.
export function openRewind(id, item = '') {
  state.rewindOpen = id;
  state.rewindItem = item;
  bump();
}

export function closeRewind() {
  state.rewindOpen = null;
  state.rewindItem = '';
  bump();
}

// Fork and rewind answer with a reply that carries the nonce; errors come back as text.
export async function forkChat(id, split = false) {
  const r = await request({ type: 'fork', id });
  if (r.error) { toast(r.error, 'error'); return null; }
  state.chats = { ...state.chats, [r.chat.id]: r.chat };
  openChat(r.chat.id, { split });
  return r.chat;
}

export function previewRewind(id, item) {
  return request({ type: 'rewindPreview', id, item });
}

export async function rewindTo(id, item, mode) {
  const r = await request({ type: 'rewind', id, item, mode });
  if (r.error) toast(r.error, 'error');
  return !r.error;
}

export function compactChat(id) {
  send({ type: 'send', id, text: '/compact' });
}

export function stopTask(id, taskId) {
  send({ type: 'stopTask', id, taskId });
}

export async function taskOutput(id, taskId) {
  const r = await request({ type: 'taskOutput', id, taskId });
  return r.error ? '' : r.text;
}

export async function newChat({ accountId, cwd, split }) {
  const chat = await request({ type: 'create', accountId, cwd });
  openChat(chat.id, { split });
  return chat;
}
