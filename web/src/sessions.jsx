// Resume a Claude Code session from disk as a swrm chat, grouped by folder, and open a chat
// at a message found by search. Server side: server/sessions.mjs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { bump, openChat, request, state } from './store.js';
import { Folder } from './folder.jsx';
import Spinner from './tma/components/Spinner';
import { Press, cn, folderName, timeAgo } from './ui.jsx';
import ClockIcon from './icons/solar-history-linear.svg?react';

const PAGE = 30; // rows per folder before "show more"
const ACTIVE_MS = 90_000; // a session written this recently may be running in another Claude Code

export function openResume(open = true) {
  state.resume = open;
  bump();
}

// Opens a search hit. A session that is not in swrm yet is resumed first, then the chat opens at the message.
export async function openHit(hit) {
  let chatId = hit.chatId;
  if (hit.kind === 'session') {
    const r = await request({ type: 'resume', accountId: hit.accountId, sessionId: hit.sessionId });
    if (!r) return;
    chatId = r.chat.id;
  }
  state.jump = { chat: chatId, id: hit.itemId };
  openChat(chatId);
}

// Called by Pane. When a jump is pending for this chat and its message is rendered, centre it and flash it.
// Thread marks each turn with data-ids (all item ids in it), so the element is found by id.
export function useJump(chatId, scroller, stick, items) {
  const jump = state.jump;
  useEffect(() => {
    if (!jump || jump.chat !== chatId || !scroller.current) return;
    const el = [...scroller.current.querySelectorAll('[data-ids]')].find((n) => n.dataset.ids.split(' ').includes(jump.id));
    // History not loaded yet: keep the jump, the effect runs again when items arrive.
    if (!el && !items?.length) return;
    state.jump = null;
    if (!el) return;
    stick.current = false; // otherwise the next render snaps back to the bottom
    el.scrollIntoView({ block: 'center' });
    el.classList.add('hit-flash');
    setTimeout(() => el.classList.remove('hit-flash'), 1600);
  }, [items, jump]);
}

function Row({ s, open, busy, onPick }) {
  const active = !open && Date.now() - s.updatedAt < ACTIVE_MS;
  const meta = [s.branch, s.accountName, s.messages === 1 ? '1 message' : `${s.messages} messages`].filter(Boolean).join(' · ');
  return (
    <Press
      as="div"
      role="button"
      tabIndex={0}
      title={s.cwdLabel}
      className={cn('flex w-full cursor-pointer items-center gap-3 rounded-[11px] px-2.5 py-2 text-left hover:bg-white/[0.07]', busy && 'opacity-60')}
      onClick={onPick}
      onKeyDown={(e) => e.key === 'Enter' && onPick()}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-white">{s.title}</span>
        <span className="block truncate text-[12px] text-[var(--moka-muted)]">{meta}</span>
      </span>
      {open && <span className="shrink-0 text-[12px] font-medium text-[var(--moka-accent)]">Open</span>}
      {active && <span className="shrink-0 text-[12px] font-medium text-[#ff9f0a]">Active elsewhere</span>}
      <span className="shrink-0 text-[12px] text-[var(--moka-muted)] tabular-nums">{timeAgo(s.updatedAt)}</span>
    </Press>
  );
}

export function ResumePanel() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [shown, setShown] = useState({}); // folder -> rows shown
  const input = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    request({ type: 'sessions' }).then((r) => { if (alive.current) setList(r?.sessions || []); });
    input.current?.focus();
    return () => { alive.current = false; };
  }, []);

  // Session id -> swrm chat that already runs it.
  const openBy = new Map(Object.values(state.chats).filter((c) => c.sessionId).map((c) => [c.sessionId, c.id]));
  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const m = new Map(); // list is newest first, so the groups are too
    for (const s of list || []) {
      if (needle && ![s.title, s.cwdLabel, s.branch, s.accountName].some((x) => String(x || '').toLowerCase().includes(needle))) continue;
      if (!m.has(s.cwd)) m.set(s.cwd, []);
      m.get(s.cwd).push(s);
    }
    return [...m.entries()];
  }, [list, needle]);

  const pick = async (s) => {
    if (busy) return;
    setBusy(s.id);
    try {
      const r = await request({ type: 'resume', accountId: s.accountId, sessionId: s.id });
      if (r) { openResume(false); openChat(r.chat.id); }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <div
      data-chrome
      className="palette-overlay fixed inset-0 z-[60] grid place-items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) openResume(false); }}
    >
      <div className="note flex max-h-[72vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[22px] bg-[var(--moka-card)] shadow-[0_30px_80px_-20px_rgb(0_0_0/70%)]" style={{ transformOrigin: '50% 0' }}>
        <div className="flex h-13 shrink-0 items-center gap-2.5 px-4">
          <ClockIcon className="ico text-[var(--moka-muted)]" style={{ fontSize: 18 }} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); openResume(false); } }}
            placeholder="Resume a session"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[var(--moka-muted)]"
          />
          <span className="rounded-full bg-[var(--moka-hover)] px-2 py-0.5 text-[11px] text-[var(--moka-muted)]">Esc</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/5 p-1.5">
          {list === null && <div className="flex justify-center py-10"><Spinner size={18} /></div>}
          {list && !groups.length && <p className="px-3 py-6 text-center text-[13px] text-[var(--moka-muted)]">{list.length ? 'Nothing found' : 'No sessions on disk'}</p>}
          {groups.map(([cwd, rows]) => {
            const n = shown[cwd] || PAGE;
            return (
              <section key={cwd}>
                <h3 className="mx-2.5 mt-2 mb-1 flex items-center gap-2 text-[12px] font-medium text-[var(--moka-muted)]">
                  <Folder size={16} />
                  <span className="truncate text-white/85">{folderName(cwd)}</span>
                  <span className="min-w-0 flex-1 truncate font-normal">{rows[0].cwdLabel}</span>
                  <span className="tabular-nums">{rows.length}</span>
                </h3>
                {rows.slice(0, n).map((s) => (
                  <Row key={s.id} s={s} open={openBy.has(s.id)} busy={busy === s.id} onPick={() => pick(s)} />
                ))}
                {rows.length > n && (
                  <Press className="mx-1 my-0.5 flex h-8 w-[calc(100%-0.5rem)] cursor-pointer items-center rounded-[11px] px-2.5 text-[12px] text-[var(--moka-muted)] hover:text-white" onClick={() => setShown((x) => ({ ...x, [cwd]: n + PAGE }))}>
                    Show {rows.length - n} more
                  </Press>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
