// Timeline rows with t3code's class strings: TimelineUserMessageRow, the
// "Worked for" header, TimelineWorkEntryRow, TimelinePendingApprovalRow, ChatMarkdown.
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Calligraph } from 'calligraph';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Eye from './icons/solar-eye-linear.svg?react';
import SquarePen from './icons/solar-pen-new-square-linear.svg?react';
import Terminal from './icons/solar-programming-linear.svg?react';
import Search from './icons/solar-magnifer-linear.svg?react';
import Globe from './icons/solar-global-linear.svg?react';
import Bot from './icons/solar-stars-minimalistic-linear.svg?react';
import Bulb from './icons/solar-lightbulb-minimalistic-linear.svg?react';
import Zap from './icons/solar-bolt-linear.svg?react';
import ListTodo from './icons/solar-checklist-minimalistic-linear.svg?react';
import Wrench from './icons/solar-settings-minimalistic-linear.svg?react';
import X from './icons/solar-close-circle-linear.svg?react';
import CopyIcon from './icons/solar-copy-linear.svg?react';
import CheckIcon from './icons/solar-check-read-linear.svg?react';
import RetryIcon from './icons/solar-restart-linear.svg?react';
import Shield from './icons/solar-shield-check-linear.svg?react';
import ChevronDown from './icons/solar-alt-arrow-down-linear.svg?react';
import ChevronRight from './icons/solar-alt-arrow-right-linear.svg?react';
import RewindIcon from './icons/solar-undo-left-round-linear.svg?react';
import Spinner from './tma/components/Spinner';
import { IconButton, Press, cn, duration, useTick } from './ui.jsx';
import { openRewind, send } from './store.js';
import { MessageAttachments } from './attach.jsx';

marked.setOptions({ gfm: true, breaks: false });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// The agent can echo text from files and web pages, so its markdown is always sanitized.
// While a reply streams, parsing the whole text on every chunk is quadratic work: parse at most every 120 ms.
function useThrottled(value, ms, on) {
  const [v, setV] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => { last.current = Date.now(); setV(value); }, Math.max(0, ms - (Date.now() - last.current)));
    return () => clearTimeout(t);
  }, [value, ms, on]);
  return on ? v : value;
}

export function Markdown({ text, streaming }) {
  const shown = useThrottled(text, 120, streaming);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(shown || '')), [shown]);
  return (
    <div
      className="chat-markdown w-full min-w-0 [overflow-wrap:anywhere] [word-break:break-word] text-[15px] leading-[1.5] text-white/90"
      data-streaming={streaming ? '' : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// One outline icon per tool kind.
const TOOL_ICONS = {
  Read: Eye, NotebookRead: Eye, Edit: SquarePen, MultiEdit: SquarePen, Write: SquarePen, NotebookEdit: SquarePen,
  Bash: Terminal, Grep: Search, Glob: Search, WebFetch: Globe, WebSearch: Globe,
  Task: Bot, Agent: Bot, Skill: Zap, TodoWrite: ListTodo,
};
const TOOL_HEADINGS = {
  Read: 'Read', NotebookRead: 'Read', Edit: 'Edited', MultiEdit: 'Edited', Write: 'Wrote', NotebookEdit: 'Edited',
  Bash: 'Ran', Grep: 'Searched', Glob: 'Listed', WebFetch: 'Fetched', WebSearch: 'Searched the web',
  Task: 'Agent', Agent: 'Agent', Skill: 'Skill', TodoWrite: 'Updated plan',
};

function toolHeading(name) {
  if (TOOL_HEADINGS[name]) return TOOL_HEADINGS[name];
  if (name.startsWith('mcp__')) return name.split('__').slice(1).join(' ');
  return name;
}

function WorkEntry({ item }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[item.name] || Wrench;
  const failed = item.status === 'error';
  const running = item.status === 'running';
  const hasBody = !!(item.detail?.text || item.output);
  return (
    <div className="flex flex-col">
      <Press
                className={cn('group/live-work flex min-h-6 w-full max-w-full items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70', item.output ? 'cursor-pointer' : 'cursor-default')}
        onClick={() => hasBody && setOpen((v) => !v)}
      >
        <span className={cn('flex size-4 items-center justify-center', failed ? 'text-destructive' : running ? 'text-foreground' : 'text-icon-muted')}>
          {failed ? <X className="size-3 shrink-0" /> : <Icon className={cn('block size-4 shrink-0 ', running && 'animate-pulse')} />}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="flex min-w-0 w-full items-baseline gap-1.5 text-sm leading-relaxed">
            <span className={cn('shrink-0', failed ? 'font-medium text-destructive' : 'text-foreground/80')}>{toolHeading(item.name)}</span>
            {item.summary && <span className="min-w-0 truncate text-secondary-label">{item.summary}</span>}
            {item.task && <span className="shrink-0 text-[12px] text-[var(--moka-muted)]">{item.task.status === 'running' ? 'in background' : item.task.status}</span>}
            {item.diff && (item.diff.add > 0 || item.diff.del > 0) && (
              <span className="shrink-0 font-mono text-xs">
                <span className="text-diff-addition-foreground">+{item.diff.add}</span>{' '}
                <span className="text-diff-deletion-foreground">−{item.diff.del}</span>
              </span>
            )}
          </span>
        </span>
        {hasBody && <span className={cn('flex shrink-0 text-[var(--moka-muted)] opacity-0 transition duration-200 group-hover/live-work:opacity-100', open && 'rotate-90 opacity-100')}><ChevronRight className="size-3" /></span>}
      </Press>
      {hasBody && (
        <div className="fold" data-open={open || undefined}>
          <div>
            <div className="ms-6 mt-1 mb-1 flex flex-col gap-2">
              {item.detail?.text && <ToolDetail name={item.name} detail={item.detail} />}
              {item.output && (
                <div>
                  <div className="mb-1 text-[11px] tracking-wide text-[var(--moka-muted)]">Output</div>
                  <pre className={CODE}>{item.output}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CODE = 'max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-[var(--moka-card)] px-3 py-2 font-mono text-[12px] leading-5 text-white/80 select-text';

// What the tool was asked to do: the command, the diff, the pattern.
function ToolDetail({ name, detail }) {
  if (detail.kind === 'diff') {
    return (
      <pre className={CODE}>
        {detail.text.split('\n').map((l, i) => (
          <div key={i} className={l.startsWith('+') ? 'text-diff-addition-foreground' : l.startsWith('-') ? 'text-diff-deletion-foreground' : undefined}>{l}</div>
        ))}
      </pre>
    );
  }
  if (detail.kind === 'code') return <pre className={CODE}>{name === 'Bash' ? `$ ${detail.text}` : detail.text}</pre>;
  return <p className="cursor-text whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--moka-muted)] select-text">{detail.text}</p>;
}

// The model's reasoning: a quiet row that opens while it streams and folds itself when it is done.
function ThinkingRow({ item }) {
  const [open, setOpen] = useState(!!item.live);
  const wasLive = useRef(!!item.live);
  useEffect(() => {
    if (wasLive.current && !item.live) setOpen(false);
    wasLive.current = !!item.live;
  }, [item.live]);
  return (
    <div className="flex flex-col">
      <Press className="flex min-h-6 w-full items-center gap-2 rounded-md text-left" onClick={() => item.text && setOpen((v) => !v)}>
        <span className={cn('flex size-4 items-center justify-center text-icon-muted', item.live && 'animate-pulse')}><Bulb className="block size-4 shrink-0" /></span>
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm leading-relaxed">
          <span className="text-foreground/80">{item.live ? 'Thinking' : 'Thought'}</span>
          {!item.live && item.durationMs > 1000 && <span className="text-secondary-label tabular-nums">for {duration(item.durationMs)}</span>}
        </span>
        {item.text && <span className={cn('ms-auto flex text-[var(--moka-muted)] transition-transform duration-200', open && 'rotate-90')}><ChevronRight className="size-3" /></span>}
      </Press>
      {item.text && (
        <div className="fold" data-open={open || undefined}>
          <div>
            <div className="ms-6 mt-1 mb-1 max-h-64 cursor-text overflow-auto border-s border-white/10 ps-3 text-[13px] leading-[1.55] whitespace-pre-wrap break-words text-[var(--moka-muted)] select-text">{item.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline record of an approval; the live buttons sit on the composer like in t3code.
function ApprovalRow({ item }) {
  const resolved = {
    allowed: 'Approved once',
    allowedSession: 'Approved for this session',
    allowedAlways: 'Always allowed in this folder',
    denied: 'Declined',
    cancelled: 'Cancelled',
  }[item.state];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-6 items-start gap-2">
        <span className="flex size-4 h-6 items-center justify-center"><Shield className="block size-4 shrink-0  text-icon-muted" /></span>
        <code className="block max-h-40 min-w-0 flex-1 overflow-auto whitespace-pre-wrap py-0.5 font-mono text-xs leading-5 text-foreground select-text [overflow-wrap:anywhere] ">
          {item.questions ? item.questions.map((q) => q.question).join('\n') : item.detail || item.tool}
        </code>
      </div>
      <div className="ms-6 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pb-1 text-xs">
        {item.state === 'pending'
          ? <span className="inline-flex items-center gap-1 text-warning"><Shield aria-hidden className="size-3 shrink-0" />{item.questions ? 'Waiting for your answer' : `${item.tool} needs approval`}</span>
          : <span className="text-muted-foreground">{item.answers ? Object.values(item.answers).join(', ') : resolved}</span>}
      </div>
    </div>
  );
}

// Calls a subagent made carry `parent`: they live under its card, not on the timeline. The tree maps a parent id to its calls.
const TreeCtx = createContext(new Map());
function childTree(items) {
  const tree = new Map();
  for (const it of items) {
    if (!it.parent) continue;
    const list = tree.get(it.parent);
    if (list) list.push(it);
    else tree.set(it.parent, [it]);
  }
  return tree;
}
// The given items plus every call nested under them, depth first.
function withKids(list, tree) {
  const out = [];
  const walk = (it) => { out.push(it); for (const k of tree.get(it.id) || []) walk(k); };
  list.forEach(walk);
  return out;
}

// A subagent as a live card: what it is doing right now, the timer, its steps folded underneath,
// and what it returned once it is done.
function AgentCard({ item }) {
  const tree = useContext(TreeCtx);
  const t = item.task;
  const running = t?.status === 'running';
  const failed = t?.status === 'failed' || t?.status === 'stopped';
  const [open, setOpen] = useState(false);
  useTick(1000, running);
  const kids = tree.get(item.id) || [];
  const elapsed = t ? (running ? Date.now() - t.startedAt : t.durationMs || (t.endedAt ? t.endedAt - t.startedAt : 0)) : 0;
  return (
    <div className="rise flex min-w-0 flex-col gap-2.5 rounded-[18px] bg-[var(--moka-card)] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', failed ? 'bg-[#ff453a]/15 text-[#ff453a]' : 'bg-[var(--moka-hover)] text-white')}>
          {running ? <Spinner size={12} /> : failed ? <X className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5 text-[14px] leading-snug">
            <span className="shrink-0 font-medium text-white">{t?.subagentType || 'Agent'}</span>
            <span className="min-w-0 truncate text-[var(--moka-muted)]">{t?.description || item.summary || 'Working'}</span>
          </div>
          {running && (
            <div className="mt-0.5 min-w-0 truncate text-[13px] text-[var(--moka-accent)]">
              <Calligraph variant="text" animation="smooth">{t.action || 'Starting'}</Calligraph>
            </div>
          )}
        </div>
        {t && (
          <span className="shrink-0 text-[12px] text-[var(--moka-muted)] tabular-nums">
            <Calligraph variant="text" animation="smooth">{duration(elapsed)}</Calligraph>
          </span>
        )}
      </div>
      {t && (t.tools > 0 || t.tokens > 0) && (
        <div className="flex gap-3 ps-9 text-[12px] text-[var(--moka-muted)] tabular-nums">
          <span><Calligraph variant="number" animation="smooth">{String(t.tools || 0)}</Calligraph> {t.tools === 1 ? 'step' : 'steps'}</span>
          {t.tokens > 0 && <span><Calligraph variant="text" animation="smooth">{compact(t.tokens)}</Calligraph> tokens</span>}
        </div>
      )}
      {kids.length > 0 && (
        <div className="flex flex-col">
          <Press
            className="flex w-fit cursor-pointer items-center gap-1 ps-9 text-[13px] text-[var(--moka-muted)] transition-colors hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Show'} {kids.length} {kids.length === 1 ? 'call' : 'calls'}
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </Press>
          <div className="fold" data-open={open || undefined}>
            <div>
              <div className="mt-2 flex flex-col gap-1.5 border-s border-white/10 ps-3 ms-9">
                {kids.map((k) => <LogItem key={k.id} item={k} />)}
              </div>
            </div>
          </div>
        </div>
      )}
      {!running && item.output && <div className="min-w-0 text-[14px] leading-relaxed"><Markdown text={item.output} /></div>}
    </div>
  );
}

function LogItem({ item }) {
  if (item.t === 'tool') return item.name === 'Task' || item.name === 'Agent' ? <AgentCard item={item} /> : <WorkEntry item={item} />;
  if (item.t === 'cmdout') return <CmdOut text={item.text} />;
  if (item.t === 'thinking') return <ThinkingRow item={item} />;
  if (item.t === 'text') return item.text ? <Markdown text={item.text} streaming={item.live} /> : null;
  if (item.t === 'perm') return <ApprovalRow item={item} />;
  if (item.t === 'note') {
    return (
      <div role="separator" className="mx-auto flex w-full items-center gap-3 py-1 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border/70" />
        <span className="relative min-w-0 overflow-hidden">{item.text}</span>
        <span className="h-px flex-1 bg-border/70" />
      </div>
    );
  }
  if (item.t === 'error') return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-destructive">{item.text}</p>;
  return null;
}

function Working({ chat }) {
  useTick(1000);
  return (
    <div className="flex h-6 min-w-0 items-center gap-2 text-[14px] leading-relaxed text-[var(--moka-accent)] tabular-nums">
      <Spinner size={14} />
      <span className="truncate">{chat.activity ? chat.activity[0].toUpperCase() + chat.activity.slice(1) : 'Working'}</span>
      {chat.turnStartedAt > 0 && <span>{duration(Date.now() - chat.turnStartedAt)}</span>}
    </div>
  );
}

function changedFiles(items) {
  const files = new Map();
  for (const it of items) {
    if (it.t !== 'tool' || !it.diff || it.status === 'error') continue;
    const f = files.get(it.summary) || { add: 0, del: 0 };
    files.set(it.summary, { add: f.add + it.diff.add, del: f.del + it.diff.del });
  }
  let add = 0;
  let del = 0;
  for (const f of files.values()) { add += f.add; del += f.del; }
  return { count: files.size, add, del };
}

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n));

// Under a finished reply, like the desktop apps: copy, run the prompt again,
// and a short usage line: tokens, share of the 5h limit, speed.
function ReplyActions({ chat, text, prompt, done }) {
  const [copied, setCopied] = useState(false);
  const busy = chat.status === 'working';
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const stats = [
    done.outTokens ? `${compact(done.outTokens)} tok` : '',
    done.limitPct != null ? `${done.limitPct}%` : '',
    done.tokPerSec ? `${Math.round(done.tokPerSec)} tok/s` : '',
  ].filter(Boolean);
  return (
    <div className="-mt-0.5 flex min-w-0 items-center gap-0.5 pl-1">
      <IconButton icon={copied ? CheckIcon : CopyIcon} title={copied ? 'Copied' : 'Copy'} size={17} onClick={copy} />
      {prompt && <IconButton icon={RetryIcon} title="Try again" size={17} disabled={busy} onClick={() => send({ type: 'send', id: chat.id, text: prompt })} />}
      {stats.length > 0 && <span className="ml-2 truncate text-[12px] text-[var(--moka-muted)] tabular-nums select-none">{stats.join(' · ')}</span>}
    </div>
  );
}

// Output of a slash command (/usage, /context ...): a plain card, line breaks kept, not a chat reply.
function CmdOut({ text }) {
  return (
    <div className="max-w-full rounded-[18px] bg-[var(--moka-card)] px-4 py-3">
      <div className="mb-1 text-[11px] font-medium tracking-wide text-[var(--moka-muted)] uppercase">Command output</div>
      <pre className="m-0 font-[inherit] text-[13px] leading-[19px] break-words whitespace-pre-wrap text-white/85 select-text">{text}</pre>
    </div>
  );
}

function Turn({ chat, turn, last }) {
  const [open, setOpen] = useState(false);
  const tree = useContext(TreeCtx);
  const { items, done } = turn;

  if (!done) {
    return (
      <div className="flex flex-col gap-1.5">
        {items.map((it) => (it.t === 'text' && it.text ? <ReplyBubble key={it.id}><Markdown text={it.text} streaming={it.live} /></ReplyBubble> : <LogItem key={it.id} item={it} />))}
        {last && chat.status === 'working' && !items.some((it) => it.t === 'thinking' && it.live) && <Working chat={chat} />}
      </div>
    );
  }

  let finalIdx = -1;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].t === 'text' && items[i].text?.trim()) { finalIdx = i; break; }
  const log = items.filter((it, i) => i !== finalIdx && it.t !== 'error' && it.t !== 'cmdout');
  const cmds = items.filter((it) => it.t === 'cmdout');
  const errors = items.filter((it) => it.t === 'error');
  const changes = changedFiles(withKids(items, tree));

  return (
    <div className="group/reply flex flex-col gap-2">
      {log.length > 0 && (
        <div className="group/timeline-row">
          <div className="relative flex items-center gap-1">
            <Press
                            className="flex cursor-pointer select-none items-center gap-1 rounded-md text-[13px] leading-relaxed text-[var(--moka-muted)] tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => setOpen((v) => !v)}
            >
              Worked for {duration(done.durationMs)}
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </Press>
          </div>
          <div className="fold" data-open={open || undefined}><div><div className="mt-2 flex flex-col gap-1.5">{log.map((it) => <LogItem key={it.id} item={it} />)}</div></div></div>
        </div>
      )}
      {cmds.map((it) => <CmdOut key={it.id} text={it.text} />)}
      {finalIdx >= 0 && <ReplyBubble><Markdown text={items[finalIdx].text} /></ReplyBubble>}
      {finalIdx >= 0 && (
        <div className={last ? undefined : 'opacity-0 transition-opacity group-hover/reply:opacity-100 focus-within:opacity-100'}>
          <ReplyActions chat={chat} text={items[finalIdx].text} prompt={turn.user?.text} done={done} />
        </div>
      )}
      {errors.map((it) => <LogItem key={it.id} item={it} />)}
      {!done.ok && done.error && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-destructive">{done.error}</p>}
      {changes.count > 0 && (
        <div className="flex w-fit items-center gap-2 rounded-full bg-[var(--moka-hover)] px-3 py-1 text-left text-[13px]">
          <span className="text-foreground/80">{changes.count} changed {changes.count === 1 ? 'file' : 'files'}</span>
          <span className="font-mono text-xs">
            <span className="text-diff-addition-foreground">+{changes.add}</span>{' '}
            <span className="text-diff-deletion-foreground">−{changes.del}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// Every item id in a turn, so search can find the turn that holds a message (see useJump in sessions.jsx).
const turnIds = (t) => [t.user?.id, ...t.items.map((it) => it.id), t.done?.id].filter(Boolean).join(' ');

function UserBubble({ children }) {
  return <div className="rise group flex flex-col items-end gap-1">{children}</div>;
}

// The reply text sits in a card; thinking, tools and status around it are plain text on the canvas.
function ReplyBubble({ children }) {
  return (
    <div className="rise flex">
      <div className="min-w-0 max-w-[88%] rounded-[18px_18px_18px_6px] bg-[var(--moka-card)] px-3.5 py-2.5">{children}</div>
    </div>
  );
}

export function Thread({ chat, items }) {
  const tree = useMemo(() => childTree(items), [items]);
  const turns = [];
  let cur = null;
  for (const it of items) {
    if (it.parent) continue; // a subagent's call: shown under its Agent card
    if (it.t === 'user') {
      cur = { user: it, items: [], done: null };
      turns.push(cur);
    } else {
      if (!cur) { cur = { user: null, items: [], done: null }; turns.push(cur); }
      if (it.t === 'done') cur.done = it;
      else cur.items.push(it);
    }
  }
  return (
    <TreeCtx.Provider value={tree}><div className="chat-content-lane mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-2.5 px-3 pt-4 pb-4">
      {turns.map((t, i) => (
        <Fragment key={t.user?.id || `t${i}`}>
          {t.user && (
            <UserBubble>
              <div data-ids={t.user.id} className="flex min-w-0 max-w-[80%] flex-col items-end gap-1.5">
                {t.user.atts?.length > 0 && <MessageAttachments atts={t.user.atts} />}
                {t.user.text && (
                  <div className="min-w-0 rounded-[18px_18px_6px_18px] bg-[var(--moka-accent)] px-3.5 py-2 text-white">
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.45] select-text">{t.user.text}</p>
                  </div>
                )}
              </div>
              {t.user.uuid && chat.status === 'idle' && (
                <IconButton icon={RewindIcon} size={15} title="Rewind here" className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => openRewind(chat.id, t.user.id)} />
              )}
            </UserBubble>
          )}
          {(t.items.length > 0 || (i === turns.length - 1 && chat.status === 'working')) && (
            <div data-ids={turnIds(t)} className="rise min-w-0 px-1"><Turn chat={chat} turn={t} last={i === turns.length - 1} /></div>
          )}
        </Fragment>
      ))}
    </div></TreeCtx.Provider>
  );
}
