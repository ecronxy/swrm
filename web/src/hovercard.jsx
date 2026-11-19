// Chat card on hover in the list, after t3code's thread hover card: where it
// works, what it said last, branch and changes, model, mode, account, times.
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { state } from './store.js';
import { ClaudeIcon, accountName, cn, modeLabel, timeAgo } from './ui.jsx';
import BranchIcon from './icons/solar-git-branch-linear.svg?react';
import FolderIcon from './icons/solar-folder-linear.svg?react';
import SnoozeIcon from './icons/solar-alarm-sleep-linear.svg?react';

const CHIP = 'inline-flex h-6 min-w-0 items-center gap-1 rounded-full bg-[var(--moka-hover)] px-2 text-[12px] text-[var(--moka-muted)]';

const ago = (ts) => { const t = timeAgo(ts); return t === 'now' ? 'just now' : `${t} ago`; };

function modelName(chat) {
  if (!chat.model) return 'Default model';
  return (state.models[chat.accountId] || []).find((m) => m.value === chat.model)?.label || chat.model;
}

export function HoverCard({ chat, rect, status }) {
  const el = useRef(null);
  const [top, setTop] = useState(rect.top);
  useLayoutEffect(() => {
    const h = el.current?.offsetHeight || 0;
    setTop(Math.max(8, Math.min(rect.top - 6, window.innerHeight - h - 8)));
  }, [rect.top, chat.preview, chat.name]);
  const git = chat.git;
  return createPortal(
    <div
      ref={el}
      data-chrome
      className="note pointer-events-none fixed z-40 flex w-[300px] flex-col gap-2.5 rounded-[22px] bg-[var(--moka-card)] p-4 text-white shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
      style={{ left: rect.right + 10, top }}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--moka-muted)]">
        <FolderIcon className="ico shrink-0" style={{ fontSize: 13 }} />
        <span className="min-w-0 flex-1 truncate">{chat.cwdLabel || chat.cwd}</span>
        <span className="shrink-0">{status}</span>
      </div>
      <div className="line-clamp-2 text-[15px] leading-snug font-semibold">{chat.name || 'New chat'}</div>
      {chat.preview && <div className="line-clamp-4 text-[13px] leading-[1.45] text-white/70">{chat.preview}</div>}
      <div className="flex flex-wrap gap-1.5">
        {git?.branch && (
          <span className={CHIP}>
            <BranchIcon className="ico shrink-0" style={{ fontSize: 12 }} />
            <span className="max-w-40 truncate">{git.branch}</span>
            {(git.add > 0 || git.del > 0) && (
              <span className="tabular-nums"><span className="text-[#30d158]">+{git.add}</span> <span className="text-[#ff453a]">−{git.del}</span></span>
            )}
          </span>
        )}
        {chat.worktree && <span className={CHIP}>Worktree</span>}
        <span className={CHIP}><ClaudeIcon className="size-3" />{modelName(chat)}</span>
        <span className={CHIP}>{modeLabel(chat.mode)}</span>
        {state.accounts.length > 1 && <span className={CHIP}>{accountName(chat.accountId)}</span>}
      </div>
      <div className={cn('flex items-center gap-1.5 text-[12px] text-[var(--moka-muted)]')}>
        {chat.snoozedUntil ? <><SnoozeIcon className="ico" style={{ fontSize: 12 }} />Snoozed, back {new Date(chat.snoozedUntil).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</> : <>Started {ago(chat.createdAt)} · active {ago(chat.updatedAt)}</>}
      </div>
    </div>,
    document.querySelector('.swrm.tma') ?? document.body, // --moka-* tokens live on .swrm.tma, a body portal got no background
  );
}
