import { describe, expect, it } from 'vitest';
import { buildCampus } from '../layout/campus';
import { parseCanonicalEvent } from '../events/schema';
import { Positioner } from '../scenario/positioner';
import { ADAPTERS } from './index';
import { inferDepartment } from './types';

describe('adapters normalise into semantic events that the positioner turns into valid wire events', () => {
  const p = new Positioner(buildCampus());

  it('langgraph: node start → working; graph end → delivering; tool error → error; collab tag → collaborating', () => {
    const a = ADAPTERS.langgraph;
    const start = a.normalize({
      event: 'on_chain_start',
      name: 'reviewer',
      run_id: 'run-1',
      metadata: { langgraph_node: 'reviewer', thread_id: 'thread-9', agent_role: 'Code Reviewer', progress: 12 },
      data: {},
    });
    expect(start).toHaveLength(1);
    // "Code Reviewer" lands in the program office, not in Verification:
    // peer review happens inside every department here, so the word
    // "review" says nothing about which one an outsider belongs to.
    expect(start[0]).toMatchObject({ agentId: 'reviewer', state: 'working', taskId: 'thread-9', department: 'program-office', progress: 12 });
    const end = a.normalize({ event: 'on_chain_end', name: 'my_graph', run_id: 'run-1', metadata: { graph_name: 'my_graph', agent_id: 'reviewer' }, data: { output: {} } });
    expect(end[0].state).toBe('delivering');
    const err = a.normalize({ event: 'on_tool_error', name: 'search', run_id: 'r', metadata: { langgraph_node: 'researcher' }, data: { error: 'timeout' } });
    expect(err[0]).toMatchObject({ state: 'error', subtask: 'timeout', department: 'evidence-acquisition' });
    const collab = a.normalize({ event: 'on_chain_start', name: 'debate', run_id: 'r', metadata: { langgraph_node: 'critic' }, tags: ['collab:review-42'] });
    expect(collab[0]).toMatchObject({ state: 'collaborating', groupId: 'review-42' });
    expect(a.normalize({ event: 'on_chat_model_stream', name: 'x', metadata: { langgraph_node: 'n' }, data: { chunk: {} } })).toHaveLength(0);
    for (const ev of [...start, ...end, ...err, ...collab]) {
      for (const e of p.apply(ev, 0)) expect(parseCanonicalEvent(e.event).ok).toBe(true);
    }
  });

  it('crewai: task start → working; tool usage → subtask; completion → delivering; failure → error', () => {
    const a = ADAPTERS.crewai;
    const started = a.normalize({ type: 'task_started', agent: { id: 'crew-writer', role: 'Senior Writer' }, task: { id: 't-1', description: 'Write the launch post for the new feature' } });
    expect(started[0]).toMatchObject({ agentId: 'crew-writer', state: 'working', department: 'editorial', taskId: 't-1' });
    const tool = a.normalize({ type: 'tool_usage_started', agent: { role: 'Senior Writer' }, tool_name: 'web_search' });
    expect(tool[0].subtask).toBe('Using tool web_search');
    expect(tool[0].agentId).toBe('crew-senior-writer');
    const done = a.normalize({ type: 'task_completed', agent: { id: 'crew-writer', role: 'Senior Writer' }, task: { id: 't-1' }, usage: { total_tokens: 1234 } });
    expect(done[0]).toMatchObject({ state: 'delivering', progress: 100, tokens: 1234 });
    const failed = a.normalize({ type: 'task_failed', agent: { id: 'crew-writer', role: 'Senior Writer' }, error: 'Rate limited' });
    expect(failed[0]).toMatchObject({ state: 'error', subtask: 'Rate limited' });
    expect(a.normalize({ type: 'something_else', agent: { id: 'x' } })).toHaveLength(0);
    for (const ev of [...started, ...tool, ...done, ...failed]) {
      for (const e of p.apply(ev, 0)) expect(parseCanonicalEvent(e.event).ok).toBe(true);
    }
  });

  it('autogen: group chat text → collaborating with a shared group; tool call → working; stop → delivering', () => {
    const a = ADAPTERS.autogen;
    const msg = a.normalize({ type: 'TextMessage', source: 'planner', content: 'Let us split the work into three parts', models_usage: { prompt_tokens: 100, completion_tokens: 40 }, team_id: 'team-7' });
    expect(msg[0]).toMatchObject({ agentId: 'planner', state: 'collaborating', groupId: 'team-7', tokens: 140, department: 'framing-office' });
    const msg2 = a.normalize({ type: 'TextMessage', source: 'coder', content: 'On it', team_id: 'team-7' });
    expect(msg2[0].groupId).toBe('team-7');
    const tool = a.normalize({ type: 'ToolCallRequestEvent', source: 'coder', content: [{ name: 'run_tests', arguments: '{}' }] });
    expect(tool[0]).toMatchObject({ state: 'working', subtask: 'Calling run_tests' });
    const stop = a.normalize({ type: 'StopMessage', source: 'planner', content: 'TERMINATE', team_id: 'team-7' });
    expect(stop[0].state).toBe('delivering');
    expect(a.normalize({ type: 'TextMessage', source: 'user', content: 'hi' })).toHaveLength(0);
    for (const ev of [...msg, ...msg2, ...tool, ...stop]) {
      for (const e of p.apply(ev, 0)) expect(parseCanonicalEvent(e.event).ok).toBe(true);
    }
  });

  it('custom: passes the semantic shape through, arrays included, and forwards unknown states as unknown', () => {
    const a = ADAPTERS.custom;
    const out = a.normalize([
      { agentId: 'fn-1', role: 'Pipeline', state: 'working', taskId: 'j-1', title: 'Summarise', subtask: 'Chunking', progress: 30, tokens: 900 },
      { agentId: 'fn-1', state: 'DREAMING', taskId: 'j-1' },
      { agentId: 'fn-2', state: 'delivering', deliverTo: 'manager', progress: 100 },
      { state: 'working' },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ state: 'working', progress: 30, tokens: 900 });
    expect(out[1]).toMatchObject({ state: 'unknown', unknownStateName: 'DREAMING' });
    expect(out[2]).toMatchObject({ state: 'delivering', deliverTo: 'manager' });
    for (const ev of out) {
      for (const e of p.apply(ev, 0)) expect(parseCanonicalEvent(e.event).ok).toBe(true);
    }
    expect(a.normalize('garbage')).toHaveLength(0);
  });

  it('infers a department from a keyword and honours an explicit one', () => {
    expect(inferDepartment('Fact Checker')).toBe('verification');
    expect(inferDepartment('Copywriter')).toBe('editorial');
    expect(inferDepartment('Quant Modeller')).toBe('quantitative-analysis');
    expect(inferDepartment('ETL Engineer')).toBe('data-engineering');
    expect(inferDepartment('anything', 'domain-synthesis')).toBe('domain-synthesis');
  });

  it('puts an agent it cannot place in the program office, never in a plausible wrong bay', () => {
    // A foreign framework knows nothing about this institution. Guessing
    // "engineering" for an unmatched role would put a stranger at a real
    // department's desk and make the floor lie about who works where.
    expect(inferDepartment('Backend Dev')).toBe('program-office');
    expect(inferDepartment('')).toBe('program-office');
    expect(inferDepartment(undefined)).toBe('program-office');
    expect(inferDepartment('anything', 'Not A Department')).toBe('program-office');
  });
});
