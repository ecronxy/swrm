// MCP chip in the pane header: "MCP 3/4" (connected / all). Click opens the kit's
// ModalView with the servers (dot, tools or error, Reconnect, on/off) and a Rules tab
// with the allow/deny rules of the chat's folder.
import { useEffect, useState } from 'react';
import { Calligraph } from 'calligraph';
import ModalView from './tma/components/ModalView';
import Switch from './tma/components/Switch';
import SegmentedControl from './tma/components/SegmentedControl';
import { request, send } from './store.js';
import { IconButton, Press, Tip, cn } from './ui.jsx';
import PlugIcon from './icons/solar-plug-circle-linear.svg?react';
import CloseIcon from './icons/solar-close-circle-linear.svg?react';

const CHIP = 'inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--moka-card)] px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--moka-hover)] aria-expanded:bg-[var(--moka-hover)]';
const DOT = { connected: '#30d158', failed: '#ff453a', 'needs-auth': '#ff9f0a', pending: '#0a84ff', disabled: '#636366' };
const LABEL = { connected: 'Connected', failed: 'Failed', 'needs-auth': 'Needs login', pending: 'Connecting', disabled: 'Off' };

export function McpChip({ chat }) {
  const [open, setOpen] = useState(false);
  const list = chat.mcp;
  const total = list?.length || 0;
  const ok = list?.filter((s) => s.status === 'connected').length || 0;
  const failed = !!list?.some((s) => s.status === 'failed');
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Press className={cn(CHIP, failed ? 'text-[#ff453a]' : 'text-[var(--moka-muted)] hover:text-white')} title="MCP servers" aria-expanded={open} onClick={() => setOpen(true)}>
        <PlugIcon className="ico" style={{ fontSize: 14 }} />
        <span className="@max-[34rem]/pane:hidden">MCP</span>
        {total > 0 && <Calligraph variant="number" animation="smooth">{`${ok}/${total}`}</Calligraph>}
      </Press>
      {open && (
        <ModalView isOpen onClose={() => setOpen(false)}>
          <McpPanel chat={chat} />
        </ModalView>
      )}
    </span>
  );
}

function McpPanel({ chat }) {
  const [tab, setTab] = useState(0);
  return (
    <div className="flex w-full flex-col gap-3 p-4">
      <SegmentedControl segments={['MCP', 'Rules']} defaultIndex={0} onChange={setTab} style={{ width: '100%' }} />
      {tab === 0 ? <Servers chat={chat} /> : <Rules chat={chat} />}
    </div>
  );
}

const Hint = ({ children }) => <p className="px-2.5 py-3 text-[13px] leading-[18px] text-[var(--moka-muted)]">{children}</p>;

function Servers({ chat }) {
  const list = chat.mcp;
  if (!list) return <Hint>Servers show up once the chat starts. Send a message.</Hint>;
  if (!list.length) return <Hint>No MCP servers for this folder.</Hint>;
  return (
    <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto [scrollbar-width:none]">
      {list.map((s) => <ServerRow key={s.name} chat={chat} server={s} />)}
    </div>
  );
}

// Actions only send; the server answers with a fresh status on the chat, so the dot updates by itself.
function ServerRow({ chat, server: s }) {
  const off = s.status === 'disabled';
  const act = (action, enabled) => send({ type: 'mcp', id: chat.id, action, name: s.name, enabled });
  const detail = s.status === 'failed' && s.error ? s.error : [LABEL[s.status] || s.status, s.tools ? `${s.tools} tools` : ''].filter(Boolean).join(' · ');
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[16px] px-2.5 py-2">
      <span className="size-2 shrink-0 rounded-full" style={{ background: DOT[s.status] || DOT.disabled }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium text-white">{s.name}</span>
        <Tip text={detail} className="min-w-0" triggerClassName="min-w-0 max-w-full justify-start"><span className={cn('truncate text-[12px]', s.status === 'failed' ? 'text-[#ff453a]' : 'text-[var(--moka-muted)]')}>{detail}</span></Tip>
      </div>
      {!off && (
        <Press className="h-7 shrink-0 cursor-pointer rounded-full bg-[var(--moka-hover)] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#3c3c3c]" onClick={() => act('reconnect')}>
          Reconnect
        </Press>
      )}
      <Switch value={!off} onChange={(next) => act('toggle', next)} />
    </div>
  );
}

// Project and local rules can be deleted; the user-level file belongs to the account and stays read only here.
function Rules({ chat }) {
  const [rules, setRules] = useState(null);
  useEffect(() => { request({ type: 'rules', id: chat.id }).then((r) => r && setRules(r)); }, [chat.id]);
  if (!rules) return null;
  if (!rules.length) return <Hint>No rules yet. Pick "Always allow" on an approval.</Hint>;
  const remove = (r) => request({ type: 'ruleRemove', id: chat.id, scope: r.scope, behavior: r.behavior, rule: r.rule }).then((x) => x && setRules(x));
  return (
    <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto [scrollbar-width:none]">
      {rules.map((r) => (
        <div key={`${r.scope}-${r.behavior}-${r.rule}`} className="flex min-w-0 items-center gap-2 rounded-[16px] px-2.5 py-2">
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', r.behavior === 'allow' ? 'bg-[#30d158]/15 text-[#30d158]' : 'bg-[#ff453a]/15 text-[#ff453a]')}>{r.behavior}</span>
          <Tip text={r.rule} className="min-w-0 flex-1" triggerClassName="min-w-0 max-w-full justify-start"><code className="min-w-0 truncate font-mono text-[12px] text-white/85">{r.rule}</code></Tip>
          <span className="shrink-0 text-[11px] text-[var(--moka-muted)]">{r.scope}</span>
          {r.editable && <IconButton icon={CloseIcon} size={16} title="Delete rule" onClick={() => remove(r)} />}
        </div>
      ))}
    </div>
  );
}
