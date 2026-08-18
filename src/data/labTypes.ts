/**
 * The Lab subsystem's domain types. camelCase, hand-written, mapped by hand
 * in labRepository — the same contract as src/data/types.ts ("maps 1:1"),
 * kept in a separate file because Lab is one bounded subsystem and types.ts
 * is already 1200 lines of two other worlds.
 */

/**
 * THE COLUMN THE ENTIRE BOUNDARY HANGS OFF. 'internal' means the agent
 * processes internal SAMB Group financial data and may only ever run on
 * Anthropic models — enforced by database trigger (layer 1), executor
 * re-validation (layer 2) and the disabled provider selector (layer 3).
 * There is deliberately no default anywhere: creating an agent states this
 * explicitly or does not create.
 */
export type LabDataClass = 'internal' | 'public';

export type LabProviderName = 'anthropic' | 'deepseek' | 'kimi';
export type LabAdapter = 'anthropic' | 'openai';

export interface LabProvider {
  id: string;
  name: LabProviderName;
  adapter: LabAdapter;
  baseUrl: string;
  model: string;
  /** USD per million tokens. The ONLY place prices live. */
  costInPerMtok: number;
  costOutPerMtok: number;
  isActive: boolean;
}

export interface LabAgent {
  id: string;
  slug: string;
  name: string;
  /** The trigger description — when this agent should fire. Parsed by the
   * dependency checker for (slug) and `slug` references, like system_prompt. */
  description: string;
  systemPrompt: string;
  dataClass: LabDataClass;
  defaultProviderId: string | null;
  /** Bumped by the database guard whenever systemPrompt changes. */
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What a create/edit form submits. version/updatedAt are server-owned. */
export interface LabAgentWrite {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  dataClass: LabDataClass;
  defaultProviderId: string | null;
  isActive?: boolean;
}

/**
 * One chain step as stored in os_lab_chains.steps (jsonb, camelCase keys,
 * read with the row). Steps name agents BY SLUG so a chain can be authored
 * before its agents exist; the dependency checker surfaces the gap.
 */
export interface LabChainStep {
  agentSlug: string;
  /** May interpolate {{previous_output}} and {{initial_input}}. */
  inputTemplate: string;
}

export interface LabChain {
  id: string;
  name: string;
  description: string;
  steps: LabChainStep[];
  isActive: boolean;
}

export type LabRunStatus = 'queued' | 'running' | 'ok' | 'error';

export interface LabRun {
  id: string;
  agentId: string;
  /** The provider ACTUALLY used, resolved at dispatch. */
  providerId: string;
  parentRunId: string | null;
  chainId: string | null;
  stepIndex: number | null;
  input: string;
  output: string;
  status: LabRunStatus;
  /** The RESOLVED model string at dispatch — drift is visible in the log. */
  model: string;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** USD, computed at run time from the provider row's rates. */
  costUsd: number | null;
  durationMs: number | null;
  /**
   * What this run's handler refused, line by line (083) — echo-check
   * rejections, tag/quote blocks, malformed-field skips. Written by the
   * executor at run completion; read-only here like the rest of the row.
   * Empty means nothing was refused. A refusal is the system working
   * correctly, and the Flow console renders these as quiet lines, not
   * errors.
   */
  refusals: string[];
  createdAt: string;
}

export interface LabArtifact {
  id: string;
  runId: string;
  filename: string;
  mime: string;
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
}
