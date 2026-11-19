// Rewind picker. Double Esc in an idle chat, or "Rewind here" on a message, opens it.
// Step 1 lists the chat's messages; step 2 asks what to put back and shows what the files would change.
import { useEffect, useState } from 'react';
import ModalView from './tma/components/ModalView';
import { closeRewind, openRewind, previewRewind, rewindTo, state, useStore } from './store.js';
import { Press, cn, timeAgo } from './ui.jsx';

const MODES = [
  ['conversation', 'Conversation only', 'Back to before this message. Files stay as they are.', false],
  ['files', 'Files only', 'Put the files back. The conversation stays as it is.', true],
  ['both', 'Conversation and files', 'Back to before this message, files put back too.', true],
];
const ROW = 'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--moka-hover)] disabled:opacity-40';

// Double Esc: only from an idle chat, with nothing else open, and only when focus is on the page or a composer.
function useDoubleEsc() {
  useEffect(() => {
    let last = 0;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (state.rewindOpen) return;
      const t = e.target;
      if (t && t !== document.body && t.tagName !== 'TEXTAREA') return;
      const now = Date.now();
      if (now - last > 450) { last = now; return; }
      last = 0;
      const id = state.panes[state.focused];
      const chat = id && state.chats[id];
      if (!chat || chat.status !== 'idle') return;
      e.preventDefault();
      openRewind(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function RewindDialog() {
  useStore();
  useDoubleEsc();
  const id = state.rewindOpen;
  const chat = id && state.chats[id];
  if (!chat) return null;
  return (
    <ModalView isOpen onClose={closeRewind}>
      <Picker key={`${id}:${state.rewindItem}`} chat={chat} itemId={state.rewindItem} />
    </ModalView>
  );
}

function Picker({ chat, itemId }) {
  const items = state.items[chat.id] || [];
  const target = itemId && items.find((it) => it.id === itemId && it.t === 'user');
  if (target) return <Choose chat={chat} item={target} />;
  const picks = items.filter((it) => it.t === 'user' && it.uuid).slice(-30).reverse();
  return (
    <div className="flex w-full flex-col gap-2 p-4">
      <span className="px-2 pt-1 text-[16px] font-semibold text-white">Rewind to a message</span>
      {picks.length === 0 && <span className="px-2 pb-2 text-[13px] text-[var(--moka-muted)]">Nothing to rewind to yet.</span>}
      <div className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {picks.map((it) => (
          <Press key={it.id} className={ROW} onClick={() => openRewind(chat.id, it.id)}>
            <span className="line-clamp-2 w-full break-words text-[14px] text-white">{it.text}</span>
            <span className="text-[12px] text-[var(--moka-muted)] tabular-nums">{timeAgo(it.ts)}</span>
          </Press>
        ))}
      </div>
    </div>
  );
}

function Choose({ chat, item }) {
  const [preview, setPreview] = useState(null); // { files } | { error } | null while checking
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    previewRewind(chat.id, item.id).then((r) => {
      if (alive) setPreview(r.error ? { error: r.error } : { files: r.preview });
    });
    return () => { alive = false; };
  }, [chat.id, item.id]);

  const files = preview?.files;
  const canFiles = !!files?.canRewind;
  const go = async (mode) => {
    setBusy(true);
    const ok = await rewindTo(chat.id, item.id, mode);
    setBusy(false);
    if (ok) closeRewind();
  };

  let note = 'Checking the files';
  if (preview?.error) note = preview.error;
  else if (files && !canFiles) note = `Files cannot be rewound: ${files.error || 'unknown reason'}`;
  else if (files) {
    const n = files.filesChanged?.length || 0;
    const names = (files.filesChanged || []).slice(0, 6).map((f) => String(f).split('/').slice(-2).join('/')).join(', ');
    note = n ? `${n} ${n === 1 ? 'file' : 'files'} would change, +${files.insertions || 0} −${files.deletions || 0}: ${names}${n > 6 ? ` and ${n - 6} more` : ''}. Edits made in these files by anything else since then are overwritten.` : 'No files would change';
  }

  return (
    <div className="flex w-full flex-col gap-3 p-4">
      <button type="button" className="w-fit cursor-pointer px-2 pt-1 text-[13px] text-[var(--moka-muted)] hover:text-white" onClick={() => openRewind(chat.id, '')}>
        Back
      </button>
      <div className="flex flex-col gap-1 px-2">
        <span className="text-[16px] font-semibold text-white">Rewind to here?</span>
        <span className="line-clamp-3 break-words text-[14px] text-white/75">{item.text}</span>
        <span className={cn('pt-1 text-[12px] tabular-nums', canFiles || !files ? 'text-[var(--moka-muted)]' : 'text-[#ff9f0a]')}>{note}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {MODES.map(([mode, label, hint, needsFiles]) => (
          <Press key={mode} className={ROW} disabled={busy || (needsFiles && !canFiles)} onClick={() => go(mode)}>
            <span className="text-[14px] font-medium text-white">{label}</span>
            <span className="text-[12px] text-[var(--moka-muted)]">{hint}</span>
          </Press>
        ))}
      </div>
    </div>
  );
}
