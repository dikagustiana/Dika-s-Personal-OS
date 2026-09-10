// The scripted, looping, twenty-agent scenario (A-5). Runs over the real
// transport through the same scheduler/positioner as live adapters. Exercises
// all six states, a three-agent collaboration, a two-agent one, an error, an
// unknown state, and two deliberately malformed frames per loop.
import { ROSTER, TASKS_BY_DEPARTMENT, mulberry32, type RosterAgent } from '../../src/core/scenario/roster';
import type { SemanticEvent } from '../../src/core/scenario/semantic';
import { EmissionScheduler } from '../scheduler';
import type { EventSource, SourceContext } from './types';

interface ActiveTask {
  taskId: string;
  title: string;
  subtasks: string[];
  progress: number;
  tokens: number;
}

interface AgentPlan {
  roster: RosterAgent;
  taskIndex: number;
  task: ActiveTask | null;
  phase: 'idle' | 'working' | 'delivering' | 'special';
  timer: NodeJS.Timeout | null;
}

export const LOOP_SECONDS = 180;

export interface MockOptions {
  includeMalformed?: boolean;
  includeUnknownState?: boolean;
  seed?: number;
}

export class MockEventSource implements EventSource {
  readonly name = 'mock';
  private ctx!: SourceContext;
  private scheduler!: EmissionScheduler;
  private readonly plans = new Map<string, AgentPlan>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private rng = mulberry32(7);
  private taskCounter = 4000;
  private loop = 0;
  private running = false;

  constructor(private readonly opts: MockOptions = {}) {}

  start(ctx: SourceContext): void {
    this.ctx = ctx;
    this.running = true;
    this.rng = mulberry32(this.opts.seed ?? 7);
    this.scheduler = new EmissionScheduler(ctx, 'mock');
    ROSTER.forEach((r, i) => {
      const plan: AgentPlan = { roster: r, taskIndex: 0, task: null, phase: 'idle', timer: null };
      this.plans.set(r.agentId, plan);
      this.scheduler.emit(this.sem(plan, 'idle', { title: '', subtask: 'Waiting for work', progress: 0, tokens: 0, taskId: null }));
      const delay = r.department === 'Executive Office' ? 1000 : 2000 + i * 2500 + this.rng() * 800;
      this.planAfter(plan, delay, () => this.startTask(plan));
    });
    this.scheduleSpecials();
    ctx.log(`mock source started: ${ROSTER.length} agents, ${LOOP_SECONDS}s special-events loop`);
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const p of this.plans.values()) if (p.timer) clearTimeout(p.timer);
    this.scheduler?.cancelAll();
  }

  // ---- per-agent loops -------------------------------------------------

  private planAfter(plan: AgentPlan, ms: number, fn: () => void): void {
    if (plan.timer) clearTimeout(plan.timer);
    plan.timer = setTimeout(() => {
      plan.timer = null;
      if (this.running) fn();
    }, ms);
  }

  private pickTask(plan: AgentPlan): ActiveTask {
    const templates = TASKS_BY_DEPARTMENT[plan.roster.department] ?? TASKS_BY_DEPARTMENT['Engineering Bay'];
    const t = templates[plan.taskIndex % templates.length];
    return {
      taskId: `task-${++this.taskCounter}`,
      title: t.title,
      subtasks: t.subtasks,
      progress: 2 + Math.round(this.rng() * 4),
      tokens: 200 + Math.round(this.rng() * 700),
    };
  }

  private subtaskFor(task: ActiveTask): string {
    const idx = Math.min(task.subtasks.length - 1, Math.floor((task.progress / 100) * task.subtasks.length));
    return task.subtasks[idx];
  }

  private sem(
    plan: AgentPlan,
    state: SemanticEvent['state'],
    over: Partial<SemanticEvent> & { title: string; subtask: string; progress: number; tokens: number; taskId: string | null },
  ): SemanticEvent {
    return {
      agentId: plan.roster.agentId,
      agentRole: plan.roster.agentRole,
      department: plan.roster.department,
      state,
      ...over,
    };
  }

  private working(plan: AgentPlan, subtask?: string): SemanticEvent {
    const task = plan.task as ActiveTask;
    return this.sem(plan, 'working', {
      taskId: task.taskId,
      title: task.title,
      subtask: subtask ?? this.subtaskFor(task),
      progress: task.progress,
      tokens: task.tokens,
    });
  }

  private startTask(plan: AgentPlan): void {
    plan.task = this.pickTask(plan);
    plan.taskIndex++;
    plan.phase = 'working';
    const arrival = this.scheduler.emit(this.working(plan));
    this.planAfter(plan, Math.max(0, arrival - Date.now()) + 3500 + this.rng() * 1500, () => this.tick(plan));
  }

  private tick(plan: AgentPlan): void {
    const task = plan.task;
    if (!task || plan.phase !== 'working') return;
    const isOrchestrator = plan.roster.department === 'Executive Office';
    task.progress += isOrchestrator ? 4 + this.rng() * 5 : 9 + this.rng() * 10;
    task.tokens += 400 + Math.round(this.rng() * 1300);
    if (task.progress >= 100) {
      task.progress = 100;
      this.complete(plan);
      return;
    }
    this.scheduler.emit(this.working(plan));
    this.planAfter(plan, 4500 + this.rng() * 2500, () => this.tick(plan));
  }

  private complete(plan: AgentPlan): void {
    const task = plan.task as ActiveTask;
    this.ctx.storeOutput({
      taskId: task.taskId,
      agentId: plan.roster.agentId,
      title: task.title,
      department: plan.roster.department,
      format: 'markdown',
      content: this.outputMarkdown(plan, task),
      generatedAt: new Date().toISOString(),
    });
    if (plan.roster.department === 'Executive Office') {
      // The orchestrator never leaves its desk; it rolls straight into the next brief.
      this.scheduler.emit(this.working(plan, 'Publishing digest'));
      this.planAfter(plan, 6000, () => this.startTask(plan));
      return;
    }
    const delivers = plan.taskIndex % plan.roster.deliverEvery === 0;
    if (delivers) {
      plan.phase = 'delivering';
      const arrival = this.scheduler.emit(
        this.sem(plan, 'delivering', {
          taskId: task.taskId,
          title: task.title,
          subtask: `Carrying output to the ${plan.roster.deliverTo === 'manager' ? 'manager' : 'archive terminal'}`,
          progress: 100,
          tokens: task.tokens,
          deliverTo: plan.roster.deliverTo,
        }),
      );
      this.planAfter(plan, Math.max(0, arrival - Date.now()) + 5000, () => {
        plan.phase = 'idle';
        this.scheduler.emit(this.sem(plan, 'idle', { taskId: null, title: '', subtask: 'Delivered — waiting for work', progress: 0, tokens: task.tokens, idleWhere: 'here' }));
        this.planAfter(plan, 3000 + this.rng() * 3000, () => this.startTask(plan));
      });
      return;
    }
    plan.phase = 'idle';
    const takeBreak = plan.taskIndex % 4 === 3;
    const idle = this.sem(plan, 'idle', {
      taskId: null,
      title: '',
      subtask: takeBreak ? 'Taking a break' : 'Task complete — waiting for work',
      progress: 0,
      tokens: task.tokens,
      idleWhere: takeBreak ? 'lounge' : 'here',
    });
    const arrival = this.scheduler.emit(idle);
    this.planAfter(plan, Math.max(0, arrival - Date.now()) + (takeBreak ? 9000 : 4000) + this.rng() * 3000, () => this.startTask(plan));
  }

  private outputMarkdown(plan: AgentPlan, task: ActiveTask): string {
    const done = task.subtasks.map((s) => `- [x] ${s}`).join('\n');
    return [
      `# ${task.title}`,
      '',
      `Prepared by **${plan.roster.agentRole}** (\`${plan.roster.agentId}\`) · ${plan.roster.department}`,
      '',
      '## Work log',
      done,
      '',
      '## Result',
      `The task completed after ${task.tokens.toLocaleString()} tokens. This document is generated by the mock event source; a live adapter posts real output to \`POST /ingest/output\`.`,
      '',
      `Task id: \`${task.taskId}\``,
    ].join('\n');
  }

  // ---- specials: collaboration, error, unknown state, malformed frames --

  private at(seconds: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.running) fn();
    }, seconds * 1000);
    this.timers.add(t);
  }

  private scheduleSpecials(): void {
    const loop = ++this.loop;
    if (this.opts.includeMalformed !== false) {
      this.at(15, () => this.ctx.publishRaw(JSON.stringify({ eventId: `evt-bad-${loop}`, agentId: 'agent-ghost', currentState: 'OFFICE_WORKING' })));
      this.at(16, () => this.ctx.publishRaw('this frame is not JSON'));
    }
    this.at(45, () => this.collaborate(`collab-${loop}-auth-review`, ['agent-senior-dev', 'agent-researcher', 'agent-designer'], 40, [
      'Debating token rotation policy',
      'Comparing refresh-token lifetimes',
      'Agreeing on the migration order',
      'Assigning follow-ups',
    ]));
    this.at(70, () => this.error('agent-backend-2', 22, 'Unit tests failed: 3 assertions in jwt_parser_test'));
    if (this.opts.includeUnknownState !== false) {
      this.at(100, () => this.unknown('agent-video', 10, 'OFFICE_DANCING'));
    }
    this.at(125, () => this.collaborate(`collab-${loop}-release-gate`, ['agent-qa-lead', 'agent-security'], 30, [
      'Reviewing open blockers',
      'Confirming rollback plan',
      'Signing off',
    ]));
    this.at(LOOP_SECONDS, () => this.scheduleSpecials());
  }

  private pause(agentId: string): AgentPlan | null {
    const plan = this.plans.get(agentId);
    if (!plan) return null;
    if (plan.timer) clearTimeout(plan.timer);
    plan.timer = null;
    if (!plan.task) plan.task = this.pickTask(plan);
    plan.phase = 'special';
    return plan;
  }

  private resume(plan: AgentPlan): void {
    plan.phase = 'working';
    const task = plan.task as ActiveTask;
    task.progress = Math.min(97, task.progress);
    const arrival = this.scheduler.emit(this.working(plan));
    this.planAfter(plan, Math.max(0, arrival - Date.now()) + 3500, () => this.tick(plan));
  }

  private collaborate(groupId: string, agentIds: string[], seconds: number, subtasks: string[]): void {
    const plans = agentIds.map((id) => this.pause(id)).filter((p): p is AgentPlan => p !== null);
    const send = (subtask: string) => {
      for (const plan of plans) {
        const task = plan.task as ActiveTask;
        task.tokens += 300 + Math.round(this.rng() * 500);
        this.scheduler.emit(
          this.sem(plan, 'collaborating', {
            taskId: task.taskId,
            title: task.title,
            subtask,
            progress: task.progress,
            tokens: task.tokens,
            groupId,
          }),
        );
      }
    };
    send(subtasks[0]);
    subtasks.slice(1).forEach((s, i) => this.at(((i + 1) * seconds) / subtasks.length, () => send(s)));
    this.at(seconds, () => {
      for (const plan of plans) this.resume(plan);
    });
  }

  private error(agentId: string, seconds: number, message: string): void {
    const plan = this.pause(agentId);
    if (!plan) return;
    const task = plan.task as ActiveTask;
    this.scheduler.emit(this.sem(plan, 'error', { taskId: task.taskId, title: task.title, subtask: message, progress: task.progress, tokens: task.tokens }));
    this.at(seconds, () => this.resume(plan));
  }

  private unknown(agentId: string, seconds: number, stateName: string): void {
    const plan = this.pause(agentId);
    if (!plan) return;
    const task = plan.task as ActiveTask;
    this.scheduler.emit(
      this.sem(plan, 'unknown', { unknownStateName: stateName, taskId: task.taskId, title: task.title, subtask: 'State not in the contract', progress: task.progress, tokens: task.tokens }),
    );
    this.at(seconds, () => this.resume(plan));
  }
}
