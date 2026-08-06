import { describe, expect, it } from 'vitest';
import {
  finishLineHref,
  isFinishLinePath,
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
