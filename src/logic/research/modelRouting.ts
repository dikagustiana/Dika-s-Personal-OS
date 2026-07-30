/**
 * Which model runs which task.
 *
 * The mechanism already existed and nothing used it: personas.ts carries a
 * per-seat `model?` override, sendPrompt takes an optional `model`, and both
 * Edge Functions fall back to RESEARCH_MODEL_DEFAULT when neither is set. So one
 * global default was the only answer available to a question whose right answer
 * differs per task — a scoping sweep and a citation check do not need the same
 * accuracy, and eleven completions on the strongest model is a different
 * decision from one.
 *
 * THE TABLE IS DATA, THIS FILE IS ONLY RESOLUTION. Rows live in
 * os_model_routing and are edited in the Supabase table editor; nothing here
 * hardcodes a model name, and adding one would put the decision back in a
 * deploy. ROUTABLE_TASKS below is a display vocabulary, not a permission list:
 * it drives the "unrecognised row" warning and nothing else.
 *
 * TWO RULES, BOTH LOAD-BEARING:
 *
 *  1. ABSENCE MEANS THE DEFAULT, NEVER "DO NOT SEND". No row, a blank model, a
 *     whitespace model, a table that failed to load — all resolve to the
 *     function's own default. The opposite direction would silently disable a
 *     card the moment a new prompt kind was added, and a card that vanishes
 *     leaves nothing to trace.
 *
 *  2. ROUTING CANNOT REACH THE BROWSING GATE. Not by convention — structurally.
 *     canSend/sendBlockedReason (researchModel.ts) and councilAvailable/
 *     councilBlockedReason (researchCouncil.ts) do not take a routing table as
 *     an argument and cannot see one, and the Edge Function decides on the task
 *     before it reads any model name. Routing answers "which model", never
 *     "may this be sent at all".
 */

/**
 * Tasks the UI knows how to name. Every prompt kind, plus the three council
 * modes. NOT a whitelist: a task missing from here still routes, it is simply
 * reported as unrecognised so a typo reads as a mistake rather than as a
 * setting that quietly does nothing.
 */
export const ROUTABLE_TASKS = [
  'prBrief',
  'prBatch',
  'prAllBatch',
  'prData',
  'prCite',
  'prMethod',
  'prLit',
  'prContra',
  'prHand',
  'prDigest',
  'prScope',
  'method',
  'scope',
  'contra',
] as const;

export type RoutableTask = (typeof ROUTABLE_TASKS)[number];

/** Resolved rows: task → model, holding only rows that actually name a model. */
export type ModelRoutingTable = Readonly<Record<string, string>>;

export const NO_ROUTING: ModelRoutingTable = Object.freeze({});

/** One row as stored. `model` may be blank, which is the same as no row. */
export interface ModelRoute {
  task: string;
  model: string;
  note: string;
}

/**
 * Rows to a lookup, dropping anything that names no model.
 *
 * Blank and whitespace-only models are dropped here rather than handled at
 * every read site: the seeded table lists all fourteen tasks with empty models
 * so the vocabulary is visible in the table editor, and every one of those rows
 * must behave exactly as if it were absent.
 */
export function routingTable(rows: readonly ModelRoute[]): ModelRoutingTable {
  const table: Record<string, string> = {};
  for (const row of rows) {
    const task = row.task?.trim();
    const model = row.model?.trim();
    if (task && model) table[task] = model;
  }
  return table;
}

/**
 * The model that will actually run this task.
 *
 * `defaultModel` is what the capability probe reported, i.e. the function's
 * RESEARCH_MODEL_DEFAULT — so an unrouted task resolves to the same name the
 * server would have chosen on its own, and the card can state it before
 * sending rather than after.
 */
export function routedModel(
  task: string,
  table: ModelRoutingTable,
  defaultModel: string,
): string {
  return table[task]?.trim() || defaultModel;
}

/**
 * Whether this task has a routing row, i.e. whether the resolved model came
 * from the table or from the function's default.
 *
 * The send path uses this to decide whether to send a model name at all:
 * unrouted tasks send none, leaving the server's default as the single place
 * that answer lives. Passing the probed name back would work identically until
 * someone changed RESEARCH_MODEL_DEFAULT between page load and send, at which
 * point the stale name would win.
 */
export function isRouted(task: string, table: ModelRoutingTable): boolean {
  return Boolean(table[task]?.trim());
}

/**
 * The model to SEND for this task, or undefined to let the server choose.
 * The one function the send sites should call.
 */
export function routedModelOverride(
  task: string,
  table: ModelRoutingTable,
): string | undefined {
  const model = table[task]?.trim();
  return model || undefined;
}

/** Rows naming a task the code does not recognise — surfaced, never obeyed. */
export function unrecognisedTasks(rows: readonly ModelRoute[]): string[] {
  const known = new Set<string>(ROUTABLE_TASKS);
  const seen = new Set<string>();
  for (const row of rows) {
    const task = row.task?.trim();
    // A row with no model changes nothing whatever it is called, so a typo
    // worth reporting is one that also names a model.
    if (!task || !row.model?.trim()) continue;
    if (!known.has(task)) seen.add(task);
  }
  return [...seen].sort();
}

/** Rows that name a model, for the routing summary. Sorted by task order. */
export function activeRoutes(rows: readonly ModelRoute[]): ModelRoute[] {
  const order = new Map(ROUTABLE_TASKS.map((task, index) => [task as string, index]));
  return rows
    .filter((row) => row.task?.trim() && row.model?.trim())
    .slice()
    .sort((a, b) => (order.get(a.task) ?? 99) - (order.get(b.task) ?? 99));
}
