import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROCESS_ENTITY,
  finishLineHref,
  isFinishLinePath,
  isProcessTab,
  parseFinishLineRoute,
  type FinishLineRoute,
} from './finishLineRoute';

const SALES_GENERAL_TRADE = '634e675f-4681-4307-b831-6cad1e7d80fa';

describe('the three Finish line paths', () => {
  it('reads the bare path as the matrix tab', () => {
    expect(parseFinishLineRoute('/finish-line', '')).toEqual({ tab: 'matrix' });
    expect(parseFinishLineRoute('/finish-line/', '')).toEqual({ tab: 'matrix' });
  });

  it('reads the two named tabs', () => {
    expect(parseFinishLineRoute('/finish-line/swimlane', '')).toEqual({ tab: 'swimlane' });
    expect(parseFinishLineRoute('/finish-line/kebutuhan-data', '')).toEqual({
      tab: 'kebutuhan-data',
    });
  });

  it('is null for every path outside the Finish line, so other views keep no address', () => {
    expect(parseFinishLineRoute('/', '')).toBeNull();
    expect(parseFinishLineRoute('/projects', '')).toBeNull();
    expect(parseFinishLineRoute('/finish-lines', '')).toBeNull();
  });

  it('is null for an unknown tab rather than quietly falling back to the matrix', () => {
    expect(parseFinishLineRoute('/finish-line/gates', '')).toBeNull();
    expect(parseFinishLineRoute('/finish-line/swimlane/extra', '')).toBeNull();
  });
});

describe('the ?item pre-filter', () => {
  it('carries a uuid on the swimlane tab', () => {
    expect(parseFinishLineRoute('/finish-line/swimlane', `?item=${SALES_GENERAL_TRADE}`)).toEqual({
      tab: 'swimlane',
      item: SALES_GENERAL_TRADE,
    });
  });

  it('drops anything that is not a uuid instead of filtering on junk', () => {
    expect(parseFinishLineRoute('/finish-line/swimlane', '?item=Storing%20cost')).toEqual({
      tab: 'swimlane',
    });
    expect(parseFinishLineRoute('/finish-line/swimlane', '?item=')).toEqual({ tab: 'swimlane' });
  });

  it('ignores the parameter on the other two tabs', () => {
    expect(parseFinishLineRoute('/finish-line', `?item=${SALES_GENERAL_TRADE}`)).toEqual({
      tab: 'matrix',
    });
    expect(
      parseFinishLineRoute('/finish-line/kebutuhan-data', `?item=${SALES_GENERAL_TRADE}`),
    ).toEqual({ tab: 'kebutuhan-data' });
  });
});

describe('formatting round-trips', () => {
  const routes: FinishLineRoute[] = [
    { tab: 'matrix' },
    { tab: 'swimlane' },
    { tab: 'kebutuhan-data' },
    { tab: 'swimlane', item: SALES_GENERAL_TRADE },
  ];

  it('parses back to what it formatted', () => {
    for (const route of routes) {
      const href = finishLineHref(route);
      const [pathname, search] = href.split('?');
      expect(parseFinishLineRoute(pathname, search ? `?${search}` : '')).toEqual(route);
    }
  });

  it('formats the pre-filtered swimlane as one linkable string', () => {
    expect(finishLineHref({ tab: 'swimlane', item: SALES_GENERAL_TRADE })).toBe(
      `/finish-line/swimlane?item=${SALES_GENERAL_TRADE}`,
    );
  });
});

describe('isFinishLinePath', () => {
  it('recognises every tab and nothing else', () => {
    expect(isFinishLinePath('/finish-line')).toBe(true);
    expect(isFinishLinePath('/finish-line/swimlane')).toBe(true);
    expect(isFinishLinePath('/finish-line/kebutuhan-data')).toBe(true);
    expect(isFinishLinePath('/')).toBe(false);
    expect(isFinishLinePath('/finish-lines')).toBe(false);
  });
});

describe('the ?entity context (§4.1)', () => {
  it('carries a valid entity on both process tabs', () => {
    expect(parseFinishLineRoute('/finish-line/swimlane', '?entity=ARBI')).toEqual({
      tab: 'swimlane',
      entity: 'ARBI',
    });
    expect(parseFinishLineRoute('/finish-line/kebutuhan-data', '?entity=ARBI')).toEqual({
      tab: 'kebutuhan-data',
      entity: 'ARBI',
    });
  });

  it('combines with the ?item pre-filter — a cell handoff carries both', () => {
    expect(
      parseFinishLineRoute('/finish-line/swimlane', `?entity=ARBI&item=${SALES_GENERAL_TRADE}`),
    ).toEqual({ tab: 'swimlane', entity: 'ARBI', item: SALES_GENERAL_TRADE });
  });

  it('drops junk entities instead of filtering on garbage', () => {
    expect(parseFinishLineRoute('/finish-line/swimlane', '?entity=arbi')).toEqual({
      tab: 'swimlane',
    });
    expect(parseFinishLineRoute('/finish-line/swimlane', '?entity=A;DROP')).toEqual({
      tab: 'swimlane',
    });
    expect(parseFinishLineRoute('/finish-line/swimlane', '?entity=')).toEqual({ tab: 'swimlane' });
  });

  it('never carries an entity on the matrix tab — the matrix IS every entity', () => {
    expect(parseFinishLineRoute('/finish-line', '?entity=ARBI')).toEqual({ tab: 'matrix' });
  });

  it('writes the entity only when it is not the default, so bare URLs stay bare', () => {
    expect(finishLineHref({ tab: 'swimlane', entity: DEFAULT_PROCESS_ENTITY })).toBe(
      '/finish-line/swimlane',
    );
    expect(finishLineHref({ tab: 'swimlane', entity: 'ARBI' })).toBe(
      '/finish-line/swimlane?entity=ARBI',
    );
    expect(finishLineHref({ tab: 'kebutuhan-data', entity: 'ARBI' })).toBe(
      '/finish-line/kebutuhan-data?entity=ARBI',
    );
    expect(
      finishLineHref({ tab: 'swimlane', entity: 'ARBI', item: SALES_GENERAL_TRADE }),
    ).toBe(`/finish-line/swimlane?entity=ARBI&item=${SALES_GENERAL_TRADE}`);
  });

  it('round-trips: parse(href(route)) === route for every entity-carrying shape', () => {
    const routes: FinishLineRoute[] = [
      { tab: 'swimlane', entity: 'ARBI' },
      { tab: 'kebutuhan-data', entity: 'ARBI' },
      { tab: 'swimlane', entity: 'ARBI', item: SALES_GENERAL_TRADE },
    ];
    for (const route of routes) {
      const href = finishLineHref(route);
      const [pathname, search = ''] = href.split('?');
      expect(parseFinishLineRoute(pathname, search ? `?${search}` : '')).toEqual(route);
    }
  });
});

describe('isProcessTab — the one predicate for "this tab carries the entity"', () => {
  it('is true for exactly the two process tabs', () => {
    expect(isProcessTab('swimlane')).toBe(true);
    expect(isProcessTab('kebutuhan-data')).toBe(true);
    expect(isProcessTab('matrix')).toBe(false);
  });
});

describe('the simulation tab (/finish-line/simulasi)', () => {
  it('parses to the tab with nothing else on it', () => {
    expect(parseFinishLineRoute('/finish-line/simulasi', '')).toEqual({ tab: 'simulasi' });
    expect(parseFinishLineRoute('/finish-line/simulasi/', '')).toEqual({ tab: 'simulasi' });
  });

  it('drops ?item and ?entity instead of carrying them', () => {
    expect(
      parseFinishLineRoute('/finish-line/simulasi', `?item=${SALES_GENERAL_TRADE}&entity=ENT1`),
    ).toEqual({ tab: 'simulasi' });
  });

  it('is null for anything below it — no silent fallback', () => {
    expect(parseFinishLineRoute('/finish-line/simulasi/x', '')).toBeNull();
    expect(parseFinishLineRoute('/finish-line/simulasi-x', '')).toBeNull();
  });

  it('formats to its bare path whatever the route object carries, and round-trips', () => {
    expect(finishLineHref({ tab: 'simulasi' })).toBe('/finish-line/simulasi');
    expect(finishLineHref({ tab: 'simulasi', entity: 'ENT1', item: SALES_GENERAL_TRADE })).toBe(
      '/finish-line/simulasi',
    );
    expect(parseFinishLineRoute(finishLineHref({ tab: 'simulasi' }), '')).toEqual({ tab: 'simulasi' });
  });

  it('is a Finish line path, and not a process tab', () => {
    expect(isFinishLinePath('/finish-line/simulasi')).toBe(true);
    expect(isProcessTab('simulasi')).toBe(false);
  });

  it('leaves the three existing tabs exactly as they were', () => {
    expect(finishLineHref({ tab: 'matrix' })).toBe('/finish-line');
    expect(finishLineHref({ tab: 'swimlane', entity: 'ENT1', item: SALES_GENERAL_TRADE })).toBe(
      `/finish-line/swimlane?entity=ENT1&item=${SALES_GENERAL_TRADE}`,
    );
    expect(finishLineHref({ tab: 'kebutuhan-data', entity: 'ENT1' })).toBe(
      '/finish-line/kebutuhan-data?entity=ENT1',
    );
  });
});
