// A real shell per chat, after t3code's terminal drawer: a pty in the chat's
// folder (its worktree when it has one), output kept so a reload replays it.
// Project scripts run here too, like t3code's script buttons.
import pty from 'node-pty';
import fs from 'node:fs';
import path from 'node:path';

const KEEP = 256 * 1024; // replay buffer per terminal

export class Terminals {
  constructor({ broadcast, workdirOf }) {
    this.broadcast = broadcast;
    this.workdirOf = workdirOf;
    this.terms = new Map(); // chatId -> { p, buf, cwd }
  }

  open(id, cols, rows) {
    let t = this.terms.get(id);
    if (!t) {
      const cwd = this.workdirOf(id);
      if (!cwd) throw new Error('Unknown chat');
      const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;
      const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
      const p = pty.spawn(shell, [], { name: 'xterm-256color', cols: cols || 80, rows: rows || 24, cwd, env });
      t = { p, buf: '', cwd };
      // Ready once the shell went quiet after its first prompt, so typed-in scripts don't echo twice.
      let quiet;
      t.ready = new Promise((resolve) => {
        t.markReady = () => { clearTimeout(quiet); quiet = setTimeout(resolve, 250); };
        setTimeout(resolve, 4000);
      });
      this.terms.set(id, t);
      p.onData((data) => {
        t.markReady?.();
        t.buf = (t.buf + data).slice(-KEEP);
        this.broadcast({ type: 'termData', id, data });
      });
      p.onExit(({ exitCode }) => {
        if (this.terms.get(id) !== t) return;
        this.terms.delete(id);
        this.broadcast({ type: 'termExit', id, code: exitCode });
      });
    } else if (cols && rows) {
      this.resize(id, cols, rows);
    }
    return { type: 'termReplay', id, data: t.buf };
  }

  input(id, data) {
    this.terms.get(id)?.p.write(String(data));
  }

  resize(id, cols, rows) {
    const t = this.terms.get(id);
    if (t && cols > 1 && rows > 1) try { t.p.resize(Math.floor(cols), Math.floor(rows)); } catch {}
  }

  run(id, command, cols, rows) {
    const r = this.open(id, cols, rows);
    const t = this.terms.get(id);
    t.ready.then(() => { if (this.terms.get(id) === t) { t.markReady = null; this.input(id, `${command}\r`); } });
    return r;
  }

  kill(id) {
    const t = this.terms.get(id);
    if (!t) return;
    this.terms.delete(id);
    try { t.p.kill(); } catch {}
    this.broadcast({ type: 'termExit', id, code: null });
  }

  killAll() {
    for (const id of [...this.terms.keys()]) this.kill(id);
  }
}

// package.json scripts of the chat's folder, run with whatever the lockfile says.
export function projectScripts(dir) {
  if (!dir) return { scripts: [], runner: 'npm' };
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return { scripts: [], runner: 'npm' }; }
  const has = (f) => fs.existsSync(path.join(dir, f));
  const runner = has('bun.lockb') || has('bun.lock') ? 'bun' : has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
  const order = ['dev', 'start', 'test', 'build', 'lint'];
  const scripts = Object.entries(pkg.scripts || {})
    .filter(([name]) => !/^(pre|post)/.test(name) || order.includes(name))
    .map(([name, command]) => ({ name, command: String(command) }))
    .sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99));
  return { scripts, runner };
}
