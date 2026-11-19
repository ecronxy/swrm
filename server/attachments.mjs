// Images and files dropped into the composer. The browser uploads each one first (POST /att/<chat>),
// so the websocket only carries small references. Files live in DATA_DIR/att/<chat>/ and come back
// through GET /att/<chat>/<file> for the thumbnails in the timeline. Only the file type decides what
// is an image: its bytes must start with a known image signature, and the name keeps the matching extension.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';

export const ATT_DIR = path.join(DATA_DIR, 'att');
export const MAX_PER_MESSAGE = 8;
const MAX_IMAGE = 5 * 1024 * 1024; // the client shrinks bigger pictures before upload
const MAX_FILE = 10 * 1024 * 1024;
const SERVE_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const CHAT_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Keeps letters, digits, dots and dashes only, so a name can never walk out of its folder.
export function safeName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-100);
  return clean || 'file';
}

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

const mb = (n) => `${Math.round(n / 1048576)} MB`;

// Writes one upload and returns its reference: { id, name, kind }.
export function save(chatId, name, buf) {
  if (!CHAT_RE.test(chatId)) throw new HttpError(400, 'Unknown chat');
  if (!buf.length) throw new HttpError(400, 'Empty file');
  const stem = safeName(name);
  const ext = sniff(buf);
  let file;
  if (ext) {
    if (buf.length > MAX_IMAGE) throw new HttpError(413, `Picture is over ${mb(MAX_IMAGE)}`);
    file = `${stem.replace(/\.[^.]*$/, '') || 'image'}.${ext}`;
  } else {
    if (buf.length > MAX_FILE) throw new HttpError(413, `File is over ${mb(MAX_FILE)}`);
    // A file that only pretends to be a picture keeps a non-image name, so it is never served as one.
    file = SERVE_TYPES[stem.split('.').pop().toLowerCase()] ? `${stem}.bin` : stem;
  }
  const id = `${crypto.randomUUID()}-${file}`;
  const dir = path.join(ATT_DIR, chatId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), buf);
  return { id, name: stem, kind: ext ? 'image' : 'file' };
}

// What the page needs to show an attachment in the timeline.
export function view(chatId, r) {
  return { id: r.id, name: r.name, kind: r.kind, url: r.kind === 'image' ? `/att/${chatId}/${r.id}` : '' };
}

// Checks the references a send brings: each must be a file this chat really uploaded.
// The kind comes from the stored name, never from the client.
export function refsFrom(chatId, list) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > MAX_PER_MESSAGE) throw new Error(`Up to ${MAX_PER_MESSAGE} attachments per message`);
  return list.map((a) => {
    const id = String(a?.id || '');
    if (!CHAT_RE.test(chatId) || !FILE_RE.test(id) || !fs.existsSync(path.join(ATT_DIR, chatId, id))) {
      throw new Error('An attachment is gone, attach it again');
    }
    const ext = path.extname(id).slice(1).toLowerCase();
    return { id, name: String(a.name || id).slice(0, 120), kind: SERVE_TYPES[ext] ? 'image' : 'file' };
  });
}

// The user turn for the agent: pictures as image blocks, other files as a path Claude reads with Read.
// Without pictures the content stays a plain string, exactly like a text-only message.
export function compose(chatId, body, refs) {
  const blocks = [];
  const paths = [];
  for (const r of refs) {
    const file = path.join(ATT_DIR, chatId, r.id);
    if (r.kind === 'image') {
      const ext = path.extname(r.id).slice(1).toLowerCase();
      blocks.push({ type: 'image', source: { type: 'base64', media_type: SERVE_TYPES[ext], data: fs.readFileSync(file).toString('base64') } });
    } else {
      paths.push(`Attached file: ${file}`);
    }
  }
  const text = [body, ...paths].filter(Boolean).join('\n\n');
  if (!blocks.length) return text;
  return text ? [...blocks, { type: 'text', text }] : blocks;
}

export function removeChat(chatId) {
  if (!CHAT_RE.test(chatId)) return;
  fs.rm(path.join(ATT_DIR, chatId), { recursive: true, force: true }, () => {});
}

const MAX_BODY = MAX_FILE + 1024;

// POST /att/<chat>?name=...  (body = the file, the X-Swrm-Att header proves a real page sent it)
// GET  /att/<chat>/<file>    (pictures only inline, everything else as a download)
export function handleHttp(req, res, url, { hasChat, originOk }) {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const parts = url.pathname.split('/'); // ['', 'att', chat, file?]
  const chatId = parts[2] || '';
  if (!originOk) return send(403, 'Forbidden');

  if (req.method === 'POST' && parts.length === 3) {
    if (req.headers['x-swrm-att'] !== '1') return send(403, 'Forbidden');
    if (!hasChat(chatId)) return send(404, 'No such chat');
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; } // keep reading, so the 413 reaches the page
      if (!tooBig) chunks.push(c);
    });
    req.on('error', () => {});
    req.on('end', () => {
      if (tooBig) return send(413, 'File is too big');
      try {
        const ref = save(chatId, url.searchParams.get('name') || '', Buffer.concat(chunks));
        send(200, view(chatId, ref), 'application/json');
      } catch (e) {
        send(e.status || 400, String(e.message || e));
      }
    });
    return undefined;
  }

  if (req.method === 'GET' && parts.length === 4) {
    const id = parts[3];
    if (!CHAT_RE.test(chatId) || !FILE_RE.test(id)) return send(404, 'Not found');
    const file = path.join(ATT_DIR, chatId, id);
    if (!fs.existsSync(file)) return send(404, 'Not found');
    const ext = path.extname(id).slice(1).toLowerCase();
    const type = SERVE_TYPES[ext];
    res.writeHead(200, {
      'Content-Type': type || 'application/octet-stream',
      'Content-Disposition': type ? 'inline' : `attachment; filename="${id.slice(37)}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    });
    const rs = fs.createReadStream(file);
    rs.on('error', () => res.destroy());
    rs.pipe(res);
    return undefined;
  }

  return send(405, 'Method not allowed');
}
