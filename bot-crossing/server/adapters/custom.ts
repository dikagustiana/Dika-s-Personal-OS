// Custom function-calling pipelines post the semantic shape directly:
// { agentId, agentRole?, department?, state, taskId?, title?, subtask?, progress?, tokens?, groupId?, deliverTo?, idleWhere? }
// Unknown `state` strings are forwarded as an unknown state so the client
// shows UNKNOWN_STATE rather than guessing.
import type { SemanticEvent, SemanticStateName } from '../../src/core/scenario/semantic';
import { clampProgress, inferDepartment, num, obj, str, truncate, type Adapter } from './types';

const KNOWN: SemanticStateName[] = ['idle', 'working', 'collaborating', 'delivering', 'error'];

export const customAdapter: Adapter = {
  name: 'custom',
  normalize(raw: unknown): SemanticEvent[] {
    const list = Array.isArray(raw) ? raw : [raw];
    const out: SemanticEvent[] = [];
    for (const item of list) {
      const r = obj(item);
      const agentId = str(r.agentId) || str(r.agent);
      const stateRaw = str(r.state).toLowerCase();
      if (!agentId || !stateRaw) continue;
      const known = KNOWN.includes(stateRaw as SemanticStateName);
      const role = str(r.agentRole) || str(r.role) || agentId;
      const ev: SemanticEvent = {
        agentId,
        agentRole: role,
        department: inferDepartment(role, r.department),
        state: known ? (stateRaw as SemanticStateName) : 'unknown',
        taskId: str(r.taskId) || null,
        title: truncate(str(r.title), 80),
        subtask: truncate(str(r.subtask)),
        progress: clampProgress(num(r.progress, 0)),
        tokens: Math.max(0, num(r.tokens, 0)),
      };
      if (!known) ev.unknownStateName = str(r.state);
      const groupId = str(r.groupId) || str(r.collaborationGroupId);
      if (groupId) ev.groupId = groupId;
      const deliverTo = str(r.deliverTo);
      if (deliverTo === 'output' || deliverTo === 'manager') ev.deliverTo = deliverTo;
      const idleWhere = str(r.idleWhere);
      if (idleWhere === 'here' || idleWhere === 'lounge') ev.idleWhere = idleWhere;
      out.push(ev);
    }
    return out;
  },
};
