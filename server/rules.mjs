// Permission rules (permissions.allow / deny) from the settings files a chat loads:
// user (the account's config dir, read only here) and project + local (the chat's folder).
// Rules are written by the CLI itself when "Always allow" is picked; this file only lists them and deletes.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './paths.mjs';

function settingsFiles(acc, folder) {
  return [
    { scope: 'user', file: path.join(acc.dir, 'settings.json'), editable: false },
    { scope: 'project', file: path.join(folder, '.claude', 'settings.json'), editable: true },
    { scope: 'local', file: path.join(folder, '.claude', 'settings.local.json'), editable: true },
  ];
}

export function readRules(acc, folder) {
  const out = [];
  for (const { scope, file, editable } of settingsFiles(acc, folder)) {
    const perms = readJson(file, {})?.permissions || {};
    for (const behavior of ['allow', 'deny']) {
      const list = Array.isArray(perms[behavior]) ? perms[behavior] : [];
      for (const rule of list) if (typeof rule === 'string') out.push({ scope, behavior, rule, editable });
    }
  }
  return out;
}

export function removeRule(acc, folder, scope, behavior, rule) {
  const hit = settingsFiles(acc, folder).find((f) => f.scope === scope);
  if (!hit?.editable) throw new Error('That rule lives in a settings file swrm does not edit');
  if (behavior !== 'allow' && behavior !== 'deny') throw new Error('Unknown rule type');
  const data = readJson(hit.file, null);
  const list = data?.permissions?.[behavior];
  if (!Array.isArray(list) || !list.includes(rule)) return;
  data.permissions[behavior] = list.filter((r) => r !== rule);
  // Same layout Claude Code writes (2 spaces), through a temp file so a crash never leaves half a file.
  // Write to the real file behind a symlink and keep its mode: this file often holds env keys (0600).
  const target = fs.realpathSync(hit.file);
  const mode = fs.statSync(target).mode & 0o777;
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
  fs.renameSync(tmp, target);
}
