import { describe, expect, it } from 'vitest';
import {
  NO_ROUTING,
  ROUTABLE_TASKS,
  activeRoutes,
  isRouted,
  resolveTaskModel,
  routedModel,
  routedModelOverride,
  routingTable,
  unrecognisedTasks,
  type ModelRoute,
} from './modelRouting';
import {
  MODEL_UNCONFIGURED,
  canSend,
  sendBlockedReason,
  type ModelCapabilities,
} from '../../data/researchModel';
import {
  COUNCIL_UNCONFIGURED,
  councilAvailable,
  councilBlockedReason,
  type CouncilCapabilities,
} from '../../data/researchCouncil';

const row = (task: string, model = '', note = ''): ModelRoute => ({ task, model, note });

describe('routingTable', () => {
  it('is empty when the table has no rows at all', () => {
    expect(routingTable([])).toEqual({});
  });

  it('treats the seeded blank rows as absent', () => {
    // The migration seeds all fourteen tasks with an empty model so the
    // vocabulary is visible in the table editor. Those rows must behave
    // exactly as if they were not there.
    const seeded = ROUTABLE_TASKS.map((task) => row(task));
    expect(routingTable(seeded)).toEqual({});
  });

  it('drops whitespace-only models rather than routing to a blank name', () => {
    expect(routingTable([row('prBrief', '   ')])).toEqual({});
  });

  it('trims a model pasted with stray spaces', () => {
    expect(routingTable([row('prBrief', ' kimi-k2-0905-preview ')])).toEqual({
      prBrief: 'kimi-k2-0905-preview',
    });
  });
});

describe('routedModel', () => {
  it('falls back to the default for a task with no row', () => {
    expect(routedModel('prMethod', NO_ROUTING, 'default-model')).toBe('default-model');
  });

  it('falls back to the default for a row with a blank model', () => {
    const table = routingTable([row('prMethod', '')]);
    expect(routedModel('prMethod', table, 'default-model')).toBe('default-model');
  });

  it('uses the routed model when a row names one', () => {
    const table = routingTable([row('prMethod', 'cheap-model')]);
    expect(routedModel('prMethod', table, 'default-model')).toBe('cheap-model');
  });

  it('routes each task independently — one row changes one task', () => {
    const table = routingTable([row('prCite', 'careful-model')]);
    expect(routedModel('prCite', table, 'default-model')).toBe('careful-model');
    expect(routedModel('prBrief', table, 'default-model')).toBe('default-model');
  });

  it('never resolves to nothing when a default exists', () => {
    // Absence must mean "the default", never "no model", because "no model"
    // reaches the UI as a card with nothing to send to.
    for (const task of ROUTABLE_TASKS) {
      expect(routedModel(task, NO_ROUTING, 'default-model')).toBe('default-model');
    }
  });

  it('routes a task the vocabulary does not know, so a new prompt kind works', () => {
    const table = routingTable([row('prSomethingNew', 'new-model')]);
    expect(routedModel('prSomethingNew', table, 'default-model')).toBe('new-model');
  });
});

describe('routedModelOverride', () => {
  it('is undefined for an unrouted task, so the server default stays the source', () => {
    expect(routedModelOverride('prBrief', NO_ROUTING)).toBeUndefined();
    expect(routedModelOverride('prBrief', routingTable([row('prBrief', '')]))).toBeUndefined();
  });

  it('is the model for a routed task', () => {
    expect(routedModelOverride('prBrief', routingTable([row('prBrief', 'm')]))).toBe('m');
  });
});

describe('isRouted', () => {
  it('distinguishes a routed task from one resolving to the default', () => {
    const table = routingTable([row('scope', 'strong-model'), row('method', '')]);
    expect(isRouted('scope', table)).toBe(true);
    expect(isRouted('method', table)).toBe(false);
    expect(isRouted('contra', table)).toBe(false);
  });
});

describe('unrecognisedTasks', () => {
  it('reports a typo that names a model', () => {
    expect(unrecognisedTasks([row('prBreif', 'some-model')])).toEqual(['prBreif']);
  });

  it('stays quiet about a typo that names no model, which changes nothing', () => {
    expect(unrecognisedTasks([row('prBreif', '')])).toEqual([]);
  });

  it('says nothing about the seeded vocabulary', () => {
    const seeded = ROUTABLE_TASKS.map((task) => row(task, 'some-model'));
    expect(unrecognisedTasks(seeded)).toEqual([]);
  });
});

describe('activeRoutes', () => {
  it('lists only rows that name a model, in vocabulary order', () => {
    const rows = [row('contra', 'c'), row('prBrief', 'b'), row('prCite', ''), row('prData', 'd')];
    expect(activeRoutes(rows).map((entry) => entry.task)).toEqual([
      'prBrief',
      'prData',
      'contra',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The case that matters: routing must not be able to open the browsing gate.
// ---------------------------------------------------------------------------

const configured = (browsing: boolean): ModelCapabilities => ({
  configured: true,
  browsing,
  model: 'default-model',
  requiresBrowsing: MODEL_UNCONFIGURED.requiresBrowsing,
});

const council = (browsing: boolean): CouncilCapabilities => ({
  configured: true,
  browsing,
  model: 'default-model',
  requiresBrowsing: COUNCIL_UNCONFIGURED.requiresBrowsing,
});

describe('routing cannot override the browsing gate', () => {
  const BROWSING_DEPENDENT = ['prData', 'prCite', 'prLit', 'prContra', 'prScope'] as const;

  it('leaves every browsing-dependent prompt copy-paste only, however it is routed', () => {
    // Deliberately the strongest-sounding model name available: the point is
    // that the NAME is irrelevant. The gate is keyed on the task, and the
    // client gate functions take no routing argument at all — they cannot
    // consult the table even by mistake.
    const table = routingTable(
      BROWSING_DEPENDENT.map((task) => row(task, 'model-with-web-access')),
    );
    for (const kind of BROWSING_DEPENDENT) {
      expect(isRouted(kind, table)).toBe(true);
      expect(routedModel(kind, table, 'default-model')).toBe('model-with-web-access');
      // Routed, and still not sendable.
      expect(canSend(kind, configured(false))).toBe(false);
      expect(sendBlockedReason(kind, configured(false))).toContain('fabricate');
    }
  });

  it('leaves the contra council unavailable while browsing is not declared', () => {
    const table = routingTable([row('contra', 'model-with-web-access')]);
    expect(isRouted('contra', table)).toBe(true);
    expect(councilAvailable('contra', council(false))).toBe(false);
    expect(councilBlockedReason('contra', council(false))).toContain('invent citations');
  });

  it('still routes the modes that were never gated', () => {
    const table = routingTable([row('method', 'cheap-model')]);
    expect(councilAvailable('method', council(false))).toBe(true);
    expect(routedModel('method', table, 'default-model')).toBe('cheap-model');
  });

  it('cannot make an unconfigured integration sendable', () => {
    // No key means copy-paste for everything. A routing row is not a key.
    const table = routingTable(ROUTABLE_TASKS.map((task) => row(task, 'some-model')));
    for (const task of ROUTABLE_TASKS) {
      expect(routedModel(task, table, MODEL_UNCONFIGURED.model)).toBe('some-model');
    }
    expect(canSend('prMethod', MODEL_UNCONFIGURED)).toBe(false);
    expect(canSend('prBrief', MODEL_UNCONFIGURED)).toBe(false);
    expect(councilAvailable('method', COUNCIL_UNCONFIGURED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The OTHER half of the gate, and the one that was missing: the browsing
// declaration describes the DEFAULT model, so a gated task must not be routed
// off it even when browsing IS declared.
// ---------------------------------------------------------------------------

describe('resolveTaskModel keeps browsing-gated tasks on the declared model', () => {
  const caps = { model: 'declared-browsing-model', requiresBrowsing: MODEL_UNCONFIGURED.requiresBrowsing };

  it('ignores a routing row for a gated task, and says so rather than silently', () => {
    // The harm this prevents: browsing declared for the default, prData routed
    // to some other model with no web access, gate passes because it only ever
    // checked the boolean — and the model fabricates the confirmation.
    const table = routingTable([row('prData', 'model-with-no-web-access')]);
    const resolved = resolveTaskModel('prData', table, caps);
    expect(resolved.model).toBe('declared-browsing-model');
    expect(resolved.override).toBeUndefined();
    expect(resolved.routed).toBe(false);
    // Not silent: the card and the summary can say the row exists and is not
    // applied, because a setting that quietly does nothing is its own defect.
    expect(resolved.pinned).toBe(true);
  });

  it('pins every gated task, not just the one that was thought of', () => {
    const table = routingTable(
      caps.requiresBrowsing.map((task) => row(task, 'model-with-no-web-access')),
    );
    for (const task of caps.requiresBrowsing) {
      const resolved = resolveTaskModel(task, table, caps);
      expect(resolved.override).toBeUndefined();
      expect(resolved.model).toBe('declared-browsing-model');
    }
  });

  it('routes ungated tasks exactly as before', () => {
    const table = routingTable([row('prMethod', 'cheap-model')]);
    const resolved = resolveTaskModel('prMethod', table, caps);
    expect(resolved).toEqual({
      model: 'cheap-model',
      routed: true,
      pinned: false,
      override: 'cheap-model',
    });
  });

  it('sends no model name for an ungated task with no row', () => {
    const resolved = resolveTaskModel('prMethod', NO_ROUTING, caps);
    expect(resolved.override).toBeUndefined();
    expect(resolved.model).toBe('declared-browsing-model');
    expect(resolved.routed).toBe(false);
    expect(resolved.pinned).toBe(false);
  });

  it('reports the same model it would send, always', () => {
    // The card shows `model`; the request carries `override`. When an override
    // exists the two must name the same thing, or the confirm step lies.
    const table = routingTable([
      row('prMethod', 'a-model'),
      row('prData', 'b-model'),
      row('contra', 'c-model'),
    ]);
    for (const task of ROUTABLE_TASKS) {
      const { model, override } = resolveTaskModel(task, table, caps);
      if (override) expect(override).toBe(model);
    }
  });

  it('pins the contra council too, since the council gate is the same shape', () => {
    const councilCaps = { model: 'declared-browsing-model', requiresBrowsing: ['contra'] };
    const table = routingTable([row('contra', 'model-with-no-web-access'), row('method', 'm')]);
    expect(resolveTaskModel('contra', table, councilCaps).override).toBeUndefined();
    expect(resolveTaskModel('contra', table, councilCaps).pinned).toBe(true);
    expect(resolveTaskModel('method', table, councilCaps).override).toBe('m');
  });
});
