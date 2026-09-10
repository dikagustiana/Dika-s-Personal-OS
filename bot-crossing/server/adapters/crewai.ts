// CrewAI event-bus shapes: { type, timestamp, agent: { id, role }, task: { id, description, name }, tool_name, ... }.
// An agent's execution/task start is work, tool usage is a subtask, task
// completion delivers, failures are errors. Delegation carries a
// `collaboration_group_id` when the emitter provides one.
import type { SemanticEvent } from '../../src/core/scenario/semantic';
import { clampProgress, inferDepartment, num, obj, str, truncate, type Adapter } from './types';

export const crewaiAdapter: Adapter = {
  name: 'crewai',
  normalize(raw: unknown): SemanticEvent[] {
    const r = obj(raw);
    const type = str(r.type) || str(r.event_type);
    if (!type) return [];
    const agent = obj(r.agent);
    const task = obj(r.task);
    const role = str(agent.role) || str(r.agent_role);
    const agentId = str(agent.id) || str(r.agent_id) || (role ? `crew-${role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '');
    if (!agentId) return [];
    const department = inferDepartment(role, agent.department ?? r.department);
    const taskId = str(task.id) || str(r.task_id) || null;
    const title = str(task.name) || truncate(str(task.description), 60) || str(r.crew_name) || 'Crew task';
    const tokens = num(obj(r.usage).total_tokens) || num(r.total_tokens);
    const progress = clampProgress(num(r.progress, 0));
    const groupId = str(r.collaboration_group_id) || null;
    const base = { agentId, agentRole: role || agentId, department, taskId, title, progress, tokens };

    switch (type) {
      case 'agent_execution_started':
      case 'task_started':
        if (groupId) return [{ ...base, state: 'collaborating', groupId, subtask: truncate(str(task.description) || 'Working with the crew') }];
        return [{ ...base, state: 'working', subtask: truncate(str(task.description) || 'Starting task') }];
      case 'tool_usage_started':
        return [{ ...base, state: groupId ? 'collaborating' : 'working', groupId, subtask: truncate(`Using tool ${str(r.tool_name)}`) }];
      case 'tool_usage_finished':
        return [{ ...base, state: groupId ? 'collaborating' : 'working', groupId, subtask: truncate(`Finished tool ${str(r.tool_name)}`) }];
      case 'llm_call_started':
        return [{ ...base, state: groupId ? 'collaborating' : 'working', groupId, subtask: 'Calling the model' }];
      case 'agent_execution_completed':
        return [{ ...base, state: 'working', progress: Math.max(progress, 90), subtask: 'Wrapping up' }];
      case 'task_completed':
        return [{ ...base, state: 'delivering', progress: 100, subtask: 'Delivering task output' }];
      case 'task_failed':
      case 'agent_execution_error':
      case 'tool_usage_error':
      case 'llm_call_failed':
        return [{ ...base, state: 'error', subtask: truncate(str(r.error) || str(r.message) || type) }];
      case 'crew_kickoff_completed':
        return [{ ...base, state: 'idle', taskId: null, subtask: 'Crew finished' }];
      default:
        return [];
    }
  },
};
