// What an adapter knows: which agent is doing what. No coordinates. The
// positioner turns these into physical events on the wire.
export type SemanticStateName = 'idle' | 'working' | 'collaborating' | 'delivering' | 'error' | 'unknown';

export interface SemanticEvent {
  agentId: string;
  agentRole: string;
  /** Department label; matches a desk-bay zone's department, or 'Executive Office'. */
  department: string;
  state: SemanticStateName;
  /** Only with state 'unknown': the raw state string to put on the wire, to exercise B-2. */
  unknownStateName?: string;
  taskId: string | null;
  title: string;
  subtask: string;
  progress: number;
  tokens: number;
  /** Only with state 'collaborating'. */
  groupId?: string | null;
  /** Only with state 'delivering'. Defaults to the output terminal. */
  deliverTo?: 'output' | 'manager';
  /** Only with state 'idle': stay put instead of walking to the lounge. */
  idleWhere?: 'lounge' | 'here';
}
