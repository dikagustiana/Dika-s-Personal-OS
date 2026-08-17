/**
 * The Lab subsystem's data seam.
 *
 * Deliberately a separate interface hanging off Repository rather than
 * fifteen more methods on it — the same shape as researchRepository, for the
 * same reason: Lab is one bounded subsystem and the main seam stays readable.
 *
 * TWO INVARIANTS LIVE HERE, NOT IN THE UI:
 *
 *  1. RUNS AND ARTIFACTS ARE READ-ONLY FROM THE CLIENT. There is no
 *     createRun, updateRun or deleteRun — not unimplemented, ABSENT. The
 *     run-lab-agent Edge Function is the only writer (service role), and the
 *     RLS on os_lab_runs/os_lab_artifacts refuses client writes anyway. A
 *     run log the client can edit is not a log; see labModel.ts for the
 *     execution seam.
 *
 *  2. AGENT WRITES PASS THE BOUNDARY GUARD. createAgent/updateAgent take the
 *     provider list and run guardAgentWrite before anything leaves the
 *     browser — the fast failure in front of the database trigger that is
 *     the actual boundary. See labGuards.ts.
 *
 * Every read is a ReadResult: the lab migrations land before this ships, but
 * a fresh environment replays in order, and "the table is not there yet"
 * must never render as "no agents" — that distinction is this project's most
 * repeated defect (see readResult.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardAgentWrite } from './labGuards';
import { okRows, readAbsence, type ReadResult } from './readResult';
import type {
  LabAgent,
  LabAgentWrite,
  LabArtifact,
  LabChain,
  LabChainStep,
  LabProvider,
  LabRun,
} from './labTypes';

export interface LabChainWrite {
  name: string;
  description: string;
  steps: LabChainStep[];
  isActive?: boolean;
}

export interface LabRepository {
  listProviders(): Promise<ReadResult<LabProvider>>;
  listAgents(): Promise<ReadResult<LabAgent>>;
  createAgent(input: LabAgentWrite, providers: readonly LabProvider[]): Promise<LabAgent>;
  updateAgent(
    id: string,
    input: LabAgentWrite,
    providers: readonly LabProvider[],
  ): Promise<LabAgent>;
  listChains(): Promise<ReadResult<LabChain>>;
  createChain(input: LabChainWrite): Promise<LabChain>;
  updateChain(id: string, input: LabChainWrite): Promise<LabChain>;
  /** Newest first, capped — the log renders a page, not a warehouse. */
  listRuns(limit?: number): Promise<ReadResult<LabRun>>;
  listArtifacts(): Promise<ReadResult<LabArtifact>>;
}

// ---------------------------------------------------------------------------
// Row mapping — snake_case columns to the camelCase domain types, by hand,
// like every other repository in this codebase.
// ---------------------------------------------------------------------------

interface ProviderRow {
  id: string;
  name: LabProvider['name'];
  adapter: LabProvider['adapter'];
  base_url: string;
  model: string;
  cost_in_per_mtok: number | string;
  cost_out_per_mtok: number | string;
  is_active: boolean;
}

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  system_prompt: string;
  data_class: LabAgent['dataClass'];
  default_provider_id: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ChainRow {
  id: string;
  name: string;
  description: string;
  steps: unknown;
  is_active: boolean;
}

interface RunRow {
  id: string;
  agent_id: string;
  provider_id: string;
  parent_run_id: string | null;
  chain_id: string | null;
  step_index: number | null;
  input: string;
  output: string;
  status: LabRun['status'];
  error: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | string | null;
  duration_ms: number | null;
  created_at: string;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  filename: string;
  mime: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
}

function mapProvider(row: ProviderRow): LabProvider {
  return {
    id: row.id,
    name: row.name,
    adapter: row.adapter,
    baseUrl: row.base_url,
    model: row.model,
    // numeric can arrive as a JSON string depending on the PostgREST
    // serializer; Number() makes the type honest either way.
    costInPerMtok: Number(row.cost_in_per_mtok),
    costOutPerMtok: Number(row.cost_out_per_mtok),
    isActive: row.is_active,
  };
}

function mapAgent(row: AgentRow): LabAgent {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    dataClass: row.data_class,
    defaultProviderId: row.default_provider_id,
    version: row.version,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Steps arrive as whatever jsonb holds. Malformed entries are DROPPED WITH A
 * SHAPE CHECK rather than trusted: a chain edited by hand in the table
 * editor must degrade to fewer steps, never to a crash in the builder.
 */
export function chainSteps(raw: unknown): LabChainStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (step): step is LabChainStep =>
      typeof (step as { agentSlug?: unknown })?.agentSlug === 'string' &&
      typeof (step as { inputTemplate?: unknown })?.inputTemplate === 'string',
  );
}

function mapChain(row: ChainRow): LabChain {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: chainSteps(row.steps),
    isActive: row.is_active,
  };
}

function mapRun(row: RunRow): LabRun {
  return {
    id: row.id,
    agentId: row.agent_id,
    providerId: row.provider_id,
    parentRunId: row.parent_run_id,
    chainId: row.chain_id,
    stepIndex: row.step_index,
    input: row.input,
    output: row.output,
    status: row.status,
    error: row.error,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

function mapArtifact(row: ArtifactRow): LabArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    filename: row.filename,
    mime: row.mime,
    storagePath: row.storage_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function agentPayload(input: LabAgentWrite): Record<string, unknown> {
  return {
    slug: input.slug,
    name: input.name,
    description: input.description,
    system_prompt: input.systemPrompt,
    data_class: input.dataClass,
    default_provider_id: input.defaultProviderId,
    ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
  };
}

function chainPayload(input: LabChainWrite): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description,
    steps: input.steps,
    ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
  };
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

export function createSupabaseLabRepository(client: SupabaseClient): LabRepository {
  return {
    async listProviders() {
      const { data, error } = await client
        .from('os_lab_providers')
        .select('*')
        .order('name');
      if (error) return readAbsence('listLabProviders', error);
      return okRows(((data ?? []) as ProviderRow[]).map(mapProvider));
    },

    async listAgents() {
      const { data, error } = await client
        .from('os_lab_agents')
        .select('*')
        .order('slug');
      if (error) return readAbsence('listLabAgents', error);
      return okRows(((data ?? []) as AgentRow[]).map(mapAgent));
    },

    async createAgent(input, providers) {
      const guarded = guardAgentWrite(input, providers);
      const { data, error } = await client
        .from('os_lab_agents')
        .insert(agentPayload(guarded))
        .select()
        .single();
      if (error) throw new Error(`createAgent: ${error.message}`);
      return mapAgent(data as AgentRow);
    },

    async updateAgent(id, input, providers) {
      const guarded = guardAgentWrite(input, providers);
      const { data, error } = await client
        .from('os_lab_agents')
        .update(agentPayload(guarded))
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(`updateAgent: ${error.message}`);
      return mapAgent(data as AgentRow);
    },

    async listChains() {
      const { data, error } = await client
        .from('os_lab_chains')
        .select('*')
        .order('name');
      if (error) return readAbsence('listLabChains', error);
      return okRows(((data ?? []) as ChainRow[]).map(mapChain));
    },

    async createChain(input) {
      const { data, error } = await client
        .from('os_lab_chains')
        .insert(chainPayload(input))
        .select()
        .single();
      if (error) throw new Error(`createChain: ${error.message}`);
      return mapChain(data as ChainRow);
    },

    async updateChain(id, input) {
      const { data, error } = await client
        .from('os_lab_chains')
        .update(chainPayload(input))
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(`updateChain: ${error.message}`);
      return mapChain(data as ChainRow);
    },

    async listRuns(limit = 500) {
      const { data, error } = await client
        .from('os_lab_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return readAbsence('listLabRuns', error);
      return okRows(((data ?? []) as RunRow[]).map(mapRun));
    },

    async listArtifacts() {
      const { data, error } = await client
        .from('os_lab_artifacts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return readAbsence('listLabArtifacts', error);
      return okRows(((data ?? []) as ArtifactRow[]).map(mapArtifact));
    },
  };
}

// ---------------------------------------------------------------------------
// Mock implementation — a bare clone renders Lab with the same registry the
// live seed creates, phantom dependencies included: the four known phantoms
// are ground truth for the checker, so the mock must reproduce them or the
// mock would be testing a different feature.
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS: LabProvider[] = [
  {
    id: 'lab-provider-anthropic',
    name: 'anthropic',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    costInPerMtok: 3,
    costOutPerMtok: 15,
    isActive: true,
  },
  {
    id: 'lab-provider-deepseek',
    name: 'deepseek',
    adapter: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    costInPerMtok: 0.27,
    costOutPerMtok: 1.1,
    isActive: true,
  },
  {
    id: 'lab-provider-kimi',
    name: 'kimi',
    adapter: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2-0905-preview',
    costInPerMtok: 0.6,
    costOutPerMtok: 2.5,
    isActive: true,
  },
];

function mockAgent(
  partial: Pick<LabAgent, 'id' | 'slug' | 'name' | 'description' | 'dataClass'> & {
    systemPrompt?: string;
    defaultProviderId?: string | null;
  },
): LabAgent {
  const now = new Date().toISOString();
  return {
    systemPrompt: partial.systemPrompt ?? `You are ${partial.name} for SAMB Group.`,
    defaultProviderId:
      partial.defaultProviderId ??
      (partial.dataClass === 'internal' ? 'lab-provider-anthropic' : 'lab-provider-kimi'),
    version: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

const MOCK_AGENTS: LabAgent[] = [
  mockAgent({
    id: 'lab-agent-sfa',
    slug: 'senior-finance-analyst',
    name: 'Senior Finance Analyst',
    dataClass: 'internal',
    description:
      'Turn already-verified figures into analytical judgment for SAMB Group. Do NOT use it to build models (financial-modeling), re-check arithmetic (verify-financial-model), consolidate (consolidation-reporting), or package slides (deck-narrative-drafter).',
  }),
  mockAgent({
    id: 'lab-agent-bpi',
    slug: 'business-process-improvement',
    name: 'Business Process Improvement',
    dataClass: 'internal',
    description:
      'Map an as-is process and its control gaps. Finance judgment belongs to (senior-finance-analyst); models to (financial-modeling); the TB to (consolidation-reporting); decks to (deck-narrative-drafter).',
  }),
  mockAgent({
    id: 'lab-agent-pmo',
    slug: 'pmo-coordinator',
    name: 'PMO Coordinator',
    dataClass: 'internal',
    description:
      'Track the transformation. Judgment is (senior-finance-analyst), process design is (business-process-improvement), models are (financial-modeling), close mechanics are (consolidation-reporting).',
  }),
  mockAgent({
    id: 'lab-agent-deck',
    slug: 'ceo-briefing-deck',
    name: 'CEO Briefing Deck',
    dataClass: 'public',
    description:
      'Deck structure from public MBB patterns. The house template and real figures belong to (deck-narrative-drafter).',
  }),
];

const MOCK_CHAINS: LabChain[] = [
  {
    id: 'lab-chain-proses',
    name: 'Proses ke keputusan',
    description:
      'Map a process and its control gaps, then turn the findings into a finance judgment.',
    steps: [
      {
        agentSlug: 'business-process-improvement',
        inputTemplate: 'Map the as-is process and control gaps for:\n\n{{initial_input}}',
      },
      {
        agentSlug: 'senior-finance-analyst',
        inputTemplate:
          'The original request was:\n\n{{initial_input}}\n\nFindings:\n\n{{previous_output}}',
      },
    ],
    isActive: true,
  },
];

function mockRuns(): LabRun[] {
  const base = {
    parentRunId: null,
    chainId: null,
    stepIndex: null,
    error: null,
  };
  const today = new Date();
  const at = (hoursAgo: number) =>
    new Date(today.getTime() - hoursAgo * 3_600_000).toISOString();
  const first: LabRun = {
    ...base,
    id: 'lab-run-1',
    agentId: 'lab-agent-bpi',
    providerId: 'lab-provider-anthropic',
    chainId: 'lab-chain-proses',
    stepIndex: 0,
    input: 'Proses intake cold storage KDU',
    output: 'AS-IS: 9 langkah, 2 handoff tanpa bukti serah terima…',
    status: 'ok',
    tokensIn: 1840,
    tokensOut: 920,
    costUsd: 0.01932,
    durationMs: 14200,
    createdAt: at(30),
  };
  const second: LabRun = {
    ...base,
    id: 'lab-run-2',
    agentId: 'lab-agent-sfa',
    providerId: 'lab-provider-anthropic',
    chainId: 'lab-chain-proses',
    stepIndex: 1,
    parentRunId: 'lab-run-1',
    input: 'The original request was: Proses intake cold storage KDU…',
    output: 'Judgment: gap serah terima berisiko selisih stok material…',
    status: 'ok',
    tokensIn: 2950,
    tokensOut: 1240,
    costUsd: 0.02745,
    durationMs: 18900,
    createdAt: at(29),
  };
  const third: LabRun = {
    ...base,
    id: 'lab-run-3',
    agentId: 'lab-agent-deck',
    providerId: 'lab-provider-kimi',
    input: 'Struktur deck review bulanan grup',
    output: '',
    status: 'error',
    error: 'Model call failed (429).',
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    durationMs: 3100,
    createdAt: at(4),
  };
  return [third, second, first];
}

export class MockLabRepository implements LabRepository {
  private providers = MOCK_PROVIDERS.map((provider) => ({ ...provider }));
  private agents = MOCK_AGENTS.map((agent) => ({ ...agent }));
  private chains = MOCK_CHAINS.map((chain) => ({ ...chain, steps: [...chain.steps] }));
  private runs = mockRuns();

  async listProviders(): Promise<ReadResult<LabProvider>> {
    return okRows(this.providers.map((provider) => ({ ...provider })));
  }

  async listAgents(): Promise<ReadResult<LabAgent>> {
    return okRows(this.agents.map((agent) => ({ ...agent })));
  }

  async createAgent(input: LabAgentWrite, providers: readonly LabProvider[]): Promise<LabAgent> {
    const guarded = guardAgentWrite(input, providers);
    if (this.agents.some((agent) => agent.slug === guarded.slug)) {
      throw new Error(`createAgent: slug ${guarded.slug} already exists`);
    }
    const now = new Date().toISOString();
    const agent: LabAgent = {
      id: `lab-agent-${this.agents.length + 1}-${guarded.slug}`,
      slug: guarded.slug,
      name: guarded.name,
      description: guarded.description,
      systemPrompt: guarded.systemPrompt,
      dataClass: guarded.dataClass,
      defaultProviderId: guarded.defaultProviderId,
      version: 1,
      isActive: guarded.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.agents.push(agent);
    return { ...agent };
  }

  async updateAgent(
    id: string,
    input: LabAgentWrite,
    providers: readonly LabProvider[],
  ): Promise<LabAgent> {
    const guarded = guardAgentWrite(input, providers);
    const existing = this.agents.find((agent) => agent.id === id);
    if (!existing) throw new Error(`updateAgent: no agent ${id}`);
    // Mirror the database guard: a system_prompt edit is a new version.
    if (existing.systemPrompt !== guarded.systemPrompt) existing.version += 1;
    existing.slug = guarded.slug;
    existing.name = guarded.name;
    existing.description = guarded.description;
    existing.systemPrompt = guarded.systemPrompt;
    existing.dataClass = guarded.dataClass;
    existing.defaultProviderId = guarded.defaultProviderId;
    if (guarded.isActive !== undefined) existing.isActive = guarded.isActive;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
  }

  async listChains(): Promise<ReadResult<LabChain>> {
    return okRows(this.chains.map((chain) => ({ ...chain, steps: [...chain.steps] })));
  }

  async createChain(input: LabChainWrite): Promise<LabChain> {
    const chain: LabChain = {
      id: `lab-chain-${this.chains.length + 1}`,
      name: input.name,
      description: input.description,
      steps: [...input.steps],
      isActive: input.isActive ?? true,
    };
    this.chains.push(chain);
    return { ...chain, steps: [...chain.steps] };
  }

  async updateChain(id: string, input: LabChainWrite): Promise<LabChain> {
    const existing = this.chains.find((chain) => chain.id === id);
    if (!existing) throw new Error(`updateChain: no chain ${id}`);
    existing.name = input.name;
    existing.description = input.description;
    existing.steps = [...input.steps];
    if (input.isActive !== undefined) existing.isActive = input.isActive;
    return { ...existing, steps: [...existing.steps] };
  }

  async listRuns(limit = 500): Promise<ReadResult<LabRun>> {
    return okRows(this.runs.slice(0, limit).map((run) => ({ ...run })));
  }

  async listArtifacts(): Promise<ReadResult<LabArtifact>> {
    return okRows([]);
  }
}
