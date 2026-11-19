// Chat list in mokaGram's look: spaces as folder pills, chats as messenger rows
// (avatar, name, time, preview, unread dot), limits card and actions at the bottom.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Calligraph } from 'calligraph';
import ChevronDown from './icons/solar-alt-arrow-down-linear.svg?react';
import DropdownMenu from './tma/components/DropdownMenu';
import Tooltip from './tma/components/Tooltip';
import Spinner from './tma/components/Spinner';
import ModalView from './tma/components/ModalView';
import { MAX_PANES, bump, forkChat, newChat, openChat, openPalette, saveUi, send, state, useStore } from './store.js';
import { openResume } from './sessions.jsx';
import {
  Press, ClaudeIcon, IconButton, MODES, Tip, accountName, cn, duration, folderName, modeLabel, modeByLabel, resetsIn, timeAgo, useTick,
} from './ui.jsx';
import { Folder } from './folder.jsx';
import { HoverCard } from './hovercard.jsx';
import BranchIcon from './icons/solar-git-branch-linear.svg?react';
import CreateIcon from './icons/solar-pen-new-square-linear.svg?react';
import MenuIcon from './icons/solar-sidebar-minimalistic-linear.svg?react';
import CopyIcon from './icons/solar-columns-2-linear.svg?react';
import TrashIcon from './icons/solar-trash-bin-minimalistic-linear.svg?react';
import AddIcon from './icons/solar-add-circle-linear.svg?react';
import CloseIcon from './icons/solar-close-circle-linear.svg?react';
import SnoozeIcon from './icons/solar-alarm-sleep-linear.svg?react';
import ForkIcon from './icons/solar-branching-paths-down-linear.svg?react';
import SearchIcon from './icons/solar-magnifer-linear.svg?react';
import ClockIcon from './icons/solar-history-linear.svg?react';

const SECTION = 'mb-1 flex h-8 items-center gap-1 ps-3 pe-1.5 text-[12px] font-medium text-[var(--moka-muted)]';
const ROW = 'group relative w-full cursor-pointer rounded-[14px] text-left outline-none transition-colors';
const ROW_ON = 'bg-[var(--moka-hover)]';
const ROW_OFF = 'hover:bg-[var(--moka-card)]';

export const spaceName = (sp) => (sp.label === '~' ? 'home' : folderName(sp.path));

// Right side of a row: what the chat needs from you, else how long ago.
function Status({ chat }) {
  if (chat.status === 'approval' || chat.pending) {
    return <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#ff9f0a]"><span className="size-1.5 rounded-full bg-[#ff9f0a]" />{chat.activity === 'asking you' ? 'Answer' : 'Approve'}</span>;
  }
  if (chat.status === 'working') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--moka-accent)] tabular-nums">
        <Spinner size={12} />
        {chat.turnStartedAt ? <Calligraph variant="text" animation="smooth">{duration(Date.now() - chat.turnStartedAt)}</Calligraph> : null}
      </span>
    );
  }
  if (chat.status === 'error') return <span className="text-[12px] font-medium text-[#ff453a]">Failed</span>;
  if (chat.unread) return <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--moka-accent)]"><span className="size-1.5 rounded-full bg-[var(--moka-accent)]" />Done</span>;
  return <span className="text-[12px] text-[var(--moka-muted)] tabular-nums">{timeAgo(chat.updatedAt)}</span>;
}

// Snooze presets, after t3code: a few hours, tomorrow morning, next Monday.
const at9 = (days) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(9, 0, 0, 0); return d.getTime(); };
const SNOOZE = [
  ['1 hour', () => Date.now() + 3_600_000],
  ['3 hours', () => Date.now() + 3 * 3_600_000],
  ['Tomorrow 9:00', () => at9(1)],
  ['Next week', () => at9(((8 - new Date().getDay()) % 7) || 7)],
];

function until(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  if (ts - Date.now() < 6 * 86_400_000) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function SnoozeMenu({ chat }) {
  return (
    <DropdownMenu
      items={SNOOZE.map(([l]) => l)}
      value={null}
      onChange={(l) => send({ type: 'snooze', id: chat.id, until: SNOOZE.find(([x]) => x === l)[1]() })}
      trigger={(aria) => <IconButton {...aria} icon={SnoozeIcon} size={15} className="size-7 aria-expanded:bg-[var(--quaternary-fill-background)]" title="Snooze" />}
    />
  );
}

// Centered dialog from the kit's ModalView (a bottom sheet on narrow screens).
function ConfirmDelete({ chat, onCancel, onDelete }) {
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <ModalView isOpen onClose={onCancel}>
        <div className="flex flex-col items-center px-6 pt-7 pb-5 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-[#ff453a]/15 text-[#ff453a]">
            <TrashIcon className="ico" style={{ fontSize: 28 }} />
          </span>
          <span className="mt-4 block text-[18px] font-semibold text-white">Delete chat?</span>
          <span className="mt-1 block max-w-full truncate text-[14px] text-[var(--moka-muted)]">{chat.name || 'New chat'}</span>
          <span className="mt-2 block max-w-[260px] text-[13px] leading-[18px] text-[var(--moka-muted)]">
            The conversation goes away. Files on disk stay as they are.
          </span>
          <span className="mt-6 grid w-full grid-cols-2 gap-2.5">
            <Press className="h-11 cursor-pointer rounded-full bg-[var(--moka-hover)] text-[15px] font-medium text-white transition-colors hover:bg-[#3a3a3a]" onClick={onCancel}>
              Cancel
            </Press>
            <Press className="h-11 cursor-pointer rounded-full bg-[#ff453a]/15 text-[15px] font-semibold text-[#ff453a] transition-colors hover:bg-[#ff453a]/25" onClick={onDelete}>
              Delete
            </Press>
          </span>
        </div>
      </ModalView>
    </span>
  );
}

function AgentRow({ chat, active, index = 0 }) {
  useTick(1000, chat.status === 'working');
  const [armed, setArmed] = useState(false);
  const visible = state.panes.includes(chat.id);
  const canSplit = !visible && state.panes.length < MAX_PANES;
  const busy = chat.status === 'working' || chat.status === 'approval';
  const git = chat.git;
  // Hover card waits a beat so sweeping the list doesn't flash cards.
  const [card, setCard] = useState(null);
  const timer = useRef(null);
  const showCard = (e) => {
    const target = e.currentTarget;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCard(target.getBoundingClientRect()), 450);
  };
  const hideCard = () => { clearTimeout(timer.current); setCard(null); };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Press
      as="div"
      role="button"
      tabIndex={0}
      draggable
      className={cn(ROW, 'rise-cell px-3 py-2.5', active ? ROW_ON : ROW_OFF)}
      style={{ '--i': Math.min(index, 16) }}
      onDragStart={(e) => { hideCard(); e.dataTransfer.setData('text/swrm-chat', chat.id); e.dataTransfer.effectAllowed = 'move'; }}
      onMouseEnter={showCard}
      onMouseLeave={hideCard}
      onMouseDown={hideCard}
      onClick={(e) => openChat(chat.id, { split: (e.ctrlKey || e.metaKey) && canSplit })}
      onAuxClick={(e) => e.button === 1 && openChat(chat.id, { split: canSplit })}
      onKeyDown={(e) => e.key === 'Enter' && openChat(chat.id)}
      title={chat.cwd}
    >
      <div className="flex h-4 min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--moka-muted)]">{folderName(chat.cwd)}</span>
        <span className="flex shrink-0 items-center group-hover:opacity-0">
          {chat.snoozedUntil
            ? <span className="swap"><span className="inline-flex items-center gap-1 text-[12px] text-[var(--moka-muted)] tabular-nums"><SnoozeIcon className="ico" style={{ fontSize: 12 }} />{until(chat.snoozedUntil)}</span></span>
            : <span key={chat.status + (chat.unread ? 1 : 0)} className="swap"><Status chat={chat} /></span>}
        </span>
      </div>
      <div className={cn('mt-1 truncate text-[14px] font-medium', active || busy || chat.unread ? 'text-white' : 'text-white/85')}>
        {chat.name || 'New chat'}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[12px]">
        <span className={cn('flex min-w-0 flex-1 items-center gap-1', busy ? 'text-[var(--moka-accent)]' : 'text-[var(--moka-muted)]')}>
          {!busy && git?.branch && <BranchIcon className="ico" style={{ fontSize: 13 }} />}
          <span className="truncate">{busy ? chat.activity || 'working' : git?.branch || ''}</span>
        </span>
        {git && (git.add > 0 || git.del > 0) && (
          <span className="shrink-0 font-mono text-[12px] tabular-nums">
            <span className="text-[#30d158]">+<Calligraph variant="number" animation="smooth">{String(git.add)}</Calligraph></span>{' '}
            <span className="text-[#ff453a]">−<Calligraph variant="number" animation="smooth">{String(git.del)}</Calligraph></span>
          </span>
        )}
        <span className="inline-flex shrink-0 items-center gap-1 text-[var(--moka-muted)]">
          <ClaudeIcon className="size-3.5" />
          {state.accounts.length > 1 && accountName(chat.accountId)}
        </span>
      </div>
      <span className={cn('pointer-events-none absolute top-1.5 right-1.5 flex gap-0.5 opacity-0', !armed && 'group-hover:pointer-events-auto group-hover:opacity-100')} onClick={(e) => e.stopPropagation()}>
        {canSplit && <IconButton icon={CopyIcon} size={15} className="size-7" title="Open in split" onClick={() => openChat(chat.id, { split: true })} />}
        {chat.sessionId && !busy && <IconButton icon={ForkIcon} size={15} className="size-7" title="Fork chat" onClick={() => forkChat(chat.id, canSplit)} />}
        {chat.snoozedUntil
          ? <IconButton icon={SnoozeIcon} size={15} className="size-7 text-white" title="Wake now" onClick={() => send({ type: 'snooze', id: chat.id, until: 0 })} />
          : <SnoozeMenu chat={chat} />}
        <IconButton icon={TrashIcon} size={15} className="size-7 hover:text-[#ff453a]" title="Delete chat" onClick={() => setArmed(true)} />
      </span>
      {card && !armed && <HoverCard chat={chat} rect={card} status={<Status chat={chat} />} />}
      {armed && <ConfirmDelete chat={chat} onCancel={() => setArmed(false)} onDelete={() => send({ type: 'remove', id: chat.id })} />}
    </Press>
  );
}

function SpaceRow({ sp, chats, index = 0 }) {
  const [hover, setHover] = useState(false);
  const list = chats.filter((c) => c.cwd === sp.path);
  const on = state.spaceFilter === sp.path;
  const busy = list.some((c) => c.status === 'working');
  return (
    <Press
      as="div"
      role="button"
      tabIndex={0}
      title={sp.path}
      className={cn(ROW, 'rise-cell flex h-10 items-center gap-2.5 px-3', on ? ROW_ON : ROW_OFF)}
      style={{ '--i': index }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { state.spaceFilter = on ? '' : sp.path; saveUi(); bump(); }}
    >
      <Folder size={22} open={hover || on} />
      <span className={cn('min-w-0 flex-1 truncate text-[14px]', on ? 'font-medium text-white' : 'text-white/85')}>{spaceName(sp)}</span>
      {busy && <Spinner size={12} />}
      <span className="text-[12px] text-[var(--moka-muted)] tabular-nums group-hover:hidden">{list.length || ''}</span>
      {state.spaces.length > 1 && (
        <span className="hidden group-hover:flex" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={CloseIcon} size={14} className="-me-1.5 size-6" title="Remove from list" onClick={() => { if (on) { state.spaceFilter = ''; saveUi(); } send({ type: 'removeSpace', path: sp.path }); }} />
        </span>
      )}
    </Press>
  );
}

function Spaces({ chats }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef(null);
  useEffect(() => { if (adding) input.current?.focus(); }, [adding]);
  const submit = () => {
    if (value.trim()) send({ type: 'addSpace', path: value.trim() });
    setValue('');
    setAdding(false);
  };

  return (
    <div>
      <div className={SECTION}>
        <span className="flex-1">spaces</span>
        <IconButton icon={AddIcon} size={16} className="size-6" title="Add folder" onClick={() => setAdding((v) => !v)} />
      </div>
      {adding && (
        <input
          ref={input}
          className="mb-1 h-9 w-full rounded-full bg-[var(--moka-card)] px-4 text-[13px] text-white outline-none placeholder:text-[var(--moka-muted)]"
          placeholder="~/dev/project"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
        />
      )}
      <div className="flex flex-col gap-1">{state.spaces.map((sp, i) => <SpaceRow key={sp.path} sp={sp} index={i} chats={chats} />)}</div>
    </div>
  );
}

function Agents({ chats }) {
  const activeId = state.panes[state.focused];
  const [showSnoozed, setShowSnoozed] = useState(false);
  const scoped = state.spaceFilter ? chats.filter((c) => c.cwd === state.spaceFilter) : chats;
  const list = scoped.filter((c) => !c.snoozedUntil);
  const snoozed = scoped.filter((c) => c.snoozedUntil).sort((a, b) => a.snoozedUntil - b.snoozedUntil);
  const groups = state.grouped && !state.spaceFilter
    ? state.spaces.map((sp) => [spaceName(sp), list.filter((c) => c.cwd === sp.path)]).filter(([, l]) => l.length)
    : [['', list]];
  return (
    <div className="mt-5">
      <div className={SECTION}>
        <span className="flex-1">agents</span>
        {!state.spaceFilter && (
          <Press
                        className={cn('cursor-pointer rounded-full px-2 py-0.5 text-[12px] transition-colors hover:text-white', state.grouped ? 'bg-[var(--moka-card)] text-white' : 'text-[var(--moka-muted)]')}
            onClick={() => { state.grouped = !state.grouped; saveUi(); bump(); }}
          >
            grouped
          </Press>
        )}
        <IconButton icon={AddIcon} size={16} className="size-6" title="New chat" onClick={quickNew} />
      </div>
      {!list.length && !snoozed.length && <p className="px-3 py-2 text-[13px] text-[var(--moka-muted)]">No chats yet.</p>}
      {groups.map(([label, l]) => (
        <div key={label || 'all'} className="flex flex-col gap-1">
          {label && <div className="px-3 pt-2 pb-1 text-[12px] text-[var(--moka-muted)]">{label}</div>}
          {l.map((c, i) => <AgentRow key={c.id} chat={c} index={i} active={c.id === activeId} />)}
        </div>
      ))}
      {snoozed.length > 0 && (
        <>
          <Press className="mt-2 flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] text-[var(--moka-muted)] transition-colors hover:text-white" onClick={() => setShowSnoozed((v) => !v)}>
            <SnoozeIcon className="ico" style={{ fontSize: 13 }} />
            <span className="flex-1 text-left">snoozed</span>
            <span className="tabular-nums">{snoozed.length}</span>
            <ChevronDown className={cn('ico spin-chevron', showSnoozed && 'rotate-180')} style={{ fontSize: 12 }} />
          </Press>
          <div className="fold" data-open={showSnoozed || undefined}>
            <div className="flex flex-col gap-1">
              {showSnoozed && snoozed.map((c, i) => <AgentRow key={c.id} chat={c} index={i} active={c.id === activeId} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Bar({ left }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--moka-hover)]">
      <div className="h-full rounded-full" style={{ width: `${left}%`, background: left < 15 ? '#ff453a' : '#d97757' }} />
    </div>
  );
}

const leftOf = (l) => Math.max(0, Math.round(100 - l.pct));

// Limits card folds into one line: header with the tightest limit, tap to open.
function Limits() {
  useTick(30_000);
  const open = state.limitsOpen;
  if (!state.accounts.length) return null;
  const many = state.accounts.filter((a) => a.loggedIn).length > 1;
  const main = state.accounts.find((a) => a.id === state.settings.defaultAccount && a.loggedIn) || state.accounts.find((a) => a.loggedIn);
  const tight = main?.limits.length ? main.limits.reduce((x, y) => (leftOf(y) < leftOf(x) ? y : x)) : null;
  const toggle = () => {
    state.limitsOpen = !open;
    saveUi();
    bump();
  };

  return (
    <div className="rounded-[22px] bg-[var(--moka-card)]">
      <div className="fold fold-up" data-open={open || undefined}>
        <div><div className="flex flex-col gap-3 px-3.5 pb-1 pt-3.5">
          {state.accounts.map((a) => {
            const def = state.settings.defaultAccount === a.id;
            return (
              <div
                key={a.id}
                className={cn('flex min-w-0 flex-col gap-2', many && a.loggedIn && 'cursor-pointer')}
                onClick={() => many && a.loggedIn && send({ type: 'settings', settings: { defaultAccount: a.id } })}
              >
                <div className="flex items-center gap-2">
                  <Tip text={many ? 'Use for new chats' : a.email || a.label} className="min-w-0" triggerClassName="min-w-0 max-w-full justify-start"><span className="min-w-0 truncate text-[13px] font-semibold text-white">{a.name}</span></Tip>
                  {a.plan && <span className="text-[12px] text-[var(--moka-muted)]">{a.plan}</span>}
                  {many && def && <span className="ms-auto size-2 rounded-full bg-[var(--moka-accent)]" />}
                </div>
                {!a.loggedIn ? <span className="text-[13px] text-[var(--moka-muted)]">Not logged in</span>
                  : !a.limits.length ? <span className="text-[13px] text-[var(--moka-muted)]">{a.limitsError || 'Loading limits'}</span>
                    : a.limits.map((l) => {
                      const left = leftOf(l);
                      return (
                        <div key={l.key} className="flex flex-col gap-1">
                          <div className="flex items-baseline gap-2 text-[13px]">
                            <span className="text-[var(--moka-muted)]">{l.label}</span>
                            <span className="ms-auto text-[var(--moka-muted)] tabular-nums">{resetsIn(l.resetsAt)}</span>
                            <span className="w-11 text-right font-semibold text-white tabular-nums">
                              <Calligraph variant="number" animation="smooth">{`${left}%`}</Calligraph>
                            </span>
                          </div>
                          <Bar left={left} />
                        </div>
                      );
                    })}
              </div>
            );
          })}
          <Press className="-mt-1 flex w-fit cursor-pointer items-center gap-1.5 self-start rounded-full py-1 pe-2 text-[13px] text-[var(--moka-muted)] hover:text-white" onClick={() => send({ type: 'refreshLimits' })}>
            Refresh limits
          </Press>
        </div>
      </div></div>
      <Press className="flex w-full cursor-pointer items-center gap-2 rounded-[22px] px-3.5 py-3 text-left" onClick={toggle} aria-expanded={open}>
        <ClaudeIcon className="size-4" />
        <span className="text-[14px] font-semibold text-white">Limits</span>
        <span className={cn('ms-auto flex items-center gap-1.5 text-[13px] tabular-nums transition-opacity duration-300', open ? 'opacity-0' : 'opacity-100')}>
          {tight && (
            <>
              <span className="text-[var(--moka-muted)]">{tight.label}</span>
              <span className="font-semibold text-white"><Calligraph variant="number" animation="smooth">{`${leftOf(tight)}%`}</Calligraph></span>
            </>
          )}
        </span>
        <span className={cn('spin-chevron flex text-[var(--moka-muted)]', !open && 'rotate-180')}><ChevronDown className="ico" style={{ fontSize: 14 }} /></span>
      </Press>
    </div>
  );
}

function quickNew() {
  const loggedIn = state.accounts.filter((a) => a.loggedIn);
  const acc = state.settings.defaultAccount || loggedIn[0]?.id;
  const focusedChat = state.chats[state.panes[state.focused]];
  const cwd = state.spaceFilter || focusedChat?.cwd || state.spaces[0]?.path || '';
  if (acc) newChat({ accountId: acc, cwd, split: false });
}


export function Sidebar() {
  useStore();
  const hide = () => { state.sidebar = false; saveUi(); bump(); };
  useTick(60_000);
  const chats = Object.values(state.chats).sort((a, b) => b.updatedAt - a.updatedAt);
  const canNew = state.accounts.some((a) => a.loggedIn);

  return (
    <aside data-chrome className="rise-down flex min-h-0 flex-col bg-[var(--moka-bg)]">
      <div className="flex h-13 shrink-0 items-center gap-1.5 ps-5 pe-2.5">
        <span className="flex-1 text-[14px] font-semibold text-white">swrm</span>
        {!state.connected && <span className="text-[12px] text-[#ff9f0a]">Reconnecting</span>}
        <Tooltip content="Search messages" badge="Ctrl K" placement="bottom">
          <IconButton icon={SearchIcon} size={18} title={null} aria-label="Search messages" onClick={() => openPalette('messages')} />
        </Tooltip>
        <IconButton icon={MenuIcon} size={19} title="Hide sidebar (Alt B)" onClick={hide} />
      </div>
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Spaces chats={chats} />
        <Agents chats={chats} />
      </div>
      <div className="flex shrink-0 flex-col gap-2 p-3 pt-1">
        <Limits />
        <div className="flex items-center gap-2">
          <Press
                        disabled={!canNew}
            onClick={quickNew}
                        className="flex h-11 flex-1 cursor-pointer items-center gap-2 rounded-full bg-[var(--moka-card)] px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--moka-hover)] disabled:opacity-40"
          >
            <CreateIcon className="ico" style={{ fontSize: 18 }} />
            New chat
            <span className="ms-auto text-[12px] font-medium text-[var(--moka-muted)]">Alt N</span>
          </Press>
          <Tooltip content="Resume session" placement="top">
            <Press
              aria-label="Resume session"
              onClick={() => openResume(true)}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--moka-card)] text-white transition-colors hover:bg-[var(--moka-hover)]"
            >
              <ClockIcon className="ico" style={{ fontSize: 18 }} />
            </Press>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
