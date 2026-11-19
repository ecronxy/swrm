// MCP servers of a running chat. The chat's SDK query is the only source of truth:
// its status list is kept on the chat meta in memory (not saved) and the header chip reads it.

// Keeps only what the chip and the panel draw, so the page never gets SDK internals.
export function summarizeMcp(list) {
  return (Array.isArray(list) ? list : []).map((s) => ({
    name: s.name,
    status: s.status,
    error: s.error || '',
    scope: s.scope || '',
    tools: Array.isArray(s.tools) ? s.tools.length : 0,
  }));
}

export async function fetchMcp(q) {
  return summarizeMcp(await q.mcpServerStatus());
}

export async function mcpAction(q, action, name, enabled) {
  if (action === 'reconnect') return q.reconnectMcpServer(name);
  if (action === 'toggle') return q.toggleMcpServer(name, !!enabled);
  throw new Error(`Unknown MCP action: ${action}`);
}
