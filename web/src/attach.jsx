// Files for the composer: paste, drop, or the paperclip. Pictures are shrunk on the page when they are too big,
// then uploaded to POST /att/<chat>. The composer keeps them as thumbnails until the message goes out, the
// queue chips and the timeline show them from there. Pictures open full size in the viewer.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Spinner from './tma/components/Spinner';
import PaperclipIcon from './icons/solar-paperclip-linear.svg?react';
import ClockIcon from './icons/solar-clock-circle-linear.svg?react';
import CloseIcon from './icons/solar-close-circle-linear.svg?react';
import { bump, closeViewer, openViewer, send, state, toast } from './store.js';
import { IconButton, Press, Tip, cn } from './ui.jsx';

export const MAX_PER_MESSAGE = 8;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_PICTURE = 5 * 1024 * 1024; // same limit the server enforces
const MAX_SIDE = 2000; // the API refuses several pictures with a side over 2000 px
const KEEP_AS_IS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const attachmentsOf = (chatId) => state.attachments[chatId] || [];

function setList(chatId, list) {
  state.attachments = { ...state.attachments, [chatId]: list };
  bump();
}

function patch(chatId, key, change) {
  setList(chatId, attachmentsOf(chatId).map((a) => (a.key === key ? { ...a, ...change } : a)));
}

// Decodes a picture the browser can draw. The caller revokes the url it gets back.
async function decode(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { img, url };
}

const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

// Pictures that fit already go up untouched. Bigger ones are redrawn on a canvas at 2000 px
// and re-encoded until they fit under 5 MB.
async function shrink(file) {
  if (!file.type.startsWith('image/')) return file;
  let decoded;
  try { decoded = await decode(file); } catch { return file; } // not something the page can draw: send it as it is
  const { img, url } = decoded;
  try {
    return await redraw(img, file);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function redraw(img, file) {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (file.size <= MAX_PICTURE && Math.max(w, h) <= MAX_SIDE && KEEP_AS_IS.includes(file.type)) return file;
  const canvas = document.createElement('canvas');
  let scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  for (let pass = 0; pass < 4; pass++) {
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.92, 0.8, 0.65]) {
      const blob = await toBlob(canvas, 'image/webp', q);
      if (blob && blob.size <= MAX_PICTURE) return blob;
    }
    scale *= 0.7;
  }
  return (await toBlob(canvas, 'image/jpeg', 0.6)) || file;
}

async function upload(chatId, blob, name) {
  const res = await fetch(`/att/${chatId}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'X-Swrm-Att': '1', 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Upload failed (${res.status})`);
  return res.json();
}

// Adds files to a chat's composer. Each one shows at once as a thumbnail and uploads in the background.
export function addFiles(chatId, files) {
  const incoming = [...files];
  const live = attachmentsOf(chatId).filter((a) => !a.leaving);
  const room = Math.max(0, MAX_PER_MESSAGE - live.length);
  if (incoming.length > room) toast(`Up to ${MAX_PER_MESSAGE} attachments per message`);
  for (const file of incoming.slice(0, room)) {
    if (file.size > MAX_FILE) { toast(`${file.name} is over 10 MB`); continue; }
    const key = Math.random().toString(36).slice(2);
    const picture = file.type.startsWith('image/');
    setList(chatId, [...attachmentsOf(chatId), { key, name: file.name || 'file', kind: picture ? 'image' : 'file', preview: '', status: 'uploading', ref: null, error: '', leaving: false }]);
    (async () => {
      try {
        const blob = await shrink(file);
        if (picture && blob.type.startsWith('image/')) patch(chatId, key, { preview: URL.createObjectURL(blob) });
        const ref = await upload(chatId, blob, file.name || 'image');
        patch(chatId, key, { status: 'ready', ref, kind: ref.kind });
      } catch (e) {
        patch(chatId, key, { status: 'error', error: String(e.message || e).slice(0, 200) });
      }
    })();
  }
}

// Removes a thumbnail: it shrinks out first, then leaves the list.
export function removeAttachment(chatId, key) {
  patch(chatId, key, { leaving: true });
  setTimeout(() => {
    const gone = attachmentsOf(chatId).find((a) => a.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setList(chatId, attachmentsOf(chatId).filter((a) => a.key !== key));
  }, 170);
}

export const canSendAttachments = (chatId) => attachmentsOf(chatId).every((a) => a.status === 'ready' && !a.leaving);
export const hasAttachments = (chatId) => attachmentsOf(chatId).some((a) => !a.leaving);

// The refs of a send. Called once, when the message goes out.
export function takeAttachments(chatId) {
  const refs = attachmentsOf(chatId).filter((a) => a.status === 'ready' && !a.leaving).map((a) => ({ id: a.ref.id, name: a.name, kind: a.kind }));
  for (const a of attachmentsOf(chatId)) if (a.preview) URL.revokeObjectURL(a.preview);
  setList(chatId, []);
  return refs;
}

// The paperclip next to the composer: the system file picker.
export function AttachButton({ chatId }) {
  return (
    <IconButton
      icon={PaperclipIcon}
      size={18}
      title="Attach files"
      onClick={() => document.getElementById(`att-input-${chatId}`)?.click()}
    />
  );
}

// Hidden picker for the paperclip, rendered once per composer.
export function AttachInput({ chatId }) {
  return (
    <input
      id={`att-input-${chatId}`}
      type="file"
      multiple
      className="hidden"
      onChange={(e) => {
        addFiles(chatId, e.currentTarget.files);
        e.currentTarget.value = '';
      }}
    />
  );
}

function Thumb({ chatId, a }) {
  return (
    <div className={cn('thumb-in relative shrink-0', a.leaving && 'thumb-out')}>
      {a.kind === 'image' && a.preview ? (
        <img src={a.preview} alt={a.name} className="size-16 rounded-[14px] bg-[var(--moka-hover)] object-cover" />
      ) : (
        <div className="flex h-16 w-44 items-center gap-2 rounded-[14px] bg-[var(--moka-hover)] px-3 text-[13px] text-white">
          <PaperclipIcon className="ico shrink-0 text-[var(--moka-muted)]" style={{ fontSize: 16 }} />
          <span className="min-w-0 truncate">{a.name}</span>
        </div>
      )}
      {a.status === 'uploading' && (
        <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/45"><Spinner size={18} /></span>
      )}
      {a.status === 'error' && (
        <Tip text={a.error} className="absolute inset-0" triggerClassName="size-full"><span className="grid size-full place-items-center rounded-[14px] bg-black/65 text-[11px] font-medium text-[#ff453a]">Failed</span></Tip>
      )}
      <Press
        aria-label={`Remove ${a.name}`}
        title="Remove"
        onClick={() => removeAttachment(chatId, a.key)}
        className="absolute -end-1.5 -top-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-[#2c2c2e] text-white hover:bg-[#3c3c3c]"
      >
        <CloseIcon className="ico" style={{ fontSize: 16 }} />
      </Press>
    </div>
  );
}

// The thumbnails above the text box.
export function AttachStrip({ chatId }) {
  const list = attachmentsOf(chatId);
  if (!list.length) return null;
  return (
    <div className="banner">
      <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-0.5 ps-3.5">
        {list.map((a) => <Thumb key={a.key} chatId={chatId} a={a} />)}
      </div>
    </div>
  );
}

// Messages waiting for the agent: a chip each, with a remove mark and "Stop & send".
export function QueueStrip({ chat }) {
  const list = chat.queued || [];
  if (!list.length) return null;
  return (
    <div className="banner">
      <div className="flex flex-col gap-1.5 px-3 pt-3 pb-0.5">
        {list.map((q) => {
          const label = q.text || `${q.files} ${q.files === 1 ? 'file' : 'files'}`;
          return (
            <div key={q.id} className="note flex h-9 min-w-0 items-center gap-2 rounded-full bg-[var(--moka-hover)] ps-3 pe-1 text-[13px] text-white">
              <ClockIcon className="ico shrink-0 text-[var(--moka-muted)]" style={{ fontSize: 14 }} />
              <span className="shrink-0 text-[var(--moka-muted)]">Queued</span>
              <Tip text={q.text} className="min-w-0 flex-1" triggerClassName="min-w-0 max-w-full justify-start"><span className="min-w-0 truncate">{label}{q.text && q.files ? ` +${q.files}` : ''}</span></Tip>
              <Press
                title="Stop the turn and send this one now"
                onClick={() => send({ type: 'sendNow', id: chat.id, qid: q.id })}
                className="h-7 shrink-0 cursor-pointer rounded-full bg-[var(--moka-card)] px-3 text-[12px] font-semibold text-white hover:bg-[#3c3c3c]"
              >
                Stop &amp; send
              </Press>
              <Press
                title="Remove from queue"
                aria-label="Remove from queue"
                onClick={() => send({ type: 'unqueue', id: chat.id, qid: q.id })}
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--moka-muted)] hover:bg-[#3c3c3c] hover:text-white"
              >
                <CloseIcon className="ico" style={{ fontSize: 16 }} />
              </Press>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Attachments of a sent message: pictures open in the viewer on click, other files show as a name.
export function MessageAttachments({ atts }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {atts.map((a) => (a.kind === 'image' && a.url ? (
        <Tip key={a.id} text="Open"><button type="button" onClick={() => openViewer(a.url)} className="block size-16 cursor-zoom-in overflow-hidden rounded-[14px]">
          <img src={a.url} alt={a.name} loading="lazy" className="block size-16 bg-[var(--moka-hover)] object-cover" />
        </button></Tip>
      ) : (
        <span key={a.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--moka-hover)] px-3 py-1 text-[13px] text-white">
          <PaperclipIcon className="ico shrink-0" style={{ fontSize: 14 }} />
          <span className="truncate">{a.name}</span>
        </span>
      )))}
    </div>
  );
}

// Full-size picture over the whole app. Click or Esc closes it.
export function ImageViewer() {
  const src = state.viewer;
  useEffect(() => {
    if (!src) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeViewer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src]);
  if (!src) return null;
  return createPortal(
    <div onClick={closeViewer} className="palette-overlay fixed inset-0 z-[70] grid cursor-zoom-out place-items-center bg-black/75 p-4">
      <img src={src} alt="" className="max-h-[92dvh] max-w-[94vw] rounded-[22px] object-contain" />
    </div>,
    document.body,
  );
}
