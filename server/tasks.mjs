// Background work the agent starts: subagents (Task/Agent), background shells and monitors.
// The SDK reports each one as system messages keyed by task_id. The tool call that started it
// carries the same tool_use_id, so the view of a task lives on that tool item as `task` and is
// saved with the chat. A subagent's own calls arrive with parent_tool_use_id, so the timeline
// can nest them under the Agent card.

const KIND = { local_agent: 'agent', local_bash: 'shell', monitor: 'monitor', local_workflow: 'workflow' };
const STATUS = { pending: 'running', running: 'running', paused: 'running', completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' };

export const taskKind = (type) => KIND[type] || 'task';

export class TaskRegistry {
  #byId = new Map();
  #byTool = new Map();
  #outs = new Map(); // tool_use_id -> output file, when the start result named it

  start(m) {
    const rec = {
      taskId: m.task_id,
      toolUseId: m.tool_use_id || '',
      kind: taskKind(m.task_type),
      subagentType: m.subagent_type || '',
      description: m.description || '',
      parentTaskId: m.parent_task_id || '',
      backgrounded: m.is_backgrounded !== false,
      status: 'running',
      action: '',
      tools: 0,
      tokens: 0,
      startedAt: Date.now(),
      endedAt: 0,
      durationMs: 0,
      summary: '',
      outputFile: this.#outs.get(m.tool_use_id) || '',
    };
    this.#byId.set(rec.taskId, rec);
    if (rec.toolUseId) this.#byTool.set(rec.toolUseId, rec.taskId);
    return rec;
  }

  get(taskId) {
    return this.#byId.get(taskId) || null;
  }

  // Task events that come after task_started only carry the task_id, so the record is looked up here.
  // Returns null for a task this process never saw start (e.g. a resumed one), which the caller can ignore.
  progress(m) {
    const rec = this.get(m.task_id);
    if (!rec) return null;
    const u = m.usage || {};
    rec.tokens = Number(u.total_tokens) || rec.tokens;
    rec.tools = Number(u.tool_uses) || rec.tools;
    rec.durationMs = Number(u.duration_ms) || rec.durationMs;
    if (m.summary) rec.action = String(m.summary).slice(0, 200);
    if (m.description) rec.description = String(m.description);
    return rec;
  }

  update(m) {
    const rec = this.get(m.task_id);
    if (!rec) return null;
    const p = m.patch || {};
    if (p.status && STATUS[p.status]) this.#setStatus(rec, STATUS[p.status]);
    if (p.description) rec.description = String(p.description);
    if (p.is_backgrounded != null) rec.backgrounded = !!p.is_backgrounded;
    return rec;
  }

  finish(m) {
    const rec = this.get(m.task_id);
    if (!rec) return null;
    this.#setStatus(rec, STATUS[m.status] || 'done');
    rec.summary = String(m.summary || '').slice(0, 600);
    rec.outputFile = m.output_file || rec.outputFile;
    if (m.usage) {
      rec.tokens = Number(m.usage.total_tokens) || rec.tokens;
      rec.tools = Number(m.usage.tool_uses) || rec.tools;
      rec.durationMs = Number(m.usage.duration_ms) || rec.durationMs;
    }
    return rec;
  }

  // A background command's start result names the file its output goes to, before or after task_started.
  outputFor(toolUseId, file) {
    this.#outs.set(toolUseId, file);
    const rec = this.byTool(toolUseId);
    if (rec) rec.outputFile = file;
  }

  // One call a subagent made: it becomes the agent's current action and counts as a step.
  step(toolUseId, action) {
    const rec = this.byTool(toolUseId);
    if (!rec) return null;
    rec.tools += 1;
    rec.action = action;
    return rec;
  }

  byTool(toolUseId) {
    const id = this.#byTool.get(toolUseId);
    return id ? this.get(id) : null;
  }

  // The turn is over but a background task may still run, so only a process end settles them all.
  endAll(status = 'stopped') {
    const out = [];
    for (const rec of this.#byId.values()) {
      if (rec.status !== 'running') continue;
      this.#setStatus(rec, status);
      out.push(rec);
    }
    return out;
  }

  #setStatus(rec, status) {
    rec.status = status;
    if (status !== 'running' && !rec.endedAt) {
      rec.endedAt = Date.now();
      rec.durationMs = rec.durationMs || rec.endedAt - rec.startedAt;
    }
  }
}

// What the UI gets on the tool item. Plain values only.
export function taskView(rec) {
  return {
    taskId: rec.taskId,
    kind: rec.kind,
    status: rec.status,
    description: rec.description,
    subagentType: rec.subagentType,
    action: rec.action,
    tools: rec.tools,
    tokens: rec.tokens,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    durationMs: rec.durationMs,
    summary: rec.summary,
    backgrounded: rec.backgrounded,
    parentTaskId: rec.parentTaskId,
  };
}
