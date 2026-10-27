// @vitest-environment jsdom
//
// D-34: the Week view lists the weekly items planned on the desktop island
// (read-only), for the workspace on screen and the week on screen; and a
// database without migration 117 (no table, so the read throws) still loads
// the rest of the week.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { format } from 'date-fns';
import { MockRepository, mockRepository } from '../../data/mockRepository';
import { useAppStore } from '../../store/appStore';
import { Week } from './Week';

afterEach(() => {
  cleanup();
  useAppStore.setState({ repository: mockRepository, workspace: 'work' });
});

describe('Week lists the weekly items planned on the island', () => {
  it("shows this week's items of the workspace on screen, with their days and state", async () => {
    const repository = new MockRepository();
    const today = format(new Date(), 'yyyy-MM-dd');
    repository.seedWeeklyItems([
      { id: 'w1', domain: 'work', title: 'Tie-out GL KGR', startDate: today, endDate: today, area: 'margin', status: 'open' },
      { id: 'w2', domain: 'growth', title: 'Essay week', startDate: today, endDate: today, status: 'open' },
      { id: 'w3', domain: 'work', title: 'Old one', startDate: '2020-01-01', endDate: '2020-01-02', status: 'open' },
    ]);
    useAppStore.setState({ repository, workspace: 'work' });
    render(<Week />);
    expect(await screen.findByText('Tie-out GL KGR')).toBeTruthy();
    expect(screen.getByText(/· margin/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`${format(new Date(), 'd MMM')} · open`))).toBeTruthy();
    expect(screen.queryByText('Essay week')).toBeNull();
    expect(screen.queryByText('Old one')).toBeNull();
  });

  it('a read that throws (no table yet) leaves the week loaded and shows no card', async () => {
    const repository = new MockRepository();
    repository.listWeeklyItems = async () => {
      throw new Error('relation "public.os_weekly_items" does not exist');
    };
    useAppStore.setState({ repository, workspace: 'work' });
    render(<Week />);
    expect(await screen.findByText('Weekly plan')).toBeTruthy();
    expect(screen.queryByText('Weekly items')).toBeNull();
  });

  it('the range is inclusive and filters by overlap', async () => {
    const repository = new MockRepository();
    repository.seedWeeklyItems([{ id: 'w1', domain: 'work', title: 'x', startDate: '2026-10-26', endDate: '2026-10-30', status: 'open' }]);
    expect(await repository.listWeeklyItems('work', '2026-10-26', '2026-11-01')).toHaveLength(1);
    expect(await repository.listWeeklyItems('work', '2026-10-31', '2026-11-01')).toHaveLength(0);
  });
});
