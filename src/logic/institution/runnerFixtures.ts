/**
 * Fakes for driving the institution with no network and no provider.
 *
 * Shared by runner.test.ts and institution.integration.test.ts. The model is
 * SCRIPTED, not simulated: each reply is chosen by what the prompt asks for,
 * so a test says "the lead returns this assignment" by scripting exactly
 * that, and the assertion is about what the institution then does.
 *
 * The fakes never produce a reply the parser would have to guess at, except
 * where a test deliberately scripts an unreadable one — that case is the
 * point of the fail-closed rules.
 */
import { MockInstitutionRepository } from '../../data/institutionMock';
import type { RunnerAgent, RunnerPorts, ToolOutcome, ToolRef } from './runner';
import type { CallEstimate } from '../../../supabase/functions/_shared/institution/weight';

export interface ScriptedCall {
  agentSlug: string;
  prompt: string;
}

export type Script = (call: ScriptedCall) => string | { refusal: string };

export const fence = (value: unknown): string => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

export const AGENTS: RunnerAgent[] = [
  { id: 'a-coordinator', slug: 'evidence-coordinator', name: 'Coordinator', description: 'delegation', systemPrompt: 'You decompose a research request into delegated tasks.', dataClass: 'internal', version: 1 },
  // Internal-lane: the director promoted this lead, so the fixture can run
  // an internal brief. A PUBLIC lead facing an internal brief is refused by
  // the department contract — the D-03 consequence, tested in department.test.ts.
  { id: 'a-framing-lead', slug: 'framing-lead', name: 'Framing Lead', description: 'owns the question', systemPrompt: 'You own the question.', dataClass: 'internal', version: 1 },
  { id: 'a-scope', slug: 'scope-analyst', name: 'Scope Analyst', description: 'draws the scope boundary', systemPrompt: 'You draw the scope boundary.', dataClass: 'public', version: 1 },
  { id: 'a-framer', slug: 'evidence-framer', name: 'Framer', description: 'critiques the framing', systemPrompt: 'You critique the framing.', dataClass: 'internal', version: 1 },
  { id: 'a-verification-lead', slug: 'verification-lead', name: 'Verification Lead', description: 'owns whether it holds', systemPrompt: 'You own whether it holds.', dataClass: 'public', version: 1 },
  { id: 'a-numeric', slug: 'numeric-auditor', name: 'Numeric Auditor', description: 're-derives figures', systemPrompt: 'You audit numbers.', dataClass: 'public', version: 1 },
  { id: 'a-provenance', slug: 'provenance-checker', name: 'Provenance Checker', description: 'every claim resolves', systemPrompt: 'You check provenance.', dataClass: 'public', version: 1 },
  { id: 'a-committee', slug: 'editorial-committee', name: 'Editorial Committee', description: 'the board', systemPrompt: 'You are the editorial board.', dataClass: 'public', version: 1 },
];

export interface Harness {
  ports: RunnerPorts;
  repo: MockInstitutionRepository;
  calls: ScriptedCall[];
  toolCalls: Array<{ tool: string; ref: ToolRef; args: unknown }>;
  authored: Array<{ slug: string; dataClass: string; authoredByAgentId: string }>;
  agents: RunnerAgent[];
}

export interface HarnessOptions {
  script: Script;
  /** Tool results, keyed by tool name; default is a successful archive. */
  toolResult?: (tool: string, args: unknown) => ToolOutcome;
  costPerCall?: number;
  measured?: boolean;
}

export function makeHarness(options: HarnessOptions): Harness {
  const repo = new MockInstitutionRepository();
  const calls: ScriptedCall[] = [];
  const toolCalls: Array<{ tool: string; ref: ToolRef; args: unknown }> = [];
  const authored: Array<{ slug: string; dataClass: string; authoredByAgentId: string }> = [];
  const agents = AGENTS.map((agent) => ({ ...agent }));
  let corpusCounter = 0;

  const tool = (name: string) => async (ref: ToolRef, ...args: unknown[]): Promise<ToolOutcome> => {
    toolCalls.push({ tool: name, ref, args });
    if (options.toolResult) return options.toolResult(name, args);
    corpusCounter += 1;
    const corpusId = `00000000-0000-4000-8000-${String(corpusCounter).padStart(12, '0')}`;
    repo.corpus.push({
      id: corpusId,
      kind: name === 'execute' ? 'execution' : name === 'synthesize' ? 'output' : 'retrieval',
      title: `${name} result ${corpusCounter}`,
      dataClass: 'public',
      content: `archived content ${corpusCounter}`,
      contentHash: 'f'.repeat(64),
      url: name === 'search' ? 'https://example.test/search' : null,
      httpStatus: 200,
      fetchedAt: new Date('2026-09-11T00:00:00Z').toISOString(),
      query: null,
      provenance: { tool: name },
      derivedFrom: [],
      briefId: ref.briefId ?? null,
      assignmentId: ref.assignmentId ?? null,
      createdByAgentId: agents.find((agent) => agent.slug === ref.agentSlug)?.id ?? null,
      createdByRunId: null,
      reviewStatus: 'unreviewed',
      createdAt: new Date('2026-09-11T00:00:00Z').toISOString(),
    });
    return { ok: true, tool: name, data: { corpusId, citation: `[corpus:${corpusId}]` } };
  };

  const ports: RunnerPorts = {
    repo,
    tools: {
      search: tool('search'),
      fetch: tool('fetch'),
      publicData: tool('publicData'),
      execute: tool('execute'),
      synthesize: tool('synthesize'),
    },
    async runAgent({ agentSlug, input }) {
      calls.push({ agentSlug, prompt: input });
      const reply = options.script({ agentSlug, prompt: input });
      const cost = options.costPerCall ?? 0.01;
      if (typeof reply === 'object') {
        return { ok: false, output: '', runId: null, tokensIn: 0, tokensOut: 0, costUsd: 0, refusal: reply.refusal };
      }
      return { ok: true, output: reply, runId: `run-${calls.length}`, tokensIn: 1_000, tokensOut: 500, costUsd: cost };
    },
    async listAgents() {
      return agents.map((agent) => ({ ...agent }));
    },
    async authorAgent(input) {
      const agent: RunnerAgent = {
        id: `a-${input.slug}`,
        slug: input.slug,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        // B-3: an authored agent is public. The fake does not get to choose.
        dataClass: 'public',
        version: 1,
      };
      agents.push(agent);
      authored.push({ slug: input.slug, dataClass: agent.dataClass, authoredByAgentId: input.authoredByAgentId });
      repo.seats.push({
        id: `seat-${input.slug}`,
        departmentId: input.departmentId,
        agentSlug: input.slug,
        role: 'specialist',
        seatPurpose: input.seatPurpose,
        position: 9,
      });
      return agent;
    },
    async callEstimate(): Promise<CallEstimate> {
      return { tokensPerCall: 4_000, measured: options.measured ?? true, costPerMillionTokensUsd: 3 };
    },
    now: () => new Date('2026-09-11T12:00:00Z'),
  };

  return { ports, repo, calls, toolCalls, authored, agents };
}

// --- reply builders ---------------------------------------------------------

export const programIntake = (over: Partial<{
  restated: string; answerWouldBe: string; outOfScope: string; assumptions: string[];
  weightClass: string; classReason: string; dataClass: string; routing: string[];
}> = {}): string => fence({
  restated: 'How has Indonesian poultry processing capacity changed since 2019?',
  answerWouldBe: 'a capacity series with its source and its definition',
  outOfScope: 'anything before 2019',
  assumptions: ['the published capacity definition is stable'],
  weightClass: 'brief',
  classReason: 'a single lookup-shaped question',
  dataClass: 'public',
  routing: ['framing-office'],
  ...over,
});

export const leadAccepts = (assignTo: string[], instructions: Record<string, string> = {}, authorNeeded: string[] = []): string =>
  fence({ accept: true, reason: 'the question is answerable as written', assignTo, authorNeeded, instructions });

export const leadRefuses = (reason: string): string =>
  fence({ accept: false, reason, assignTo: [], authorNeeded: [], instructions: {} });

export const specialistWork = (produced: string, over: Partial<{ restsOn: string[]; uncertain: string; didNotDo: string; needs: unknown[] }> = {}): string =>
  `Here is the work.\n\n${fence({ produced, restsOn: [], uncertain: 'nothing material', didNotDo: 'no pricing work', needs: [], ...over })}`;

export const review = (verdict: string, summary = 'looks sound', findings: unknown[] = [], proposals: unknown[] = []): string =>
  fence({ verdict, summary, findings, proposals });

export const submission = (over: Partial<{ produced: string; restsOn: string[]; uncertainties: string; exclusions: string }> = {}): string =>
  fence({
    produced: 'A capacity series for 2019 to 2024 with the definition it uses and the source it came from.',
    restsOn: ['00000000-0000-4000-8000-000000000001'],
    uncertainties: 'The 2021 figure is a revision and may move again.',
    exclusions: 'Did not convert to slaughter-equivalent volume.',
    ...over,
  });

export const authoring = (slug: string): string => fence({
  slug,
  name: 'Authored Specialist',
  description: 'a capability the department lacked',
  systemPrompt: `You are a specialist authored by a department lead. ${'You do the work named in your seat purpose and nothing else. '.repeat(6)}`,
  purpose: 'the department had no seat for this',
});
