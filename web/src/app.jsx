import { cycleEffort } from './effort.jsx';
import { Fragment, useEffect, useRef } from 'react';
import { Palette } from './palette.jsx';
import { ResumePanel } from './sessions.jsx';
import MenuIcon from './icons/solar-sidebar-minimalistic-linear.svg?react';
import CreateIcon from './icons/solar-pen-new-square-linear.svg?react';
import { dismissToast, MAX_PANES, bump, toggleTerm, closePane, closePalette, focusPane, newChat, openPalette, saveUi, send, state, useStore } from './store.js';
import { Sidebar } from './sidebar.jsx';
import { Pane } from './pane.jsx';
import { DiffPanel } from './diff.jsx';
import { Press, IconButton, cn } from './ui.jsx';
import { Folder } from './folder.jsx';
import { ImageViewer } from './attach.jsx';
import { RewindDialog } from './rewind.jsx';

// 6-column grid: 1 | 2 | 3 | 2x2 | 3+2 | 3x2
// Panes per row: 1 | 2 | 3 | 2+2 | 3+2 | 3+3
const ROWS = { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3] };
const MIN_PANE = 240;
const MIN_ROW = 160;

function quickNew(split) {
  const acc = state.settings.defaultAccount || state.accounts.find((a) => a.loggedIn)?.id;
  if (!acc) return;
  const cwd = state.spaceFilter || state.chats[state.panes[state.focused]]?.cwd || state.spaces[0]?.path;
  newChat({ accountId: acc, cwd, split: split && state.panes.length < MAX_PANES });
}

function EmptyFolder() {
  return <span className="reveal-deep"><Folder size={150} /></span>;
}

function Empty() {
  const acc = state.accounts.find((a) => a.loggedIn);
  return (
    <div data-chrome className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 rounded-[22px] bg-[var(--moka-chat)] px-6 text-center">
      <EmptyFolder />
      <span className="rounded-full bg-[var(--moka-card)] px-3.5 py-1.5 text-[13px] text-[var(--moka-muted)]">
        {acc ? 'Pick a chat or start a new one. Alt Shift N opens it in a split.' : 'No logged in Claude Code account. Run claude, log in, reload.'}
      </span>
      {acc && (
        <Press onClick={() => quickNew(false)} className="flex h-11 cursor-pointer items-center gap-2 rounded-full bg-[var(--moka-card)] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--moka-hover)]">
          <CreateIcon className="ico" style={{ fontSize: 18 }} /> New chat
        </Press>
      )}
    </div>
  );
}

const TOAST_DOT = { done: 'bg-[#30d158]', input: 'bg-[#ff9f0a]', error: 'bg-[#ff453a]' };

function Toast({ t }) {
  return (
    <div data-chrome className="note flex max-w-sm items-center gap-3 rounded-[22px] bg-[var(--moka-card)] py-2.5 ps-4 pe-2.5 text-[14px] text-white shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
      {TOAST_DOT[t.kind] && <span className={cn('size-2 shrink-0 rounded-full', TOAST_DOT[t.kind])} />}
      <span className="min-w-0 flex-1">
        <span className={cn('block font-medium', t.kind === 'error' && !t.action && 'text-[#ff453a]')}>{t.text}</span>
        {t.description && <span className="block truncate text-[13px] text-[var(--moka-muted)]">{t.description}</span>}
      </span>
      {t.action && (
        <Press className="h-8 shrink-0 cursor-pointer rounded-full bg-[var(--moka-hover)] px-3.5 text-[13px] font-semibold text-white hover:bg-[#3c3c3c]" onClick={() => { t.action.run(); dismissToast(t); }}>
          {t.action.label}
        </Press>
      )}
    </div>
  );
}

// Split panes: drag the gap between two panes to move their border; double click resets the row.
function startDrag(e, cursorMove, onEnd) {
  e.preventDefault();
  const move = (ev) => cursorMove(ev);
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; onEnd(); };
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function PaneGrid({ rows, multi }) {
  const refs = useRef({});
  const rowRefs = useRef([]);
  const weightsOf = (ids) => (ids.every((id) => state.paneW[id] > 0) ? ids.map((id) => state.paneW[id]) : ids.map(() => 1));
  const rowWeights = rows.length > 1 && state.rowW.length >= rows.length ? state.rowW.slice(0, rows.length) : rows.map(() => 1);
  const colDrag = (e, ids, i) => {
    const px = ids.map((id) => refs.current[id]?.getBoundingClientRect().width || 1);
    for (let j = 0; j < ids.length; j++) state.paneW[ids[j]] = px[j];
    const x0 = e.clientX;
    const [a, b] = [px[i - 1], px[i]];
    startDrag(e, (ev) => {
      const d = Math.min(b - MIN_PANE, Math.max(MIN_PANE - a, ev.clientX - x0));
      state.paneW[ids[i - 1]] = a + d;
      state.paneW[ids[i]] = b - d;
      bump();
    }, saveUi);
  };
  const rowDrag = (e, r) => {
    const h = rowRefs.current.map((el) => el?.getBoundingClientRect().height || 1);
    state.rowW = h.slice();
    const y0 = e.clientY;
    const [a, b] = [h[r - 1], h[r]];
    startDrag(e, (ev) => {
      const d = Math.min(b - MIN_ROW, Math.max(MIN_ROW - a, ev.clientY - y0));
      state.rowW = h.map((v, k) => (k === r - 1 ? a + d : k === r ? b - d : v));
      bump();
    }, saveUi);
  };
  let index = 0;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {rows.map((ids, r) => {
        const w = weightsOf(ids);
        return (
          <Fragment key={r}>
            {r > 0 && (
              <div data-chrome className="h-2 shrink-0 cursor-row-resize" onPointerDown={(e) => rowDrag(e, r)} onDoubleClick={() => { state.rowW = [1, 1]; bump(); saveUi(); }} />
            )}
            <div ref={(el) => { rowRefs.current[r] = el; }} className="flex min-h-0 min-w-0" style={{ flex: `${rowWeights[r]} 1 0px` }}>
              {ids.map((id, i) => {
                const idx = index++;
                return (
                  <Fragment key={id}>
                    {i > 0 && (
                      <div data-chrome className="w-2 shrink-0 cursor-col-resize" onPointerDown={(e) => colDrag(e, ids, i)} onDoubleClick={() => { for (const x of ids) delete state.paneW[x]; bump(); saveUi(); }} />
                    )}
                    <div ref={(el) => { refs.current[id] = el; }} className="flex min-h-0 min-w-0 [&>*]:min-w-0 [&>*]:flex-1" style={{ flex: `${w[i]} 1 0px` }}>
                      <Pane chatId={id} index={state.panes.indexOf(id)} multi={multi} />
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// Drag the sidebar's right edge to resize it; the width is remembered.
function SidebarGrip() {
  const down = (e) => {
    e.preventDefault();
    const move = (ev) => { state.sidebarW = Math.min(560, Math.max(240, ev.clientX)); bump(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; saveUi(); };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      data-chrome
      onPointerDown={down}
      onDoubleClick={() => { state.sidebarW = 320; bump(); saveUi(); }}
      className="fixed top-0 bottom-0 z-40 w-2 cursor-col-resize"
      style={{ left: state.sidebarW - 4 }}
    />
  );
}

export function App() {
  useStore();
  const palette = state.palette; // null | 'all' | 'messages'
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyK') { e.preventDefault(); if (state.palette) closePalette(); else openPalette('all'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === 'KeyN') { e.preventDefault(); quickNew(e.shiftKey); }
      else if (e.code === 'KeyW' && state.panes.length) { e.preventDefault(); closePane(state.focused); }
      else if (e.code === 'KeyT' && state.panes.length) { e.preventDefault(); toggleTerm(state.panes[state.focused]); }
      else if (e.code === 'KeyE' && state.panes.length) { e.preventDefault(); const c = state.chats[state.panes[state.focused]]; if (c) cycleEffort(c); }
      else if (e.code === 'KeyB') { e.preventDefault(); state.sidebar = !state.sidebar; saveUi(); bump(); }
      else if (/^Digit[1-6]$/.test(e.code) && Number(e.code.slice(5)) <= state.panes.length) { e.preventDefault(); focusPane(Number(e.code.slice(5)) - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Panes on screen count as read; the tab title counts what still needs you.
  const chats = Object.values(state.chats);
  useEffect(() => {
    if (document.visibilityState !== 'visible') return;
    for (const id of state.panes) if (state.chats[id]?.unread) send({ type: 'seen', id });
  });
  const waiting = chats.filter((c) => c.status === 'approval').length;
  const working = chats.filter((c) => c.status === 'working').length;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) swrm` : working ? `swrm · ${working} working` : 'swrm';
  }, [waiting, working]);

  const n = state.panes.length;
  const solo = state.solo != null && state.solo < n ? state.solo : null;
  const shown = solo != null ? [state.panes[solo]] : state.panes;
  const rows = [];
  for (let i = 0, k = 0; i < (solo != null ? 1 : n); k++) { const c = solo != null ? 1 : ROWS[n][k]; rows.push(shown.slice(i, i + c)); i += c; }
  const focusedChat = state.chats[state.panes[state.focused]];

  return (
    <div className="grid h-dvh bg-[var(--moka-bg)] text-white" style={{ gridTemplateColumns: state.sidebar ? `${state.sidebarW}px minmax(0,1fr)` : 'minmax(0,1fr)' }}>
      {state.sidebar && <Sidebar />}
      {state.sidebar && <SidebarGrip />}
      <main className={cn('flex min-h-0 min-w-0 flex-col p-2', state.sidebar && 'ps-0')}>
        {!state.sidebar && (
          <div className="fixed top-3 left-2 z-30"><IconButton icon={MenuIcon} size={20} className="bg-[var(--moka-card)]" title="Show chat list (Alt B)" onClick={() => { state.sidebar = true; saveUi(); bump(); }} /></div>
        )}
        <div className="flex min-h-0 flex-1 gap-2">
          {n === 0 ? <Empty /> : (
            <PaneGrid rows={rows} multi={n > 1} />
          )}
          {state.diffOpen && focusedChat && <DiffPanel key={focusedChat.id} chat={focusedChat} />}
        </div>
      </main>
      <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {state.toasts.map((t) => (
          <Toast key={t.id} t={t} />
        ))}
      </div>
      {palette && <Palette mode={palette} onClose={closePalette} />}
      {state.resume && <ResumePanel />}
      <ImageViewer />
      <RewindDialog />
    </div>
  );
}
