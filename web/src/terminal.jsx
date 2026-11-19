// Terminal drawer under the chat, after t3code: a real shell (pty on the server)
// in the chat's folder, or its worktree. Hiding it keeps the shell running.
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { bump, saveUi, send, state, termListeners, toggleTerm } from './store.js';
import { IconButton, folderName } from './ui.jsx';
import CloseIcon from './icons/solar-close-circle-linear.svg?react';
import TrashIcon from './icons/solar-trash-bin-minimalistic-linear.svg?react';

const THEME = {
  background: '#282828',
  foreground: '#e8e8ea',
  cursor: '#0a84ff',
  cursorAccent: '#282828',
  selectionBackground: 'rgba(10,132,255,0.35)',
  black: '#1c1c1c', red: '#ff453a', green: '#30d158', yellow: '#ffd60a', blue: '#0a84ff', magenta: '#bf5af2', cyan: '#64d2ff', white: '#e8e8ea',
  brightBlack: '#8e8e93', brightRed: '#ff6961', brightGreen: '#4cd964', brightYellow: '#ffe066', brightBlue: '#409cff', brightMagenta: '#da8fff', brightCyan: '#8be3ff', brightWhite: '#ffffff',
};

export function TerminalDrawer({ chat }) {
  const host = useRef(null);
  const id = chat.id;

  useEffect(() => {
    const term = new XTerm({
      fontFamily: 'ui-monospace, "JetBrainsMono Nerd Font", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    const size = () => { try { fit.fit(); } catch {} return { cols: term.cols, rows: term.rows }; };
    termListeners.set(id, (m) => {
      if (m.type === 'termReplay') { term.reset(); term.write(m.data); }
      else if (m.type === 'termData') term.write(m.data);
    });
    send({ type: 'termOpen', id, ...size() });
    term.focus();
    const sub = term.onData((data) => send({ type: 'termInput', id, data }));
    const ro = new ResizeObserver(() => {
      const s = size();
      send({ type: 'termResize', id, ...s });
    });
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      sub.dispose();
      if (termListeners.get(id)) termListeners.delete(id);
      term.dispose();
    };
  }, [id]);

  // After a reconnect the server may have restarted: ask for the shell again.
  const seen = useRef(state.connected);
  useEffect(() => {
    if (state.connected && !seen.current) send({ type: 'termOpen', id });
    seen.current = state.connected;
  }, [state.connected]);

  return (
    <div className="shrink-0 px-3 pb-3">
      <div data-chrome className="banner mx-auto w-full max-w-(--chat-content-max-width)">
        <div className="rounded-[22px] bg-[var(--moka-card)]">
          <div
            className="group flex h-3 cursor-row-resize items-center justify-center"
            onPointerDown={(e) => {
              e.preventDefault();
              const y0 = e.clientY;
              const h0 = state.termH;
              const move = (ev) => { state.termH = Math.min(Math.round(window.innerHeight * 0.75), Math.max(120, h0 + (y0 - ev.clientY))); bump(); };
              const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; saveUi(); };
              document.body.style.userSelect = 'none';
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            onDoubleClick={() => { state.termH = 256; bump(); saveUi(); }}
          >
            <span className="h-1 w-9 rounded-full bg-white/10 transition-colors group-hover:bg-white/25" />
          </div>
          <div className="flex h-10 items-center gap-2 ps-4 pe-1.5 text-[13px]">
            <span className="font-medium text-white">Terminal</span>
            <span className="min-w-0 flex-1 truncate text-[var(--moka-muted)]">{chat.worktree ? chat.worktree.branch : folderName(chat.cwd)}</span>
            <IconButton icon={TrashIcon} size={16} title="Kill the shell" onClick={() => send({ type: 'termKill', id })} />
            <IconButton icon={CloseIcon} size={18} title="Hide (keeps running)" onClick={() => toggleTerm(id, false)} />
          </div>
          <div ref={host} className="ps-3 pe-1 pb-2" style={{ height: state.termH }} />
        </div>
      </div>
    </div>
  );
}
