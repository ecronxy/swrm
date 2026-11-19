// Shared bits: t3code button variants (still used in the timeline), the ClaudeAI
// icon, ion icons, a folder avatar from the kit, and small formatters.
import { useEffect, useState } from 'react';
import InitialsAvatar from './tma/components/InitialsAvatar';
import Tooltip from './tma/components/Tooltip';
import { state } from './store.js';
import { CLAUDE_PATH, buttonVariants, cn } from './t3/variants.js';

export { cn };

export function Button({ variant, size, className, ...props }) {
  return <button type="button" data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function ClaudeIcon({ className = 'size-4' }) {
  return (
    <svg preserveAspectRatio="xMidYMid" viewBox="0 0 256 257" className={cn('shrink-0 fill-[#d97757]', className)} aria-hidden="true">
      <path d={CLAUDE_PATH} />
    </svg>
  );
}

// Buttons press like sdkhub's (.press in motion.css); rows only tint on hover like its cards.
// Every hint in the app is the kit's Tooltip (black bubble with a tail), never the browser's native title.
// A trailing "(Alt B)" becomes the kit's key badge. Only real buttons get one: rows keep their layout and carry no title.
export function Tip({ text, placement = 'auto', className, triggerClassName, children }) {
  if (!text) return children;
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(String(text));
  return <Tooltip content={m ? m[1] : text} badge={m ? m[2] : undefined} placement={placement} className={className} triggerClassName={triggerClassName} closeOnClick>{children}</Tooltip>;
}

// Classes that place the button itself (corner badges, fixed overlays) must sit on the tooltip's wrapper, or the button loses its anchor.
const PLACE = /^(-?(absolute|fixed|relative|sticky|inset(-[xy])?|top|bottom|left|right|start|end)(-.*)?|z-.*)$/;

export function Press({ as: C = 'button', className, title, ...props }) {
  const tip = C === 'button' && typeof title === 'string';
  const tokens = String(className || '').split(/\s+/).filter(Boolean);
  const place = tip ? tokens.filter((t) => PLACE.test(t.replace(/^[a-z-]+:/, '') ) && !t.includes(':')) : [];
  const own = tip ? tokens.filter((t) => !place.includes(t)) : tokens;
  const el = <C {...(C === 'button' ? { type: 'button' } : {})} className={cn(C === 'button' ? 'press' : 'card-hover', own.join(' '))} {...props} />;
  return tip ? <Tip text={title} className={place.join(' ')}>{el}</Tip> : el;
}

// Round icon button for the chrome: white outline ion icon, quiet until hover.
export function IconButton({ icon: Icon, title, onClick, className, size = 18, ...props }) {
  return (
    <Press
      title={title}
      aria-label={title || props['aria-label']}
      onClick={onClick}
      className={cn('press-icon inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--tg-theme-subtitle-text-color)] transition-colors hover:bg-[var(--quaternary-fill-background)] hover:text-white', className)}
      {...props}
    >
      <Icon className="ico" style={{ fontSize: size }} />
    </Press>
  );
}

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function folderName(cwd) {
  return String(cwd || '').split('/').filter(Boolean).pop() || '/';
}

// Kit InitialsAvatar keyed by the folder, so a project keeps its colour everywhere.
export function FolderAvatar({ cwd, size = 36 }) {
  const name = folderName(cwd).replace(/^[._]+/, '').replace(/[-_.]+/g, ' ') || '/';
  return <InitialsAvatar userId={hash(folderName(cwd))} name={name} size={size} />;
}

export function accountName(id) {
  return state.accounts.find((a) => a.id === id)?.name || id || 'account';
}

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function resetsIn(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0)) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function spaceLabel(cwd) {
  return state.spaces.find((s) => s.path === cwd)?.label || folderName(cwd);
}

export function useTick(ms, on = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

export const MODES = [
  { value: 'default', label: 'Ask first', hint: 'Asks before edits and commands' },
  { value: 'acceptEdits', label: 'Auto edits', hint: 'Edits go through, commands ask' },
  { value: 'plan', label: 'Plan only', hint: 'Reads and plans, changes nothing' },
  { value: 'bypassPermissions', label: 'Full access', hint: 'Never asks' },
];

export const modeLabel = (v) => MODES.find((m) => m.value === v)?.label || v;
export const modeByLabel = (l) => MODES.find((m) => m.label === l)?.value;

