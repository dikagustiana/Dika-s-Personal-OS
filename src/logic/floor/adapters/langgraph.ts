// LangGraph `astream_events` (v2) shapes: { event, name, run_id, metadata, data, tags }.
// The graph node is the agent; the thread is the task. Node/tool starts mean
// work; a graph-level end means the artefact is done and gets delivered;
// errors are errors. Collaboration comes from `metadata.collaboration_group_id`
// or a `collab:<id>` tag.
import type { SemanticEvent } from '../scenario/semantic';
import { clampProgress, inferDepartment, num, obj, str, truncate, type Adapter } from './types';

export const langgraphAdapter: Adapter = {
  name: 'langgraph',
  normalize(raw: unknown): SemanticEvent[] {
    const r = obj(raw);
    const event = str(r.event);
    if (!event) return [];
    const meta = obj(r.metadata);
    const data = obj(r.data);
    const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [];
    const node = str(meta.langgraph_node);
    const name = str(r.name);
    const agentId = str(meta.agent_id) || node || name;
    if (!agentId) return [];
    const agentRole = str(meta.agent_role) || node || name;
    const department = inferDepartment(agentRole, meta.department);
    const taskId = str(meta.thread_id) || str(r.run_id) || null;
    const title = str(meta.task_title) || str(meta.graph_name) || name || 'LangGraph run';
    const tokens = num(obj(obj(data.chunk).usage_metadata).total_tokens) || num(meta.tokens_used);
    const progress = clampProgress(num(meta.progress, Number.NaN));
    const collabTag = tags.find((t) => t.startsWith('collab:'));
    const groupId = str(meta.collaboration_group_id) || (collabTag ? collabTag.slice('collab:'.length) : null);
    const base = {
      agentId,
      agentRole,
      department,
      taskId,
      title,
      progress: Number.isNaN(progress) ? 0 : progress,
      tokens,
    };
    const isGraphLevel = !node || (str(meta.graph_name) && name === str(meta.graph_name));

    switch (event) {
      case 'on_chain_start':
        if (groupId) return [{ ...base, state: 'collaborating', groupId, subtask: truncate(`Discussing ${name}`) }];
        return [{ ...base, state: 'working', subtask: truncate(`Running node ${node || name}`) }];
      case 'on_tool_start':
        return [{ ...base, state: 'working', subtask: truncate(`Using tool ${name}`) }];
      case 'on_tool_end':
        return [{ ...base, state: 'working', subtask: truncate(`Finished tool ${name}`) }];
      case 'on_chat_model_start':
        return [{ ...base, state: 'working', subtask: truncate(`Calling model ${name}`) }];
      case 'on_chat_model_end':
        return [{ ...base, state: 'working', subtask: 'Reading model response' }];
      case 'on_chain_end':
        if (isGraphLevel) return [{ ...base, state: 'delivering', progress: 100, subtask: 'Delivering graph output' }];
        return [{ ...base, state: 'working', subtask: truncate(`Finished node ${node}`) }];
      case 'on_chain_error':
      case 'on_tool_error':
      case 'on_chat_model_error':
        return [{ ...base, state: 'error', subtask: truncate(str(obj(data).error) || str(data.output) || `${event} in ${name}`) }];
      case 'on_chat_model_stream':
        // Token deltas alone are not a state change; only report if usage is present.
        return tokens > 0 ? [{ ...base, state: groupId ? 'collaborating' : 'working', groupId, subtask: 'Generating' }] : [];
      default:
        return [];
    }
  },
};
