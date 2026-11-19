// Background work of the open chat: subagents, background commands and monitors, as pills above the composer.
// A pill opens its details (what it is doing, or the command's output); the stop square ends the task.
import { useEffect, useState } from 'react';
import { Calligraph } from 'calligraph';
import Spinner from './tma/components/Spinner';
import Bot from './icons/solar-stars-minimalistic-linear.svg?react';
import Terminal from './icons/solar-programming-linear.svg?react';
import Eye from './icons/solar-eye-linear.svg?react';
import StopIcon from './icons/solar-stop-bold.svg?react';
import { IconButton, Press, cn, duration, useTick } from './ui.jsx';
import { stopTask, taskOutput } from './store.js';

const KIND_ICON = { agent: Bot, shell: Terminal, monitor: Eye, workflow: Bot, task: Bot };
const KIND_LABEL = { agent: 'Subagent', shell: 'Background command', monitor: 'Monitor', workflow: 'Workflow', task: 'Task' };

export const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n || 0));

export function TaskStrip({ chat, items }) {
  const list = items.filter((it) => it.t === 'tool' && it.task?.status === 'running');
  const [openId, setOpenId] = useState('');
  useTick(1000, list.length > 0);
  if (!list.length) return null;
  const open = list.find((it) => it.id === openId);
  return (
    <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-2 px-3 pb-2">
      <div className="flex flex-wrap gap-1.5">
        {list.map((it) => (
          <TaskPill key={it.id} chat={chat} item={it} on={it.id === openId} onToggle={() => setOpenId(it.id === openId ? '' : it.id)} />
        ))}
      </div>
      {open && <TaskDetail key={open.id} chat={chat} item={open} />}
    </div>
  );
}

function TaskPill({ chat, item, on, onToggle }) {
  const t = item.task;
  const Icon = KIND_ICON[t.kind] || Bot;
  const label = t.description || item.summary || KIND_LABEL[t.kind] || 'Task';
  return (
    <span className={cn('inline-flex h-8 max-w-full items-center rounded-full bg-[var(--moka-card)] ps-1 pe-1 text-[12px] text-white transition-colors', on && 'bg-[var(--moka-hover)]')}>
      <Press className="inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-full ps-2 pe-2.5 hover:bg-[var(--moka-hover)]" title={`${KIND_LABEL[t.kind] || 'Task'}: ${label}`} onClick={onToggle}>
        <Spinner size={11} />
        <Icon className="ico shrink-0 text-[var(--moka-muted)]" style={{ fontSize: 13 }} />
        <span className="max-w-44 truncate">{label}</span>
        <span className="shrink-0 text-[var(--moka-muted)] tabular-nums">
          <Calligraph variant="text" animation="smooth">{duration(Date.now() - t.startedAt)}</Calligraph>
        </span>
      </Press>
      <IconButton icon={StopIcon} size={11} className="size-6 text-[var(--moka-muted)] hover:text-[#ff453a]" title="Stop task" onClick={() => stopTask(chat.id, t.taskId)} />
    </span>
  );
}

// Opens in place with the rise animation. An agent shows what it is doing now and its counts;
// a command or monitor shows the tail of its output, read again every couple of seconds while it runs.
function TaskDetail({ chat, item }) {
  const t = item.task;
  const isAgent = t.kind === 'agent' || t.kind === 'workflow' || t.kind === 'task';
  const [out, setOut] = useState('');
  useEffect(() => {
    if (isAgent) return undefined;
    let alive = true;
    const read = () => taskOutput(chat.id, t.taskId).then((text) => { if (alive) setOut(text); });
    read();
    const timer = setInterval(read, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [chat.id, t.taskId, isAgent]);

  return (
    <div className="rise flex flex-col gap-2 rounded-[18px] bg-[var(--moka-card)] px-3.5 py-3">
      <div className="flex min-w-0 items-baseline gap-2 text-[13px]">
        <span className="shrink-0 font-medium text-white">{KIND_LABEL[t.kind] || 'Task'}</span>
        {t.subagentType && <span className="shrink-0 text-[var(--moka-muted)]">{t.subagentType}</span>}
        <span className="min-w-0 truncate text-[var(--moka-muted)]">{t.description || item.summary}</span>
      </div>
      {isAgent ? (
        <>
          <div className="min-w-0 truncate text-[13px] text-[var(--moka-accent)]">
            <Calligraph variant="text" animation="smooth">{t.action || 'Starting'}</Calligraph>
          </div>
          <div className="flex gap-3 text-[12px] text-[var(--moka-muted)] tabular-nums">
            <span><Calligraph variant="number" animation="smooth">{String(t.tools || 0)}</Calligraph> tools</span>
            <span><Calligraph variant="text" animation="smooth">{tokens(t.tokens)}</Calligraph> tokens</span>
          </div>
        </>
      ) : (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-[var(--moka-chat)] px-3 py-2 font-mono text-[12px] leading-5 text-white/80 select-text">
          {out || 'No output yet.'}
        </pre>
      )}
    </div>
  );
}
