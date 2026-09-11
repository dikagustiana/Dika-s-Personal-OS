/**
 * The production wiring of the stepper's ports.
 *
 * runner.ts talks to ports so its tests can drive whole briefs with fakes.
 * This is the other implementation: the real repository, the real tool
 * layer, the real executor, and a per-call cost figure MEASURED from run
 * history rather than guessed.
 *
 * The measurement matters. B-10 asks for a cost estimate before the run; an
 * estimate built on an invented per-call figure is a number that looks
 * measured and is not — the same failure the floor's progress bar avoids by
 * labelling itself an estimate. So `callEstimate` reads the agent's own
 * runs, and says `measured: false` when there are none.
 */
import { runLabAgent } from '../../data/labModel';
import { institutionTools } from '../../data/institutionTools';
import type { Repository } from '../../data/repository';
import { rowsOf } from '../../data/readResult';
import type { CallEstimate } from '../../../supabase/functions/_shared/institution/weight';
import type { AgentRunOutcome, RunnerAgent, RunnerPorts, ToolOutcome, ToolRef } from './runner';

/** The fallback per-call figure, used only when there is no run history. */
export const FALLBACK_TOKENS_PER_CALL = 4_000;
export const FALLBACK_COST_PER_MTOK_USD = 3;

const asToolOutcome = (tool: string, result: { ok: boolean; data?: unknown; code?: string; error?: string }): ToolOutcome =>
  result.ok
    ? { ok: true, tool, data: (result.data ?? {}) as Record<string, unknown> }
    : { ok: false, tool, code: result.code ?? 'fetch_failed', error: result.error ?? 'the tool refused' };

export function createInstitutionPorts(repository: Repository): RunnerPorts {
  return {
    repo: repository.institution,

    tools: {
      async search(context: ToolRef, query: string, limit?: number) {
        return asToolOutcome('web_search', await institutionTools.search(context, query, limit));
      },
      async fetch(context: ToolRef, url: string, query?: string) {
        return asToolOutcome('web_fetch', await institutionTools.fetch(context, url, query));
      },
      async publicData(context: ToolRef, url: string, query?: string) {
        return asToolOutcome('public_data', await institutionTools.publicData(context, url, query));
      },
      async execute(context: ToolRef, input) {
        return asToolOutcome('execute', await institutionTools.execute(context, input));
      },
      async synthesize(context: ToolRef, input) {
        return asToolOutcome('synthesize', await institutionTools.synthesize(context, input));
      },
    },

    /**
     * One agent call.
     *
     * The executor streams; `runLabAgent` returns the accounting and writes
     * the authoritative row, and the TEXT arrives through onDelta. So the
     * text is accumulated here rather than read back from the run row: a
     * second read would race the row's own write, and the stream is what
     * the screen is already showing.
     */
    async runAgent({ agentSlug, input }): Promise<AgentRunOutcome> {
      let text = '';
      const result = await runLabAgent({
        agentSlug,
        input,
        onDelta: (delta) => {
          text += delta;
        },
      });
      if (!result.ran) {
        return {
          ok: false,
          output: '',
          runId: result.runId ?? null,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          refusal: result.reason,
        };
      }
      return {
        ok: true,
        output: text,
        runId: result.runId,
        tokensIn: result.tokensIn ?? 0,
        tokensOut: result.tokensOut ?? 0,
        costUsd: result.costUsd ?? 0,
      };
    },

    async listAgents(): Promise<RunnerAgent[]> {
      const agents = rowsOf(await repository.lab.listAgents());
      return agents
        .filter((agent) => agent.isActive)
        .map((agent) => ({
          id: agent.id,
          slug: agent.slug,
          name: agent.name,
          description: agent.description,
          systemPrompt: agent.systemPrompt,
          dataClass: agent.dataClass,
          version: agent.version,
        }));
    },

    async authorAgent(input) {
      const created = await repository.institution.authorAgent(input);
      return {
        id: created.id,
        slug: created.slug,
        name: created.name,
        description: created.description,
        systemPrompt: created.systemPrompt,
        dataClass: created.dataClass,
        version: created.version,
      };
    },

    async callEstimate(): Promise<CallEstimate> {
      const runs = rowsOf(await repository.lab.listRuns());
      const priced = runs.filter(
        (run) => run.status === 'ok' && (run.tokensIn ?? 0) + (run.tokensOut ?? 0) > 0,
      );
      if (priced.length === 0) {
        return {
          tokensPerCall: FALLBACK_TOKENS_PER_CALL,
          measured: false,
          costPerMillionTokensUsd: FALLBACK_COST_PER_MTOK_USD,
        };
      }
      const tokens = priced.map((run) => (run.tokensIn ?? 0) + (run.tokensOut ?? 0)).sort((a, b) => a - b);
      const median = tokens[Math.floor(tokens.length / 2)];
      const totalTokens = priced.reduce((sum, run) => sum + (run.tokensIn ?? 0) + (run.tokensOut ?? 0), 0);
      const totalCost = priced.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
      const perMillion = totalTokens > 0 ? (totalCost / totalTokens) * 1_000_000 : FALLBACK_COST_PER_MTOK_USD;
      return {
        tokensPerCall: median,
        measured: true,
        costPerMillionTokensUsd: perMillion > 0 ? perMillion : FALLBACK_COST_PER_MTOK_USD,
      };
    },

    now: () => new Date(),
  };
}
