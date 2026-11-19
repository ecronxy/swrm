// How full the chat's context window is, as a thin ring with the percentage. Its menu runs /compact.
import { Calligraph } from 'calligraph';
import DropdownMenu from './tma/components/DropdownMenu';
import BroomIcon from './icons/solar-broom-linear.svg?react';
import { compactChat, toast } from './store.js';
import { Press, cn } from './ui.jsx';
import { tokens } from './tasks.jsx';

const COMPACT = 'Compact context';
const R = 6;
const LENGTH = 2 * Math.PI * R;

export function ContextChip({ chat }) {
  const ctx = chat.context;
  if (!ctx || !ctx.max) return null;
  const pct = Math.min(100, ctx.pct || 0);
  const tone = pct >= 90 ? '#ff453a' : pct >= 75 ? '#ff9f0a' : 'var(--moka-accent)';
  return (
    <DropdownMenu
      items={[COMPACT]}
      icons={{ [COMPACT]: BroomIcon }}
      onChange={() => {
        if (chat.status !== 'idle') toast('Wait for the turn to finish, then compact', 'info');
        else compactChat(chat.id);
      }}
      trigger={(aria) => (
        <Press
          {...aria}
          className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2 text-[12px] text-[var(--moka-muted)] tabular-nums transition-colors hover:bg-[var(--moka-hover)] hover:text-white aria-expanded:bg-[var(--moka-hover)]')}
          title={`${tokens(ctx.tokens)} of ${tokens(ctx.max)} tokens in context`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90" aria-hidden>
            <circle cx="8" cy="8" r={R} fill="none" stroke="var(--moka-hover)" strokeWidth="2.25" />
            <circle
              cx="8"
              cy="8"
              r={R}
              fill="none"
              stroke={tone}
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeDasharray={LENGTH}
              strokeDashoffset={LENGTH * (1 - pct / 100)}
              style={{ transition: 'stroke-dashoffset 0.56s var(--ease-keeper), stroke 0.2s ease' }}
            />
          </svg>
          <span className="@max-[30rem]/pane:hidden"><Calligraph variant="number" animation="smooth">{`${Math.round(pct)}%`}</Calligraph></span>
        </Press>
      )}
    />
  );
}
