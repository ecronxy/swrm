// Claude accounts are plain Claude Code config dirs (~/.claude, ~/.claude2, ...).
// A chat runs on an account by starting Claude Code with CLAUDE_CONFIG_DIR set to it.
// Plan limits come from the same OAuth usage endpoint Claude Code's /usage reads.
// The access token never leaves this process: only percentages go to the page.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, readJson, tildify } from './paths.mjs';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const POLL_MS = 120_000;

function readCredentials(dir) {
  const raw = readJson(path.join(dir, '.credentials.json'));
  const o = raw?.claudeAiOauth;
  if (!o?.accessToken) return null;
  return { token: o.accessToken, expiresAt: Number(o.expiresAt) || 0, plan: o.subscriptionType || '' };
}

function readEmail(dir) {
  const own = readJson(path.join(dir, '.claude.json'));
  if (own?.oauthAccount?.emailAddress) return own.oauthAccount.emailAddress;
  // Plain `claude` without CLAUDE_CONFIG_DIR keeps its global file next to ~/.claude.
  if (dir === path.join(HOME, '.claude')) return readJson(path.join(HOME, '.claude.json'))?.oauthAccount?.emailAddress || '';
  return '';
}

function windowOf(key, label, bucket) {
  if (!bucket || bucket.utilization == null) return null;
  const pct = Math.max(0, Math.min(100, Number(bucket.utilization)));
  return { key, label, pct, resetsAt: bucket.resets_at || null };
}

function parseUsage(p) {
  // Newer responses carry a flat `limits` list that includes per-model weekly windows.
  if (Array.isArray(p.limits) && p.limits.length) {
    return p.limits
      .filter((l) => l && l.percent != null)
      .map((l, i) => {
        const model = l.scope?.model?.display_name;
        const label = l.kind === 'session' ? '5h' : l.kind === 'weekly_all' ? 'week' : String(model || l.kind || 'limit').toLowerCase();
        return {
          key: `${l.kind}:${model || i}`,
          label,
          pct: Math.max(0, Math.min(100, Number(l.percent))),
          resetsAt: l.resets_at || null,
          severity: l.severity || 'normal',
        };
      });
  }
  const list = [
    windowOf('five_hour', '5h', p.five_hour),
    windowOf('seven_day', 'week', p.seven_day),
    ...(p.model_scoped || []).map((m) => windowOf(`model:${m.display_name}`, String(m.display_name || '').toLowerCase(), m)),
    windowOf('seven_day_opus', 'opus', p.seven_day_opus),
    windowOf('seven_day_sonnet', 'sonnet', p.seven_day_sonnet),
  ];
  return list.filter(Boolean);
}

export class Accounts {
  constructor(config, onChange) {
    this.config = config;
    this.onChange = onChange;
    this.list = [];
    this.timers = new Map();
    this.backoffUntil = new Map();
  }

  scan() {
    let entries = Array.isArray(this.config.accounts) && this.config.accounts.length
      ? this.config.accounts.map((a) => ({ id: a.id, name: a.name, dir: a.dir.replace(/^~(?=\/|$)/, HOME) }))
      : fs.readdirSync(HOME)
        .filter((n) => /^\.claude\d*$/.test(n))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        .map((n) => ({ id: n.slice(1), dir: path.join(HOME, n) }));
    entries = entries.filter((a) => {
      try { return fs.statSync(a.dir).isDirectory(); } catch { return false; }
    });
    const old = new Map(this.list.map((a) => [a.id, a]));
    this.list = entries.map((a) => {
      const creds = readCredentials(a.dir);
      const prev = old.get(a.id);
      return {
        id: a.id,
        name: a.name || a.id,
        dir: a.dir,
        label: tildify(a.dir),
        email: readEmail(a.dir),
        plan: creds?.plan || '',
        loggedIn: !!creds,
        limits: prev?.limits || [],
        limitsError: prev?.limitsError || '',
        limitsAt: prev?.limitsAt || 0,
      };
    });
    this.onChange();
  }

  get(id) {
    return this.list.find((a) => a.id === id);
  }

  public() {
    return this.list.map(({ dir, ...rest }) => rest);
  }

  async refresh(id) {
    const acc = this.get(id);
    if (!acc) return;
    const creds = readCredentials(acc.dir);
    acc.loggedIn = !!creds;
    acc.plan = creds?.plan || acc.plan;
    if (!creds) {
      acc.limitsError = 'not logged in';
      this.onChange();
      return;
    }
    if (creds.expiresAt && creds.expiresAt < Date.now()) {
      // Claude Code refreshes the token itself whenever a chat runs on this account.
      acc.limitsError = 'token expired, run a chat on it';
      this.onChange();
      return;
    }
    if ((this.backoffUntil.get(id) || 0) > Date.now()) return;
    try {
      const res = await fetch(USAGE_URL, {
        headers: { Authorization: `Bearer ${creds.token}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 300;
        this.backoffUntil.set(id, Date.now() + wait * 1000);
        acc.limitsError = 'usage endpoint busy';
      } else if (!res.ok) {
        acc.limitsError = `usage ${res.status}`;
      } else {
        acc.limits = parseUsage(await res.json());
        acc.limitsError = '';
        acc.limitsAt = Date.now();
      }
    } catch (e) {
      acc.limitsError = e?.name === 'TimeoutError' ? 'usage timeout' : 'usage unreachable';
    }
    this.onChange();
  }

  refreshAll() {
    this.scan();
    return Promise.all(this.list.map((a) => this.refresh(a.id)));
  }

  // Called after every turn and on rate limit events: one fetch per burst.
  scheduleRefresh(id, delay = 4000) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.refresh(id), delay));
  }

  start() {
    this.refreshAll();
    this.poll = setInterval(() => this.refreshAll(), POLL_MS);
  }

  stop() {
    clearInterval(this.poll);
    for (const t of this.timers.values()) clearTimeout(t);
  }
}
