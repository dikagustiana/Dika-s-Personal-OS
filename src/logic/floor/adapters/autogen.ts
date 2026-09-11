// AutoGen AgentChat message shapes: { type, source, content, models_usage, metadata }.
// A group chat is a collaboration: every speaker in the same team shares a
// collaborationGroupId (team_id / session_id). Tool calls are individual work,
// a stop/result message delivers, and errors are errors.
import type { SemanticEvent } from '../scenario/semantic';
import { inferDepartment, num, obj, str, truncate, type Adapter } from './types';

export const autogenAdapter: Adapter = {
  name: 'autogen',
  normalize(raw: unknown): SemanticEvent[] {
    const r = obj(raw);
    const type = str(r.type);
    const source = str(r.source);
    if (!type || !source || source === 'user') return [];
    const meta = obj(r.metadata);
    const usage = obj(r.models_usage);
    const tokens = num(usage.prompt_tokens) + num(usage.completion_tokens);
    const groupId = str(r.team_id) || str(meta.team_id) || str(r.session_id) || str(meta.session_id) || null;
    const taskId = str(meta.task_id) || groupId;
    const content = typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '');
    const base = {
      agentId: source,
      agentRole: str(meta.role) || source,
      department: inferDepartment(source, meta.department),
      taskId,
      title: str(meta.task_title) || (groupId ? `Group chat ${groupId}` : 'AutoGen conversation'),
      progress: num(meta.progress, 0),
      tokens,
    };
    switch (type) {
      case 'TextMessage':
      case 'MultiModalMessage':
      case 'ThoughtEvent':
        if (groupId) return [{ ...base, state: 'collaborating', groupId, subtask: truncate(content) }];
        return [{ ...base, state: 'working', subtask: truncate(content) }];
      case 'ToolCallRequestEvent':
        return [{ ...base, state: 'working', subtask: truncate(`Calling ${toolNames(r.content)}`) }];
      case 'ToolCallExecutionEvent':
        return [{ ...base, state: 'working', subtask: 'Reading tool results' }];
      case 'HandoffMessage':
        return [{ ...base, state: 'working', subtask: truncate(`Handing off to ${str(r.target)}`) }];
      case 'StopMessage':
      case 'TaskResult':
        return [{ ...base, state: 'delivering', progress: 100, subtask: 'Delivering conversation result' }];
      case 'ErrorEvent':
      case 'error':
        return [{ ...base, state: 'error', subtask: truncate(content || 'Agent error') }];
      case 'ModelClientStreamingChunkEvent':
        return [];
      default:
        return [];
    }
  },
};

function toolNames(content: unknown): string {
  if (!Array.isArray(content)) return 'tool';
  const names = content.map((c) => str(obj(c).name)).filter(Boolean);
  return names.length ? names.join(', ') : 'tool';
}
