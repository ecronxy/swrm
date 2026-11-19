// One split pane in mokaGram's look: messenger header (avatar, name, status line),
// the timeline on the #151515 chat background, and a pill composer card.
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Calligraph } from 'calligraph';
import DropdownMenu from './tma/components/DropdownMenu';
import Spinner from './tma/components/Spinner';
import { bump, closePane, focusPane, openRewind, placeChat, request, runScript, send, state, toggleDiff, toggleTerm } from './store.js';
import {
  AttachButton, AttachInput, AttachStrip, QueueStrip, addFiles, canSendAttachments, hasAttachments, takeAttachments,
} from './attach.jsx';
// xterm is ~340 KB of source and only needed once a terminal is opened.
const TerminalDrawer = lazy(() => import('./terminal.jsx').then((m) => ({ default: m.TerminalDrawer })));
import { EffortChip } from './effort.jsx';
import { SendButton } from './send.jsx';
import { SlashMenu, slashMatches } from './slash.jsx';
import { McpChip } from './mcp.jsx';
import { Thread } from './messages.jsx';
import { TaskStrip } from './tasks.jsx';
import { ContextChip } from './context.jsx';
import { useJump } from './sessions.jsx';
import { Folder } from './folder.jsx';
import ModalView from './tma/components/ModalView';
import HamburgerIcon from './icons/solar-hamburger-menu-linear.svg?react';
import {
  Press, ClaudeIcon, IconButton, MODES, Tip, accountName, cn, duration, folderName, modeByLabel, modeLabel, useTick,
} from './ui.jsx';
import ChevronDown from './icons/solar-alt-arrow-down-linear.svg?react';
import ArrowUp from './icons/solar-arrow-up-bold.svg?react';
import StopIcon from './icons/solar-stop-bold.svg?react';
import BranchIcon from './icons/solar-git-branch-linear.svg?react';
import CloseIcon from './icons/solar-close-circle-linear.svg?react';
import FolderIcon from './icons/solar-folder-linear.svg?react';
import TermIcon from './icons/solar-programming-linear.svg?react';
import ShieldIcon from './icons/solar-shield-check-linear.svg?react';
import DownIcon from './icons/solar-alt-arrow-down-linear.svg?react';
import MagicIcon from './icons/solar-magic-stick-3-linear.svg?react';
import PlanIcon from './icons/solar-checklist-minimalistic-linear.svg?react';
import BoltIcon from './icons/solar-bolt-linear.svg?react';
import PlayIcon from './icons/solar-play-linear.svg?react';
import ExpandIcon from './icons/solar-maximize-square-minimalistic-linear.svg?react';
import ContractIcon from './icons/solar-minimize-square-minimalistic-linear.svg?react';

const drafts = new Map();
// Box metrics shared by the textarea and its color mirror: they must match to the pixel.
const INPUT = 'px-4 pt-3.5 pb-1 text-[15px] leading-[1.45]';
const CHIP = 'inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-3 @max-[30rem]/pane:px-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--moka-hover)] aria-expanded:bg-[var(--moka-hover)]';
const PILL = 'inline-flex h-9 cursor-pointer items-center justify-center rounded-full px-4 text-[14px] font-semibold transition-colors disabled:opacity-40';

const MODE_ICONS = { 'Ask first': ShieldIcon, 'Auto edits': MagicIcon, 'Plan only': PlanIcon, 'Full access': BoltIcon };

function ModeChip({ chat }) {
  return (
    <DropdownMenu
      items={MODES.map((m) => m.label)}
      icons={MODE_ICONS}
      value={modeLabel(chat.mode)}
      onChange={(label) => {
        send({ type: 'setMode', id: chat.id, mode: modeByLabel(label) });
        send({ type: 'settings', settings: { defaultMode: modeByLabel(label) } }); // next new chat starts the same way
      }}
      trigger={(aria) => (
        <Press {...aria} className={cn(CHIP, chat.mode === 'bypassPermissions' ? 'bg-[#ff453a]/15 text-[#ff453a] hover:bg-[#ff453a]/25' : 'text-[var(--moka-muted)] hover:text-white')} title={chat.mode === 'bypassPermissions' ? 'Full access: nothing asks first' : 'Permissions'}>
          {(() => { const ModeIcon = MODE_ICONS[modeLabel(chat.mode)]; return ModeIcon && <ModeIcon className="ico shrink-0" style={{ fontSize: 15 }} />; })()}
          <span className="truncate @max-[30rem]/pane:hidden">{modeLabel(chat.mode)}</span>
          <ChevronDown className="ico opacity-70 @max-[30rem]/pane:hidden" style={{ fontSize: 12 }} />
        </Press>
      )}
    />
  );
}

// Local or a worktree of its own, picked before the first message (t3code's env mode).
function WorkdirChip({ chat }) {
  const LABELS = ['Local', 'Worktree'];
  const cur = chat.useWorktree ? 'Worktree' : 'Local';
  const Icon = chat.useWorktree ? BranchIcon : FolderIcon;
  return (
    <DropdownMenu
      items={LABELS}
      value={cur}
      onChange={(l) => send({ type: 'setWorktree', id: chat.id, on: l === 'Worktree' })}
      trigger={(aria) => (
        <Press {...aria} className={cn(CHIP, 'text-[var(--moka-muted)] hover:text-white')} title={chat.useWorktree ? 'New branch in its own folder' : 'Work right in the project folder'}>
          <Icon className="ico" style={{ fontSize: 14 }} />
          <span className="truncate @max-[30rem]/pane:hidden">{cur}</span>
          <ChevronDown className="ico opacity-70 @max-[30rem]/pane:hidden" style={{ fontSize: 12 }} />
        </Press>
      )}
    />
  );
}

function ModelChip({ chat }) {
  const models = (state.models[chat.accountId] || []).filter((m) => m.value && m.value !== 'default');
  const DEFAULT = 'Default model';
  const label = (v) => models.find((m) => m.value === v)?.label || v;
  const current = chat.model ? label(chat.model) : DEFAULT;
  return (
    <DropdownMenu
      items={[DEFAULT, ...models.map((m) => m.label)]}
      value={current}
      onChange={(l) => send({ type: 'setModel', id: chat.id, model: l === DEFAULT ? '' : models.find((m) => m.label === l)?.value || '' })}
      trigger={(aria) => (
        <Press {...aria} className={cn(CHIP, 'max-w-56')} title={`Model: ${current}`}>
          <ClaudeIcon className="size-4 shrink-0" />
          <span className="truncate @max-[30rem]/pane:hidden">{current}</span>
        </Press>
      )}
    />
  );
}

// Live approval sits on top of the composer card, like a pinned bar.
function PendingApproval({ chat, perm }) {
  const [picked, setPicked] = useState({});
  const answer = (decision, answers) => send({ type: 'answer', id: chat.id, permId: perm.id, decision, answers });
  const ghost = cn(PILL, 'bg-[var(--moka-hover)] text-white hover:bg-[#3c3c3c]');
  const main = cn(PILL, 'bg-[var(--moka-accent)] text-white hover:bg-[#2b95ff]');

  if (perm.questions) {
    const ready = perm.questions.every((q) => picked[q.question]?.length);
    return (
      <div className="flex flex-col gap-3 px-4 pt-3.5 pb-1">
        {perm.questions.map((q) => (
          <div key={q.question} className="flex flex-col gap-2">
            <span className="text-[15px] font-semibold text-white">{q.question}</span>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => {
                const on = (picked[q.question] || []).includes(o.label);
                return (
                  <Press
                    key={o.label}
                    type="button"
                    title={o.description}
                    className={cn(PILL, 'h-8 px-3.5 text-[13px]', on ? 'bg-white text-black' : 'bg-[var(--moka-hover)] text-white hover:bg-[#3c3c3c]')}
                    onClick={() => {
                      const cur = picked[q.question] || [];
                      const next = q.multiSelect ? (on ? cur.filter((x) => x !== o.label) : [...cur, o.label]) : [o.label];
                      setPicked({ ...picked, [q.question]: next });
                    }}
                  >
                    {o.label}
                  </Press>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Press className={ghost} onClick={() => answer('deny')}>Skip</Press>
          <Press className={main} disabled={!ready} onClick={() => answer('once', Object.fromEntries(perm.questions.map((q) => [q.question, (picked[q.question] || []).join(', ')])))}>
            Send
          </Press>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 px-4 pt-3.5 pb-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-[#ff9f0a]" />
        <span className="text-[15px] font-semibold text-white">{perm.tool === 'Bash' ? 'Run this command?' : `Allow ${perm.tool}?`}</span>
      </div>
      {perm.detail && (
        <code className="block max-h-32 overflow-auto rounded-[14px] bg-[var(--moka-chat)] px-3 py-2 font-mono text-[12px] leading-5 whitespace-pre-wrap text-white/85 select-text [overflow-wrap:anywhere]">
          {perm.detail}
        </code>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Press className={ghost} onClick={() => answer('deny')}>Decline</Press>
        <Press className={ghost} onClick={() => answer('session')}>Always this chat</Press>
        <Press className={ghost} title="Saved to this folder's .claude/settings.local.json" onClick={() => answer('always')}>Always allow</Press>
        <Press className={main} onClick={() => answer('once')}>Allow</Press>
      </div>
    </div>
  );
}

function Composer({ chat, items, autoFocus }) {
  const [text, setText] = useState(drafts.get(chat.id) || '');
  const ta = useRef(null);
  const escAt = useRef(0);
  const running = chat.status === 'working' || chat.status === 'approval';
  const perm = [...items].reverse().find((it) => it.t === 'perm' && it.state === 'pending');

  useEffect(() => { setText(drafts.get(chat.id) || ''); }, [chat.id]);
  // Focus only when a chat lands in the focused pane, never on a click (it would eat text selection).
  useEffect(() => { if (autoFocus) ta.current?.focus(); }, [chat.id]);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  const card = useRef(null);
  const mirror = useRef(null);
  // the leading /command, colored only when Claude Code really knows it
  const cmdWord = /^\/(\S+)/.exec(text);
  const cmd = cmdWord && (state.commands[chat.accountId] || []).some((c) => c.name === cmdWord[1]) ? cmdWord[0] : '';
  const [slashSel, setSlashSel] = useState(0);
  const [slashOff, setSlashOff] = useState('');
  const slash = slashOff === text ? [] : slashMatches(chat, text);
  useEffect(() => setSlashSel(0), [text.startsWith('/') ? text : '']);
  // "@" in the text opens a menu of the project's files; picking one writes @path, which Claude reads as a file mention.
  const [mention, setMention] = useState(null);
  const [fileList, setFileList] = useState([]);
  const [fileSel, setFileSel] = useState(0);
  const [mentionOff, setMentionOff] = useState('');
  const scanMention = (el) => {
    const caret = el.selectionStart;
    const m = /(^|\s)@([^\s@]*)$/.exec(el.value.slice(0, caret));
    setMention(m ? { from: caret - m[2].length - 1, to: caret, q: m[2] } : null);
  };
  useEffect(() => {
    if (!mention) { setFileList([]); return undefined; }
    let dead = false;
    const t = setTimeout(() => request({ type: 'files', id: chat.id, q: mention.q }).then((l) => { if (!dead) { setFileList(l || []); setFileSel(0); } }), 90);
    return () => { dead = true; clearTimeout(t); };
  }, [mention?.q, mention?.from, chat.id]);
  const mentionKey = mention ? `${mention.from}:${mention.q}` : '';
  const mentionList = mention && mentionOff !== mentionKey ? fileList.map((p) => ({ path: p, name: p.slice(p.lastIndexOf('/') + 1), description: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '' })) : [];
  const mentionPick = (c) => {
    const next = `${text.slice(0, mention.from)}@${c.path} ${text.slice(mention.to)}`;
    const caret = mention.from + c.path.length + 2;
    setText(next);
    drafts.set(chat.id, next);
    setMention(null);
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(caret, caret); });
  };
  const slashPick = (c, send_) => {
    const full = `/${c.name}`;
    if (send_ && !c.argumentHint) { send({ type: 'send', id: chat.id, text: full }); drafts.delete(chat.id); setText(''); return; }
    setText(`${full} `); drafts.set(chat.id, `${full} `);
    ta.current?.focus();
  };

  // A send while the agent is busy is queued by the server (QueueStrip shows it); the pictures are
  // uploaded before they can go, so Enter waits for the last thumbnail.
  const ready = canSendAttachments(chat.id);
  const hasText = !!text.trim() || hasAttachments(chat.id);
  const submit = () => {
    if (!hasText || !ready || !state.connected) return;
    send({ type: 'send', id: chat.id, text, attachments: takeAttachments(chat.id) });
    drafts.delete(chat.id);
    setText('');
  };
  const canSend = hasText && ready && state.connected;
  const showWorkdir = !!(chat.git && !chat.sessionId && !chat.worktree && !items.length);
  const stop = running && !text.trim();

  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="mx-auto w-full max-w-(--chat-content-max-width)">
        <div ref={card} data-chrome className="rounded-[22px] bg-[var(--moka-card)] shadow-[0_8px_30px_-12px_rgb(0_0_0/60%)]">
          <SlashMenu list={slash} sel={slashSel} setSel={setSlashSel} pick={slashPick} anchor={card.current} />
          <SlashMenu list={mentionList} sel={fileSel} setSel={setFileSel} pick={mentionPick} anchor={card.current} prefix="@" />
          {perm && <div key={perm.id} className="banner"><div><PendingApproval chat={chat} perm={perm} /></div></div>}
          <QueueStrip chat={chat} />
          <AttachStrip chatId={chat.id} />
          <div className="relative">
            {/* mirror under the transparent textarea: same text, but a known /command gets its own color */}
            <div ref={mirror} aria-hidden className={cn(INPUT, 'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-white')}>
              {cmd ? <><span className="text-[#e8896a]">{cmd}</span>{text.slice(cmd.length)}</> : text}{'\u200b'}
            </div>
          <textarea
            ref={ta}
            onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
            rows={1}
            value={text}
            placeholder={running ? 'Queue a message' : 'Message'}
            onPaste={(e) => {
              // a picture copied from anywhere lands as a thumbnail; plain text pastes as always
              const files = [...e.clipboardData.files];
              if (!files.length) return;
              e.preventDefault();
              addFiles(chat.id, files);
            }}
            className={cn(INPUT, 'relative block max-h-[40vh] min-h-12 w-full resize-none bg-transparent text-transparent caret-white outline-none placeholder:text-[var(--moka-muted)]')}
            onChange={(e) => { setText(e.currentTarget.value); drafts.set(chat.id, e.currentTarget.value); scanMention(e.currentTarget); }}
            onClick={(e) => scanMention(e.currentTarget)}
            onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) scanMention(e.currentTarget); }}
            onKeyDown={(e) => {
              if (mentionList.length && !e.nativeEvent.isComposing) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setFileSel((i) => (i + 1) % mentionList.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setFileSel((i) => (i - 1 + mentionList.length) % mentionList.length); return; }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); mentionPick(mentionList[fileSel]); return; }
                if (e.key === 'Escape') { e.preventDefault(); setMentionOff(mentionKey); return; }
              }
              if (slash.length && !e.nativeEvent.isComposing) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSel((i) => (i + 1) % slash.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSel((i) => (i - 1 + slash.length) % slash.length); return; }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); slashPick(slash[slashSel], e.key === 'Enter'); return; }
                if (e.key === 'Escape') { e.preventDefault(); setSlashOff(text); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              if (e.key === 'Escape' && !e.nativeEvent.isComposing && !text) {
                // empty composer: Esc stops a running turn; twice quickly on an idle one asks for the rewind picker
                if (running) send({ type: 'interrupt', id: chat.id });
                else if (Date.now() - escAt.current < 500) { escAt.current = 0; openRewind(chat.id); }
                else escAt.current = Date.now();
              }
            }}
          />
          </div>
          <div className="flex items-center gap-1 px-2 pb-2">
            <AttachButton chatId={chat.id} />
            <AttachInput chatId={chat.id} />
            <span className="flex min-w-0 items-center gap-1 @max-[21rem]/pane:hidden">
              <ModeChip chat={chat} />
              {showWorkdir && <WorkdirChip chat={chat} />}
            </span>
            <span className="flex-1" />
            <span className="flex min-w-0 items-center gap-1 @max-[21rem]/pane:hidden">
              <EffortChip chat={chat} chipClass={CHIP} />
              <ModelChip chat={chat} />
            </span>
            <ComposerMenu chat={chat} showWorkdir={showWorkdir} />
            <SendButton running={running} canSend={canSend} onSend={submit} onStop={() => send({ type: 'interrupt', id: chat.id })} />
          </div>
        </div>
      </div>
    </div>
  );
}

// In a very narrow pane the four settings chips move behind one burger button.
function ComposerMenu({ chat, showWorkdir }) {
  const [open, setOpen] = useState(false);
  const Row = ({ label, children }) => (
    <div className="flex items-center justify-between gap-3 px-1 py-0.5">
      <span className="text-[14px] text-[var(--moka-muted)]">{label}</span>
      {children}
    </div>
  );
  return (
    <span className="hidden @max-[21rem]/pane:inline-flex" onClick={(e) => e.stopPropagation()}>
      <IconButton icon={HamburgerIcon} size={19} title="Chat settings" onClick={() => setOpen(true)} />
      {open && (
        <ModalView isOpen onClose={() => setOpen(false)}>
          <div className="flex w-full flex-col gap-1 p-4">
            <Row label="Access"><ModeChip chat={chat} /></Row>
            {showWorkdir && <Row label="Folder"><WorkdirChip chat={chat} /></Row>}
            <Row label="Effort"><EffortChip chat={chat} chipClass={CHIP} /></Row>
            <Row label="Model"><ModelChip chat={chat} /></Row>
          </div>
        </ModalView>
      )}
    </span>
  );
}

function Title({ chat }) {
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState('');
  if (edit) {
    return (
      <input
        className="w-full min-w-0 rounded-md bg-transparent text-[14px] font-medium text-white outline-none"
        value={value}
        ref={(el) => el?.focus()}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => { send({ type: 'rename', id: chat.id, name: value }); setEdit(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEdit(false); }}
      />
    );
  }
  return (
    <Tip text="Double-click to rename" className="min-w-0" triggerClassName="min-w-0 max-w-full justify-start">
      <span className="block min-w-0 truncate text-[14px] font-medium text-white" onDoubleClick={() => { setValue(chat.name || ''); setEdit(true); }}>
        {chat.name || 'New chat'}
      </span>
    </Tip>
  );
}

// Project scripts from package.json, after t3code's script buttons: the main one
// runs in a click, the rest sit in the menu. Both type into the chat's terminal.
function Scripts({ chat }) {
  const list = state.scripts[chat.id]?.scripts || [];
  if (!list.length) return null;
  const main = list[0];
  const runner = state.scripts[chat.id]?.runner || 'npm';
  return (
    <span className="hidden h-7 items-center rounded-full bg-[var(--moka-card)] @min-[28rem]/pane:inline-flex">
      <Press className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full ps-2.5 pe-2 text-[12px] font-medium text-white hover:bg-[var(--moka-hover)]" title={`${runner} run ${main.name}: ${main.command}`} onClick={() => runScript(chat.id, main)}>
        <PlayIcon className="ico" style={{ fontSize: 12 }} />
        <span className="max-w-24 truncate">{main.name}</span>
      </Press>
      {list.length > 1 && (
        <DropdownMenu
          items={list.map((x) => x.name)}
          onChange={(name) => runScript(chat.id, list.find((x) => x.name === name))}
          trigger={(aria) => (
            <Press {...aria} className="inline-flex h-7 cursor-pointer items-center rounded-full ps-1 pe-2 text-[var(--moka-muted)] hover:bg-[var(--moka-hover)] hover:text-white aria-expanded:bg-[var(--moka-hover)]" title="More scripts">
              <ChevronDown className="ico" style={{ fontSize: 12 }} />
            </Press>
          )}
        />
      )}
    </span>
  );
}

// Shown only while the chat is busy, the rest of the time the header stays quiet.
function LiveStatus({ chat }) {
  useTick(1000, chat.status === 'working');
  if (chat.status === 'working') {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-[12px] font-medium text-[var(--moka-accent)] tabular-nums">
        <Spinner size={12} />
        {chat.turnStartedAt ? <Calligraph variant="text" animation="smooth">{duration(Date.now() - chat.turnStartedAt)}</Calligraph> : null}
      </span>
    );
  }
  if (chat.status === 'approval') return <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-[12px] font-medium text-[#ff9f0a]"><span className="size-1.5 rounded-full bg-[#ff9f0a]" />{chat.activity === 'asking you' ? 'Answer' : 'Approve'}</span>;
  return null;
}

export function Pane({ chatId, index, span, multi }) {
  const chat = state.chats[chatId];
  const items = state.items[chatId] || [];
  const scroller = useRef(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const [drop, setDrop] = useState(false);
  const [away, setAway] = useState(false); // scrolled far from the end: show the jump-down button
  const focused = state.focused === index;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    if (el) {
      const far = el.scrollHeight - el.scrollTop - el.clientHeight > 160;
      if (far !== away) setAway(far);
    }
  });
  useEffect(() => { stick.current = true; }, [chatId]);
  useJump(chatId, scroller, stick, items); // search hit: scroll to the message
  useEffect(() => { if (chat) send({ type: 'scripts', id: chatId }); }, [chatId, !!chat, chat?.worktree?.path]);
  if (!chat) return null;

  return (
    <section
      className={cn('reveal @container/pane relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] bg-[var(--moka-chat)]', drop && 'ring-2 ring-inset ring-[var(--moka-accent)]/70')}
      onMouseDown={() => focusPane(index)}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/swrm-chat') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrop(true); } }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        setDrop(false);
        const id = e.dataTransfer.getData('text/swrm-chat');
        if (id) placeChat(id, index);
        else if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(chat.id, e.dataTransfer.files); }
      }}
    >
      <header data-chrome className={cn('flex h-13 shrink-0 items-center gap-2 ps-4 pe-2.5 transition-opacity', multi && !focused && 'opacity-55')}>
        <nav className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-medium">
          <span className="max-w-40 shrink truncate text-[var(--moka-muted)] @max-[30rem]/pane:hidden">{folderName(chat.cwd)}</span>
          <span aria-hidden className="text-[var(--moka-muted)]/60 @max-[30rem]/pane:hidden">/</span>
          <span className="flex min-w-0 flex-1"><Title chat={chat} /></span>
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          <LiveStatus chat={chat} />
          <ContextChip chat={chat} />
          <Scripts chat={chat} />
          <McpChip chat={chat} />
          {chat.git?.branch && (
            <Press
              className={cn('hidden h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] text-[var(--moka-muted)] hover:bg-[var(--moka-hover)] hover:text-white @min-[24rem]/pane:inline-flex', state.diffOpen && focused ? 'bg-[var(--moka-hover)] text-white' : 'bg-[var(--moka-card)]')}
              title={state.diffOpen && focused ? 'Hide changes' : 'Show changes'}
              onClick={() => { focusPane(index); toggleDiff(!(state.diffOpen && focused)); }}
            >
              <BranchIcon className="ico" style={{ fontSize: 13 }} />
              <span className="hidden max-w-28 truncate @min-[34rem]/pane:inline">{chat.git.branch}</span>
              {(chat.git.add > 0 || chat.git.del > 0) && (
                <span className="tabular-nums">
                  <span className="text-diff-addition-foreground">+{chat.git.add}</span>{' '}
                  <span className="text-diff-deletion-foreground">−{chat.git.del}</span>
                </span>
              )}
            </Press>
          )}
          {state.accounts.length > 1 && (
            <span className="hidden h-7 items-center gap-1.5 rounded-full bg-[var(--moka-card)] px-2.5 text-[12px] text-[var(--moka-muted)] @min-[26rem]/pane:inline-flex">
              <ClaudeIcon className="size-3.5" /> {accountName(chat.accountId)}
            </span>
          )}
          <IconButton icon={TermIcon} size={18} className={state.terms[chat.id] ? 'bg-[var(--moka-hover)] text-white' : ''} title={state.terms[chat.id] ? 'Hide terminal (Alt T)' : 'Terminal (Alt T)'} onClick={() => { focusPane(index); toggleTerm(chat.id); }} />
          {multi && (
            <IconButton icon={state.solo === index ? ContractIcon : ExpandIcon} size={16} title={state.solo === index ? 'Back to split' : 'Maximize'} onClick={() => { state.solo = state.solo === index ? null : index; bump(); }} />
          )}
          <IconButton icon={CloseIcon} size={20} title="Close pane (Alt W)" onClick={(e) => { e.stopPropagation(); closePane(index); }} />
        </div>
      </header>
      {items.length ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onWheel={(e) => { if (e.deltaY < 0) stick.current = false; }}
          onKeyDown={(e) => { if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') stick.current = false; }}
          onScroll={(e) => {
            const el = e.currentTarget;
            // Follow the bottom only while the reader is at the bottom: any scroll up lets go at once,
            // otherwise the next render would snap the view back and the thread would jump.
            const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (gap < 4) stick.current = true;
            else if (el.scrollTop < lastTop.current - 1) stick.current = false;
            lastTop.current = el.scrollTop;
            const far = gap > 160;
            if (far !== away) setAway(far);
          }}
        >
          <Thread chat={chat} items={items} />
        </div>
        {/* soft edges: two gradients in the pane colour instead of a mask on the scroller, a mask repaints on every scroll frame */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[26px] bg-gradient-to-b from-[var(--moka-chat)] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--moka-chat)] to-transparent" />
        {away && (
          <IconButton
            icon={DownIcon}
            size={20}
            title="Jump to the end"
            className="note absolute bottom-3 left-1/2 z-10 size-9 -translate-x-1/2 bg-[var(--moka-card)] text-white ring-1 ring-white/10 hover:bg-[var(--moka-hover)]"
            onClick={() => { const el = scroller.current; if (!el) return; stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }}
          />
        )}
        </div>
      ) : (
        <div data-chrome className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-hidden px-6 text-center [justify-content:safe_center]">
          <span className="reveal-deep"><Folder size={120} /></span>
          <span className="rounded-full bg-[var(--moka-card)] px-3.5 py-1.5 text-[13px] text-[var(--moka-muted)]">{chat.cwd}</span>
        </div>
      )}
      <TaskStrip chat={chat} items={items} />
      <Composer chat={chat} items={items} autoFocus={focused} />
      {state.terms[chat.id] && <Suspense fallback={null}><TerminalDrawer chat={chat} /></Suspense>}
    </section>
  );
}
