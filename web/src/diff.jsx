// Changes of the focused chat, after t3code's diff panel: files with +/−, each
// unfolds into its patch, commit with a message and push at the bottom.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Spinner from './tma/components/Spinner';
import { loadDiff, send, state, toggleDiff } from './store.js';
import { IconButton, Press, Tip, cn, folderName } from './ui.jsx';
import CloseIcon from './icons/solar-close-circle-linear.svg?react';
import BranchIcon from './icons/solar-git-branch-linear.svg?react';
import ChevronRight from './icons/solar-alt-arrow-right-linear.svg?react';

const PILL = 'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors disabled:cursor-default disabled:opacity-40';
const STATUS = { added: ['A', 'text-[#30d158]'], deleted: ['D', 'text-[#ff453a]'], renamed: ['R', 'text-[var(--moka-accent)]'], modified: ['M', 'text-[#ff9f0a]'] };
const MAX_LINES = 1500;

function Patch({ file }) {
  if (file.binary) return <p className="px-4 py-2 text-[12px] text-[var(--moka-muted)]">Binary file</p>;
  if (file.patch == null) return <p className="px-4 py-2 text-[12px] text-[var(--moka-muted)]">Too large to show</p>;
  const lines = file.patch.split('\n');
  return (
    <pre className="mx-2 mb-2 overflow-x-auto rounded-[14px] bg-[var(--moka-card)] py-1.5 font-mono text-[12px] leading-5 select-text">
      {lines.slice(0, MAX_LINES).map((l, i) => (
        <div
          key={i}
          className={cn(
            'min-w-max px-3 whitespace-pre',
            l.startsWith('@@') ? 'text-[var(--moka-muted)]' : l.startsWith('+') ? 'bg-[#30d158]/12 text-[#7ee2a0]' : l.startsWith('-') ? 'bg-[#ff453a]/12 text-[#ff8a82]' : 'text-white/75',
          )}
        >
          {l || ' '}
        </div>
      ))}
      {lines.length > MAX_LINES && <div className="px-3 text-[var(--moka-muted)]">{lines.length - MAX_LINES} more lines</div>}
    </pre>
  );
}

function FileRow({ file, open, onToggle }) {
  const slash = file.path.lastIndexOf('/');
  const [letter, color] = STATUS[file.status] || STATUS.modified;
  return (
    <div>
      <Press className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-[14px] px-2.5 text-left text-[13px] hover:bg-[var(--moka-card)]" onClick={onToggle}>
        <ChevronRight className={cn('ico spin-chevron shrink-0 text-[var(--moka-muted)]', open && 'rotate-90')} style={{ fontSize: 12 }} />
        <span className={cn('w-3 shrink-0 text-[12px] font-semibold', color)}>{letter}</span>
        <Tip text={file.path} className="min-w-0 flex-1" triggerClassName="min-w-0 max-w-full justify-start">
          <span className="flex min-w-0 items-baseline">
            <span className="shrink-0 truncate text-white">{file.path.slice(slash + 1)}</span>
            {slash > 0 && <span className="ms-1.5 min-w-0 truncate text-[12px] text-[var(--moka-muted)]">{file.path.slice(0, slash)}</span>}
          </span>
        </Tip>
        <span className="shrink-0 text-[12px] tabular-nums">
          {file.add > 0 && <span className="text-diff-addition-foreground">+{file.add}</span>}
          {file.add > 0 && file.del > 0 && ' '}
          {file.del > 0 && <span className="text-diff-deletion-foreground">−{file.del}</span>}
        </span>
      </Press>
      <div className="fold" data-open={open || undefined}><div>{open && <Patch file={file} />}</div></div>
    </div>
  );
}

function Commit({ chat, d, busy }) {
  const [msg, setMsg] = useState('');
  const ta = useRef(null);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [msg]);
  const canCommit = d.files.length > 0 && !!msg.trim() && !busy;
  const canPush = !d.files.length && !!d.branch && (d.ahead > 0 || !d.upstream) && !busy;
  const commit = () => {
    if (!canCommit) return;
    loadDiff(chat.id, 'commit');
    send({ type: 'commit', id: chat.id, message: msg });
    setMsg('');
  };
  return (
    <div data-chrome className="m-2 mt-0 shrink-0 rounded-[22px] bg-[var(--moka-card)]">
      {d.files.length > 0 && (
        <textarea
          ref={ta}
          rows={1}
          value={msg}
          placeholder="Commit message"
          className="block min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-[1.45] text-white outline-none placeholder:text-[var(--moka-muted)]"
          onChange={(e) => setMsg(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } }}
        />
      )}
      <div className="flex items-center gap-2 p-2">
        <span className="min-w-0 flex-1 truncate ps-2 text-[12px] text-[var(--moka-muted)]">
          {d.files.length ? `${d.files.length} ${d.files.length === 1 ? 'file' : 'files'}` : d.ahead ? `${d.ahead} to push` : d.upstream ? 'Up to date' : 'Not on the remote'}
        </span>
        <Press
          className={cn(PILL, 'bg-[var(--moka-hover)] text-white enabled:hover:bg-[#3c3c3c]')}
          disabled={!canPush}
          onClick={() => { loadDiff(chat.id, 'push'); send({ type: 'push', id: chat.id }); }}
        >
          {busy === 'push' && <Spinner size={14} />} Push
        </Press>
        {d.files.length > 0 && (
          <Press className={cn(PILL, 'bg-[var(--moka-accent)] text-white enabled:hover:bg-[#2b95ff]')} disabled={!canCommit} onClick={commit} title="Commit (Ctrl Enter)">
            {busy === 'commit' && <Spinner size={14} />} Commit
          </Press>
        )}
      </div>
    </div>
  );
}

export function DiffPanel({ chat }) {
  const d = state.diffs[chat.id];
  const busy = state.diffBusy[chat.id];
  const [open, setOpen] = useState({});
  // Reload on focus change and whenever the chat's change count moves or a turn ends.
  useEffect(() => { loadDiff(chat.id); }, [chat.id, chat.git?.add, chat.git?.del, chat.git?.branch, chat.status === 'idle']);
  useEffect(() => { setOpen({}); }, [chat.id]);

  const add = d?.files.reduce((n, f) => n + f.add, 0) || 0;
  const del = d?.files.reduce((n, f) => n + f.del, 0) || 0;

  return (
    <aside className="reveal flex min-h-0 w-[26rem] shrink-0 flex-col overflow-hidden rounded-[22px] bg-[var(--moka-chat)]">
      <header data-chrome className="flex h-13 shrink-0 items-center gap-2 ps-4 pe-2.5">
        <span className="text-[14px] font-medium text-white">Changes</span>
        {d?.files.length > 0 && (
          <span className="text-[12px] tabular-nums">
            {add > 0 && <span className="text-diff-addition-foreground">+{add}</span>}
            {add > 0 && del > 0 && ' '}
            {del > 0 && <span className="text-diff-deletion-foreground">−{del}</span>}
          </span>
        )}
        <span className="flex-1" />
        {d?.branch && (
          <Tip text={chat.worktree ? `Worktree of ${folderName(chat.cwd)}` : 'Branch'} className="min-w-0" triggerClassName="min-w-0 max-w-full justify-start"><span className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-[var(--moka-card)] px-2.5 text-[12px] text-[var(--moka-muted)]">
            <BranchIcon className="ico shrink-0" style={{ fontSize: 13 }} />
            <span className="max-w-40 truncate">{d.branch}</span>
          </span></Tip>
        )}
        <IconButton icon={CloseIcon} size={20} title="Hide changes" onClick={() => toggleDiff(false)} />
      </header>
      {!d ? (
        <div className="flex flex-1 items-center justify-center"><Spinner size={20} /></div>
      ) : !d.repo ? (
        <Quiet>Not a git repository</Quiet>
      ) : (
        <>
          {d.files.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
              {d.files.map((f, i) => (
                <div key={f.path} className="rise-cell" style={{ '--i': Math.min(i, 12) }}>
                  <FileRow file={f} open={!!open[f.path]} onToggle={() => setOpen({ ...open, [f.path]: !open[f.path] })} />
                </div>
              ))}
            </div>
          ) : (
            <Quiet>No changes</Quiet>
          )}
          <Commit chat={chat} d={d} busy={busy} />
        </>
      )}
    </aside>
  );
}

function Quiet({ children }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <span className="rounded-full bg-[var(--moka-card)] px-3.5 py-1.5 text-[13px] text-[var(--moka-muted)]">{children}</span>
    </div>
  );
}
