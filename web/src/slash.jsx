// Slash menu above the composer: every Claude Code command and skill the account knows,
// filtered as you type after "/". Picking one fills it in; commands without arguments go straight out on Enter.
import { createPortal } from 'react-dom';
import { GlassBorder } from './tma/components/GlassEffect';
import { state } from './store.js';
import { cn } from './ui.jsx';

export function slashMatches(chat, text) {
  const m = /^\/(\S*)$/.exec(text);
  if (!m) return [];
  const q = m[1].toLowerCase();
  const all = state.commands[chat.accountId] || [];
  const starts = all.filter((c) => c.name.toLowerCase().startsWith(q));
  const rest = all.filter((c) => !c.name.toLowerCase().startsWith(q) && (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)));
  // An exact name goes first, so Enter on a full "/usage" sends /usage, not the first longer /usage-credits.
  const exact = starts.filter((c) => c.name.toLowerCase() === q);
  const list = q ? [...exact, ...starts.filter((c) => !exact.includes(c)), ...rest] : starts;
  return list;
}

export function SlashMenu({ list, sel, setSel, pick, anchor, prefix = '/' }) {
  if (!list.length || !anchor) return null;
  const r = anchor.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const snap = (v) => Math.round(v * dpr) / dpr;
  return createPortal(
    <div
      data-chrome
      className="eff-panel fixed z-[1000] flex max-h-[320px] flex-col gap-0.5 overflow-y-auto rounded-[26px] p-2"
      style={{ background: 'var(--glass-tint-background)', backdropFilter: 'blur(8px)', boxShadow: '0 0 10px 0 rgb(0 0 0 / 10%)', left: snap(r.left), width: snap(r.width), bottom: snap(window.innerHeight - r.top + 8), scrollbarWidth: 'none' }}
    >
      <GlassBorder muted />
      {list.map((c, i) => (
        <button
          key={c.path || c.name}
          type="button"
          ref={(el) => { if (el && i === sel) el.scrollIntoView({ block: 'nearest' }); }}
          className={cn('flex min-h-10 w-full cursor-pointer items-baseline gap-2.5 rounded-[18px] px-3.5 py-2 text-left', i === sel && 'bg-white/[0.08]')}
          onMouseEnter={() => setSel(i)}
          onMouseDown={(e) => { e.preventDefault(); pick(c, false); }}
        >
          <span className={cn('text-[14px] font-semibold text-white', c.path ? 'min-w-0 max-w-[60%] truncate' : 'shrink-0')}>{prefix}{c.name}</span>
          {c.argumentHint && <span className="max-w-[34%] shrink truncate text-[13px] text-[var(--moka-muted)]">{c.argumentHint}</span>}
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--moka-muted)]">{c.description}</span>
        </button>
      ))}
    </div>,
    anchor.closest('.tma') ?? document.body,
  );
}
