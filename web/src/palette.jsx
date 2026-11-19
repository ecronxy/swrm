// Ctrl K: jump to any chat or folder, or run an action. Logic after t3code's
// CommandPalette (threads, projects, actions, arrow keys); look after sdkhub's
// search (blurred overlay, note pop, rows with radius 11 and a soft active tint).
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PANES, bump, newChat, openChat, request, saveUi, send, state } from './store.js';
import { ClaudeIcon, cn, folderName, timeAgo } from './ui.jsx';
import { Folder } from './folder.jsx';
import { spaceName } from './sidebar.jsx';
import { openHit, openResume } from './sessions.jsx';
import ClockIcon from './icons/solar-history-linear.svg?react';
import SearchIcon from './icons/solar-magnifer-linear.svg?react';
import PenIcon from './icons/solar-pen-new-square-linear.svg?react';
import SplitIcon from './icons/solar-columns-2-linear.svg?react';
import SidebarIcon from './icons/solar-sidebar-minimalistic-linear.svg?react';
import RefreshIcon from './icons/solar-bolt-linear.svg?react';

function score(text, q) {
  const t = String(text || '').toLowerCase();
  if (!q) return 1;
  const i = t.indexOf(q);
  if (i === 0) return 3;
  if (i > 0) return 2;
  // all query letters in order
  let k = 0;
  for (const ch of t) if (ch === q[k]) k++;
  return k === q.length ? 1 : 0;
}

function Mark({ text, q }) {
  const s = String(text || '');
  const i = q ? s.toLowerCase().indexOf(q) : -1;
  if (i < 0) return s;
  return <>{s.slice(0, i)}<mark className="bg-transparent font-bold text-inherit">{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
}

function startChat(split) {
  const acc = state.settings.defaultAccount || state.accounts.find((a) => a.loggedIn)?.id;
  if (!acc) return;
  const cwd = state.spaceFilter || state.chats[state.panes[state.focused]]?.cwd || state.spaces[0]?.path;
  newChat({ accountId: acc, cwd, split: split && state.panes.length < MAX_PANES });
}

// mode 'messages' is the search button in the sidebar: only the message search, from the first key.
export function Palette({ mode = 'all', onClose }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const query = q.trim().toLowerCase();
  const [hits, setHits] = useState([]);
  const seq = useRef(0);
  const trimmed = q.trim();
  // Message search goes to the server (every swrm chat, session titles); a stale answer is dropped.
  useEffect(() => {
    const id = ++seq.current;
    if (trimmed.length < 2) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      request({ type: 'search', q: trimmed }).then((r) => { if (id === seq.current && r) setHits(r.results); });
    }, 180);
    return () => clearTimeout(t);
  }, [trimmed]);

  const sections = useMemo(() => {
    const chats = Object.values(state.chats)
      .map((c) => ({ c, s: Math.max(score(c.name || 'New chat', query) * 2, score(folderName(c.cwd), query), (query && String(c.preview || '').toLowerCase().includes(query) ? 1 : 0)) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.c.updatedAt - a.c.updatedAt)
      .slice(0, 8)
      .map(({ c }) => ({
        key: `c${c.id}`,
        icon: <span className="flex size-6 items-center justify-center"><ClaudeIcon className="size-4" /></span>,
        title: c.name || 'New chat',
        hint: `${folderName(c.cwd)} · ${timeAgo(c.updatedAt)}`,
        run: (split) => openChat(c.id, { split: split && !state.panes.includes(c.id) && state.panes.length < MAX_PANES }),
      }));
    const folders = state.spaces
      .filter((sp) => score(spaceName(sp), query) || score(sp.path, query))
      .map((sp) => ({
        key: `s${sp.path}`,
        icon: <span className="flex size-6 items-center justify-center"><Folder size={20} /></span>,
        title: spaceName(sp),
        hint: sp.path,
        run: () => { state.spaceFilter = sp.path; saveUi(); bump(); },
      }));
    const actions = [
      { key: 'new', Icon: PenIcon, title: 'New chat', hint: 'Alt N', run: () => startChat(false) },
      { key: 'split', Icon: SplitIcon, title: 'New chat in split', hint: 'Alt Shift N', run: () => startChat(true) },
      { key: 'side', Icon: SidebarIcon, title: state.sidebar ? 'Hide sidebar' : 'Show sidebar', hint: 'Alt B', run: () => { state.sidebar = !state.sidebar; saveUi(); bump(); } },
      { key: 'lim', Icon: RefreshIcon, title: 'Refresh limits', hint: '', run: () => send({ type: 'refreshLimits' }) },
      { key: 'resume', Icon: ClockIcon, title: 'Resume session', hint: '', run: () => openResume(true) },
    ]
      .filter((a) => score(a.title, query))
      .map((a) => ({ ...a, icon: <span className="flex size-6 items-center justify-center text-[var(--moka-muted)]"><a.Icon className="ico" style={{ fontSize: 17 }} /></span> }));
    const messages = hits.map((h, i) => ({
      key: `m${i}${h.itemId}`,
      icon: <span className="flex size-6 items-center justify-center"><ClaudeIcon className="size-4" /></span>,
      node: (
        <>
          <span className="text-[var(--moka-muted)]">{h.before}</span>
          <mark className="bg-transparent font-semibold text-[var(--moka-accent)]">{h.match}</mark>
          <span className="text-[var(--moka-muted)]">{h.after}</span>
        </>
      ),
      title: h.match,
      hint: `${h.kind === 'session' ? `${h.cwdLabel} · session` : h.chatName} · ${timeAgo(h.ts || Date.now())}`,
      run: () => openHit(h),
    }));
    const groups = mode === 'messages' ? [] : [['Chats', chats], ['Folders', folders], ['Actions', actions]];
    return [...groups, ['Messages', messages]].filter(([, l]) => l.length);
  }, [query, mode, hits]);

  const flat = sections.flatMap(([, l]) => l);
  useEffect(() => { setActive(0); }, [query, hits]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (item, split = false) => { onClose(); item?.run(split); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % Math.max(1, flat.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + flat.length) % Math.max(1, flat.length)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[active], e.ctrlKey || e.metaKey); }
  };

  let n = -1;
  return (
    <div
      data-chrome
      className="palette-overlay fixed inset-0 z-[60] grid place-items-start justify-center bg-black/30 px-4 pt-[14vh] backdrop-blur-[3px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="note w-full max-w-[560px] overflow-hidden rounded-[22px] bg-[var(--moka-card)] shadow-[0_30px_80px_-20px_rgb(0_0_0/70%)]" style={{ transformOrigin: '50% 0' }}>
        <div className="flex h-13 items-center gap-2.5 px-4">
          <SearchIcon className="ico text-[var(--moka-muted)]" style={{ fontSize: 18 }} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={onKey}
            placeholder={mode === 'messages' ? 'Search messages' : 'Search chats, folders, actions'}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[var(--moka-muted)]"
          />
          <span className="rounded-full bg-[var(--moka-hover)] px-2 py-0.5 text-[11px] text-[var(--moka-muted)]">Esc</span>
        </div>
        <div ref={list} className="palette-results max-h-[52vh] overflow-y-auto border-t border-white/5 p-1.5">
          {!flat.length && <p className="px-3 py-6 text-center text-[13px] text-[var(--moka-muted)]">{trimmed.length < 2 && mode === 'messages' ? 'Type at least two letters' : 'Nothing found'}</p>}
          {sections.map(([label, items]) => (
            <section key={label}>
              <h3 className="mx-2.5 mt-1.5 mb-0.5 text-[10.5px] leading-4 font-semibold text-[var(--moka-muted)]">{label}</h3>
              {items.map((it) => {
                n++;
                const on = n === active;
                const idx = n;
                return (
                  <button
                    key={it.key}
                    type="button"
                    data-active={on || undefined}
                    className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] px-2 py-1.5 text-left text-[13px] text-white', on && 'bg-white/[0.07]')}
                    onMouseMove={() => setActive(idx)}
                    onClick={(e) => run(it, e.ctrlKey || e.metaKey)}
                  >
                    {it.icon}
                    <span className="min-w-0 flex-1 truncate">{it.node || <Mark text={it.title} q={query} />}</span>
                    {it.hint && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-[var(--moka-muted)]">{it.hint}</span>}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
