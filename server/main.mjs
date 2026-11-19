import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Accounts } from './accounts.mjs';
import { Chats } from './chats.mjs';
import * as attachments from './attachments.mjs';
import { Terminals, projectScripts } from './terminals.mjs';
import { listSessions, publicSessions, resumeSession, searchAll, warmSessions } from './sessions.mjs';
import { loadConfig } from './paths.mjs';
import { searchFiles } from './files.mjs';

const DIST = process.env.SWRM_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

export function startServer({ open = true } = {}) {
  const config = loadConfig();
  const port = Number(process.env.SWRM_PORT || config.port || 4141);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  if (process.env.SWRM_DEV) for (const h of ['127.0.0.1:5173', 'localhost:5173']) origins.add(`http://${h}`);

  const clients = new Set();
  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(data);
  };

  const accounts = new Accounts(config, () => broadcast({ type: 'accounts', accounts: accounts.public() }));
  const chats = new Chats({ accounts, config, broadcast });
  const terms = new Terminals({ broadcast, workdirOf: (id) => chats.workdirOf(id) });
  accounts.scan();
  if (!chats.settings.defaultAccount) chats.settings.defaultAccount = accounts.list.find((a) => a.loggedIn)?.id || accounts.list[0]?.id || '';
  accounts.start();
  chats.preloadModels();
  warmSessions(accounts);

  const server = http.createServer((req, res) => {
    // Only this machine may talk to us: the page drives agents that can run commands.
    if (!hosts.has(req.headers.host || '')) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/att/')) {
      attachments.handleHttp(req, res, url, {
        hasChat: (id) => chats.chats.has(id),
        originOk: !req.headers.origin || origins.has(req.headers.origin),
      });
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
    let file = path.normalize(path.join(DIST, pathname));
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('swrm: run `npm run build` first');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    const rs = fs.createReadStream(file);
    rs.on('error', () => res.destroy());
    rs.pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const okHost = hosts.has(req.headers.host || '') || (process.env.SWRM_DEV && origins.has(req.headers.origin || ''));
    if (new URL(req.url, 'http://x').pathname !== '/ws' || !okHost || !origins.has(req.headers.origin || '')) {
      if (process.env.SWRM_DEBUG) console.error('ws rejected', req.url, req.headers.host, req.headers.origin);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  // Replies that the client awaits by nonce: the payload, or the error text of a failed call.
  const asking = (fn) => async (m, reply) => {
    try { reply({ type: 'reply', nonce: m.nonce, ...(await fn(m)) }); } catch (e) { reply({ type: 'reply', nonce: m.nonce, error: String(e?.message || e) }); }
  };

  const handlers = {
    // A desktop notification while the window is not in front. WebKitGTK has no web Notification, so the server asks the desktop.
    notify: (m) => {
      const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
      spawn('notify-send', ['-a', 'swrm', '-u', m.urgent ? 'critical' : 'normal', '-t', '10000', '--', clip(m.title, 80), clip(m.body, 160)], { stdio: 'ignore' })
        .on('error', () => {}).unref();
    },
    create: (m, reply) => reply({ type: 'created', chat: chats.create(m), nonce: m.nonce }),
    send: (m) => chats.send(m.id, m.text, m.attachments),
    unqueue: (m) => chats.unqueue(m.id, m.qid),
    sendNow: (m) => chats.sendNow(m.id, m.qid),
    interrupt: (m) => chats.interrupt(m.id),
    answer: (m) => chats.answer(m.id, m.permId, m.decision, m.answers),
    rename: (m) => chats.rename(m.id, m.name),
    remove: (m) => { terms.kill(m.id); return chats.remove(m.id); },
    seen: (m) => chats.seen(m.id),
    setModel: (m) => chats.setModel(m.id, m.model),
    setMode: (m) => chats.setMode(m.id, m.mode),
    setEffort: (m) => chats.setEffort(m.id, m.effort),
    history: (m, reply) => { const h = chats.history(m.id); if (h) reply(h); },
    addSpace: (m) => chats.addSpace(m.path),
    removeSpace: (m) => chats.removeSpace(m.path),
    settings: (m) => chats.setSettings(m.settings || {}),
    refreshLimits: () => accounts.refreshAll(),
    setWorktree: (m) => chats.setWorktree(m.id, m.on),
    snooze: (m) => chats.snooze(m.id, m.until),
    fork: asking(async (m) => ({ chat: await chats.fork(m.id) })),
    rewindPreview: asking(async (m) => ({ preview: await chats.rewindPreview(m.id, m.item) })),
    rewind: asking(async (m) => { await chats.rewind(m.id, m.item, m.mode); return {}; }),
    stopTask: (m) => chats.stopTask(m.id, m.taskId),
    taskOutput: asking(async (m) => ({ text: await chats.taskOutput(m.id, m.taskId) })),
    mcp: (m) => chats.mcpAction(m.id, m.action, m.name, m.enabled),
    files: async (m, reply) => reply({ type: 'files', id: m.id, nonce: m.nonce, list: await searchFiles(chats.workdirOf(m.id), String(m.q || '').slice(0, 200)) }),
    rules: (m, reply) => reply({ type: 'rules', id: m.id, nonce: m.nonce, rules: chats.rulesOf(m.id) }),
    ruleRemove: (m, reply) => reply({ type: 'rules', id: m.id, nonce: m.nonce, rules: chats.removeRule(m.id, m.scope, m.behavior, m.rule) }),
    diff: async (m, reply) => { const d = await chats.diff(m.id); if (d) reply(d); },
    commit: async (m, reply) => { const d = await chats.commit(m.id, m.message); if (d) reply(d); },
    push: async (m, reply) => { const d = await chats.push(m.id); if (d) reply(d); },
    scripts: (m, reply) => reply({ type: 'scripts', id: m.id, ...projectScripts(chats.workdirOf(m.id)) }),
    termOpen: (m, reply) => reply(terms.open(m.id, m.cols, m.rows)),
    termInput: (m) => terms.input(m.id, m.data),
    termResize: (m) => terms.resize(m.id, m.cols, m.rows),
    termRun: (m, reply) => reply(terms.run(m.id, m.command, m.cols, m.rows)),
    termKill: (m) => terms.kill(m.id),
    sessions: async (m, reply) => reply({ type: 'sessions', nonce: m.nonce, sessions: publicSessions(await listSessions(accounts)) }),
    resume: (m, reply) => reply({ ...resumeSession({ accounts, chats, accountId: m.accountId, sessionId: m.sessionId }), nonce: m.nonce }),
    search: (m, reply) => reply({ type: 'search', nonce: m.nonce, results: searchAll({ chats, q: m.q }) }),
  };

  wss.on('connection', (ws) => {
    clients.add(ws);
    const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
    reply({ ...chats.snapshot(), accounts: accounts.public() });
    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      const fn = handlers[m?.type];
      if (!fn) return;
      try {
        await fn(m, reply);
      } catch (e) {
        reply({ type: 'toast', kind: 'error', text: String(e?.message || e), id: m.id, nonce: m.nonce, for: m.type });
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`swrm on ${url}`);
    if (open && !process.env.SWRM_DEV) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      try { spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    }
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `swrm: port ${port} is busy (set SWRM_PORT)` : e);
    process.exit(1);
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    chats.flushAll();
    chats.stopAll();
    terms.killAll();
    accounts.stop();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
