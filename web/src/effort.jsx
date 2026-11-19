// Effort picker: a chip in the composer opens a slider popover (green to blue track, sparkles, white thumb).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Press, cn } from './ui.jsx';
import { send, state } from './store.js';
import { Calligraph } from 'calligraph';
import { GlassBorder } from './tma/components/GlassEffect';
import './effort.css';

const ALL = [
  { v: '', label: 'Auto', short: 'Auto', hint: 'The model decides how hard to think' },
  { v: 'low', label: 'Low', short: 'Low', hint: 'Quick answers, little thinking' },
  { v: 'medium', label: 'Medium', short: 'Med', hint: 'Balanced speed and depth' },
  { v: 'high', label: 'High', short: 'High', hint: 'Thorough, thinks before it acts' },
  { v: 'xhigh', label: 'Extra high', short: 'XHigh', hint: 'Deep thinking, slower and pricier' },
  { v: 'max', label: 'Max', short: 'Max', hint: 'Deepest thinking, slowest' },
];

// Levels the chat's model supports; Auto is always there. Unknown model info shows everything.
export function levelsFor(chat) {
  const list = state.models[chat.accountId] || [];
  const info = list.find((m) => m.value === (chat.model || 'default'));
  const ok = info?.efforts?.length ? info.efforts : null;
  return ALL.filter((l) => !l.v || !ok || ok.includes(l.v));
}

export function cycleEffort(chat) {
  const levels = levelsFor(chat);
  const i = Math.max(0, levels.findIndex((l) => l.v === (chat.effort || '')));
  send({ type: 'setEffort', id: chat.id, effort: levels[(i + 1) % levels.length].v });
}

// coral that gets deeper with the level
const mix = (a, b, t) => Math.round(a + (b - a) * t);
const fillColor = (t) => `rgb(${mix(230, 212, t)} ${mix(165, 87, t)} ${mix(141, 58, t)})`;

// Device-pixel snapping: on a scaled screen (125%, 150%) a 2px tick lands between pixels and renders 1px or 2px wide.
// Width, height and position are all rounded to whole device pixels so every tick is drawn identically.
const snapTo = (v, dpr) => Math.round(v * dpr) / dpr;
const TRACK_W = 232; // popup 264 minus 2 * 16 padding
function tickStyle(i, n, dpr) {
  const w = Math.max(1, Math.round(2 * dpr)) / dpr;
  const h = snapTo(6 + (n > 1 ? i / (n - 1) : 0) * 12, dpr); // 6px for the first step up to 18px for the last
  return { left: snapTo(14 + (n > 1 ? i / (n - 1) : 0) * (TRACK_W - 28) - w / 2, dpr), top: snapTo((28 - h) / 2, dpr), width: w, height: h, margin: 0 };
}

function Panel({ chat, levels, anchor, onClose }) {
  const idx = Math.max(0, levels.findIndex((l) => l.v === (chat.effort || '')));
  const n = levels.length;
  const track = useRef(null);
  // The thumb always sits on a step and follows local state, not the server's echo,
  // so a slow round trip can never pull it back to the old step and make it jump.
  const [sel, setSel] = useState(idx);
  const [down, setDown] = useState(false);
  const grab = useRef(0);
  const lastPick = useRef(0);
  useEffect(() => { if (Date.now() - lastPick.current > 800) setSel(idx); }, [idx]);
  const pick = (i) => {
    if (i === sel) return;
    lastPick.current = Date.now();
    setSel(i);
    send({ type: 'setEffort', id: chat.id, effort: levels[i].v });
  };
  const shown = sel;
  const p = n > 1 ? sel / (n - 1) : 0;

  // Step under the pointer; grab keeps the thumb from re-centering when it is pressed off-center.
  const stepAt = (e) => {
    const r = track.current.getBoundingClientRect();
    const th = 22, pad = 3;
    const f = (e.clientX - grab.current - r.left - pad - th / 2) / (r.width - th - 2 * pad);
    return Math.round(Math.min(1, Math.max(0, f)) * (n - 1));
  };
  const rect = anchor.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const out = (e) => { if (!e.target.closest?.('.eff-panel') && !anchor.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); };
  }, [anchor, onClose]);

  return createPortal(
    <div
      className="eff-panel fixed z-[1000] w-[264px] rounded-[26px] p-4"
      style={{ background: 'var(--glass-tint-background)', backdropFilter: 'blur(8px)', boxShadow: '0 0 10px 0 rgb(0 0 0 / 10%)', left: snapTo(Math.max(8, Math.min(rect.left, window.innerWidth - 272)), dpr), bottom: snapTo(window.innerHeight - rect.top + 8, dpr) }}
    >
      <GlassBorder muted />
      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="text-[13px] text-[var(--moka-muted)]">Effort</span>
        <span className="text-[14px] font-semibold text-white"><Calligraph variant="text" animation="smooth">{levels[shown].label}</Calligraph></span>
        <span className="ms-auto text-[12px] text-[var(--moka-muted)]">Alt E</span>
      </div>
      <div
        ref={track}
        className="eff"
        role="slider"
        tabIndex={0}
        aria-label="Effort"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={sel}
        aria-valuetext={levels[sel].label}
        data-drag={down || undefined}
        style={{ '--p': p }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const t = e.target.closest?.('.eff-thumb');
          grab.current = t ? e.clientX - (t.getBoundingClientRect().left + t.offsetWidth / 2) : 0;
          setDown(true);
          pick(stepAt(e));
        }}
        onPointerMove={(e) => { if (down) pick(stepAt(e)); }}
        onPointerUp={() => setDown(false)}
        onPointerCancel={() => setDown(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); pick(Math.min(n - 1, sel + 1)); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); pick(Math.max(0, sel - 1)); }
        }}
      >
        <div className="eff-fill" style={{ background: fillColor(p) }} />
        {levels.map((_, i) => (
          <span key={i} className="eff-dot" data-on={i <= shown || undefined} style={tickStyle(i, n, dpr)} />
        ))}
        <div className="eff-thumb" />
      </div>
      <div className="mt-2.5 text-[12px] leading-4 text-[var(--moka-muted)]">
        <Calligraph variant="text" animation="smooth">{levels[shown].hint}</Calligraph>
      </div>
    </div>,
    anchor.closest('.tma') ?? document.body,
  );
}

// Five ascending bars, one per level: they fill up (in the level's coral) as effort grows.
export function EffortBars({ filled, total, size = 18 }) {
  const t = total > 0 ? filled / total : 0;
  const count = Math.round(t * 5);
  const color = fillColor(t);
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => {
        const h = 4.5 + i * 2.5;
        return <rect key={i} x={1.2 + i * 3.4} y={16 - h} width="2.4" height={h} rx="1.2" style={{ fill: i < count ? color : 'rgb(255 255 255 / 26%)', transition: 'fill 0.2s ease' }} />;
      })}
    </svg>
  );
}

export function EffortChip({ chat, chipClass }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const levels = levelsFor(chat);
  const cur = levels.find((l) => l.v === (chat.effort || '')) || levels[0];
  return (
    <>
      <Press
        ref={btn}
        className={cn(chipClass, 'text-[var(--moka-muted)] hover:text-white')}
        style={{ width: 32, paddingInline: 0, justifyContent: 'center' }}
        title={`Effort: ${cur.label} (Alt E)`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <EffortBars filled={levels.indexOf(cur)} total={levels.length - 1} />
      </Press>
      {open && btn.current && <Panel chat={chat} levels={levels} anchor={btn.current} onClose={() => setOpen(false)} />}
    </>
  );
}
