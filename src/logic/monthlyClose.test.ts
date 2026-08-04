import { describe, expect, it } from 'vitest';
import { MockRepository } from '../data/mockRepository';
import type { Milestone, Project } from '../data/types';
import {
  buildMonthlyCloseInputs,
  closeDayIndex,
  closeWindowState,
  ensureMonthlyClose,
  latestPriorClose,
  missingSeries,
  needsGeneration,
  periodEnd,
  periodLabel,
  rollForwardMilestone,
  rollForwardProject,
  seriesOf,
  shiftCloseDate,
  targetPeriod,
  workingDay,
} from './monthlyClose';

function closeProject(overrides: Partial<Project> & { title: string }): Project {
  return {
    id: overrides.title,
    domain: 'work',
    engagement: 'samb',
    type: 'other',
    status: 'active',
    milestones: [],
    order: 1,
    recurring: 'monthly',
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    text: 'A task',
    done: false,
    status: 'not-started',
    ...overrides,
  };
}

describe('targetPeriod', () => {
  it('targets the current month from the 22nd onwards', () => {
    expect(targetPeriod(new Date(2026, 6, 22))).toBe('2026-07');
    expect(targetPeriod(new Date(2026, 6, 31))).toBe('2026-07');
  });

  it('targets the previous month before the 22nd (its cycle is still running)', () => {
    expect(targetPeriod(new Date(2026, 7, 3))).toBe('2026-07');
    expect(targetPeriod(new Date(2026, 6, 21))).toBe('2026-06');
  });

  it('rolls across year boundaries', () => {
    expect(targetPeriod(new Date(2027, 0, 5))).toBe('2026-12');
  });
});

describe('periodLabel', () => {
  it('labels with the PERIOD month in Indonesian', () => {
    expect(periodLabel('2026-07')).toBe('Closing Juli');
    expect(periodLabel('2026-12')).toBe('Closing Desember');
    expect(periodLabel('2026-01')).toBe('Closing Januari');
  });
});

describe('periodEnd', () => {
  it('is the last calendar day of the period', () => {
    expect(periodEnd('2026-07')).toBe('2026-07-31');
    expect(periodEnd('2026-02')).toBe('2026-02-28');
    expect(periodEnd('2028-02')).toBe('2028-02-29'); // leap year
    expect(periodEnd('2026-12')).toBe('2026-12-31');
  });
});

describe('workingDay', () => {
  // July 2026: D0 = Fri 31 Jul, so WD1 = Mon 3 Aug and the weekend of
  // 8–9 Aug sits between WD5 and WD6.
  it('walks the July 2026 close calendar exactly', () => {
    expect(workingDay('2026-07', 1)).toBe('2026-08-03');
    expect(workingDay('2026-07', 2)).toBe('2026-08-04');
    expect(workingDay('2026-07', 3)).toBe('2026-08-05');
    expect(workingDay('2026-07', 4)).toBe('2026-08-06');
    expect(workingDay('2026-07', 5)).toBe('2026-08-07');
    expect(workingDay('2026-07', 6)).toBe('2026-08-10'); // skips Sat 8 + Sun 9
    expect(workingDay('2026-07', 7)).toBe('2026-08-11');
    expect(workingDay('2026-07', 8)).toBe('2026-08-12');
  });

  it('never lands on a weekend, whatever the period ends on', () => {
    for (const period of ['2026-01', '2026-02', '2026-05', '2026-08', '2026-11']) {
      for (let n = 1; n <= 10; n += 1) {
        const day = new Date(`${workingDay(period, n)}T00:00:00`).getDay();
        expect(day).not.toBe(0);
        expect(day).not.toBe(6);
      }
    }
  });

  it('treats index 0 as D0 itself', () => {
    expect(workingDay('2026-07', 0)).toBe('2026-07-31');
  });

  it('rolls across the year boundary', () => {
    // Dec 2026 ends Thu 31 Dec; Fri 1 Jan is WD1 (holidays are not modelled).
    expect(workingDay('2026-12', 1)).toBe('2027-01-01');
    expect(workingDay('2026-12', 2)).toBe('2027-01-04'); // skips the weekend
  });
});

describe('closeDayIndex', () => {
  it('inverts workingDay for every weekday', () => {
    for (let n = 0; n <= 12; n += 1) {
      expect(closeDayIndex('2026-07', workingDay('2026-07', n))).toBe(n);
    }
  });

  it('reports calendar offsets for dates inside the period', () => {
    expect(closeDayIndex('2026-07', '2026-07-31')).toBe(0);
    expect(closeDayIndex('2026-07', '2026-07-28')).toBe(-3);
  });

  it('snaps a weekend date onto the working day before it', () => {
    // Sat 8 Aug sits between WD5 (Fri 7th) and WD6 (Mon 10th).
    expect(closeDayIndex('2026-07', '2026-08-08')).toBe(5);
  });
});

describe('shiftCloseDate', () => {
  it('moves a working day to the same working day in another period', () => {
    // WD6 of the June period (Wed 8 Jul) becomes WD6 of July (Mon 10 Aug).
    expect(shiftCloseDate('2026-07-08', '2026-06', '2026-07')).toBe('2026-08-10');
  });

  it('is not the same as adding a month of calendar days', () => {
    expect(shiftCloseDate('2026-07-08', '2026-06', '2026-07')).not.toBe('2026-08-08');
  });

  it('keeps a date inside the period at the same calendar offset', () => {
    expect(shiftCloseDate('2026-06-30', '2026-06', '2026-07')).toBe('2026-07-31');
  });
});

describe('closeWindowState', () => {
  it('walks the July 2026 window from hidden to asking', () => {
    expect(closeWindowState('2026-07', new Date(2026, 6, 21))).toBe('before');
    expect(closeWindowState('2026-07', new Date(2026, 6, 22))).toBe('visible');
    expect(closeWindowState('2026-07', new Date(2026, 7, 12))).toBe('visible'); // WD8
    expect(closeWindowState('2026-07', new Date(2026, 7, 13))).toBe('ask');
  });

  it('counts any time of day on a boundary day as inside the window', () => {
    expect(closeWindowState('2026-07', new Date(2026, 6, 22, 23, 59))).toBe('visible');
    expect(closeWindowState('2026-07', new Date(2026, 7, 12, 23, 59))).toBe('visible');
    expect(closeWindowState('2026-07', new Date(2026, 6, 21, 23, 59))).toBe('before');
  });

  it('follows WD8 across the weekends it skips', () => {
    // Sept 2026 ends Wed 30th, so WD8 is Mon 12 Oct — two weekends later. The
    // Saturday inside the window is still 'visible', not already 'ask'.
    expect(closeWindowState('2026-09', new Date(2026, 9, 10))).toBe('visible');
    expect(closeWindowState('2026-09', new Date(2026, 9, 12))).toBe('visible');
    expect(closeWindowState('2026-09', new Date(2026, 9, 13))).toBe('ask');
  });

  it('opens on the 22nd of the period month, not of the month after', () => {
    expect(closeWindowState('2026-09', new Date(2026, 8, 22))).toBe('visible');
    expect(closeWindowState('2026-09', new Date(2026, 8, 21))).toBe('before');
  });

  it('stays open across the year boundary', () => {
    // Dec 2026 ends Thu 31st, so WD8 is Tue 12 Jan 2027.
    expect(closeWindowState('2026-12', new Date(2026, 11, 22))).toBe('visible');
    expect(closeWindowState('2026-12', new Date(2027, 0, 12))).toBe('visible');
    expect(closeWindowState('2026-12', new Date(2027, 0, 13))).toBe('ask');
  });
});

describe('seriesOf', () => {
  it('reads the series from the title suffix', () => {
    expect(seriesOf(closeProject({ title: 'Closing Juli — BMG' }))).toBe('BMG');
    expect(seriesOf(closeProject({ title: 'Closing Juli — Consolidation' }))).toBe(
      'Consolidation',
    );
  });

  it('prefers the entity tag when it names a series', () => {
    expect(
      seriesOf(closeProject({ title: 'Closing Juli — renamed', entityTag: 'KBF' })),
    ).toBe('KBF');
  });

  it('is null for a project outside the cycle', () => {
    expect(seriesOf(closeProject({ title: 'Some one-off project' }))).toBeNull();
  });
});

describe('buildMonthlyCloseInputs (fallback template)', () => {
  const inputs = buildMonthlyCloseInputs('2026-07');

  it('creates five entity closes plus consolidation, all WORK + recurring', () => {
    expect(inputs).toHaveLength(6);
    expect(inputs.map((p) => p.title)).toEqual([
      'Closing Juli — BMG',
      'Closing Juli — OKI',
      'Closing Juli — KGR',
      'Closing Juli — NMG',
      'Closing Juli — KBF',
      'Closing Juli — Consolidation',
    ]);
    for (const input of inputs) {
      expect(input.domain).toBe('work');
      expect(input.recurring).toBe('monthly');
      expect(input.period).toBe('2026-07');
    }
  });

  it('dates milestones by working day, on endDate, never on the legacy dueDate', () => {
    const bmg = inputs[0];
    expect(bmg.milestones.map((m) => m.endDate)).toEqual(['2026-08-05', '2026-08-10']);
    expect(bmg.milestones.every((m) => m.dueDate === undefined)).toBe(true);
  });

  it('deadlines every series on WD8, the day the checklist itself runs to', () => {
    // WD8 of the July period is Wed 12 Aug, not the calendar 8th (a Saturday).
    for (const input of inputs) expect(input.deadline).toBe('2026-08-12');
  });

  it('gives consolidation the same WD8 as the entities, not a day later', () => {
    expect(inputs[5].deadline).toBe(inputs[0].deadline);
  });

  it('orders consolidation by date with Approve TB before the review deck', () => {
    const consolidation = inputs[5];
    const texts = consolidation.milestones.map((m) => m.text);
    expect(texts.slice(-2)).toEqual(['Approve TB', 'Build monthly review deck']);
    const ends = consolidation.milestones.map((m) => m.endDate as string);
    expect([...ends].sort()).toEqual(ends);
  });

  it('handles the December period rolling into January', () => {
    // Dec 2026 ends Thu 31st, so WD1 is Fri 1 Jan and WD3/WD6 are the 5th
    // and the 8th — a different shape from July, which is the point.
    const december = buildMonthlyCloseInputs('2026-12');
    expect(december[0].milestones.map((m) => m.endDate)).toEqual([
      '2027-01-05',
      '2027-01-08',
    ]);
  });

  it('carries no entity-specific task content — the checklist is data, not code', () => {
    const texts = inputs.flatMap((input) => input.milestones.map((m) => m.text));
    expect(texts.every((text) => text.length > 0)).toBe(true);
    expect(new Set(texts).size).toBeLessThanOrEqual(6);
  });
});

describe('missingSeries / needsGeneration', () => {
  it('reports only the series that are actually absent', () => {
    const existing = [
      closeProject({ title: 'Closing Juli — BMG', period: '2026-07' }),
      closeProject({ title: 'Closing Juli — OKI', period: '2026-07' }),
    ];
    expect(missingSeries(existing, '2026-07')).toEqual([
      'KGR',
      'NMG',
      'KBF',
      'Consolidation',
    ]);
  });

  it('does not let one existing project suppress its five siblings', () => {
    const existing = [closeProject({ title: 'Closing Juli — BMG', period: '2026-07' })];
    expect(needsGeneration(existing, '2026-07', 'BMG')).toBe(false);
    expect(needsGeneration(existing, '2026-07', 'KGR')).toBe(true);
    expect(needsGeneration(existing, '2026-07', 'Consolidation')).toBe(true);
  });

  it('still reports all six when the prior period was closed out', () => {
    // Answering "Sudah" marks every project in a period done. That must not
    // read as "the next period is already covered".
    const existing = ['BMG', 'OKI', 'KGR', 'NMG', 'KBF', 'Consolidation'].map((series) =>
      closeProject({ title: `Closing Juni — ${series}`, period: '2026-06', status: 'done' }),
    );
    expect(missingSeries(existing, '2026-07')).toHaveLength(6);
  });

  it('ignores other periods and non-recurring projects entirely', () => {
    const existing = [
      closeProject({ title: 'Closing Juni — BMG', period: '2026-06' }),
      { ...closeProject({ title: 'Closing Juli — OKI', period: '2026-07' }), recurring: undefined },
    ];
    expect(missingSeries(existing, '2026-07')).toHaveLength(6);
  });
});

describe('latestPriorClose', () => {
  const existing = [
    closeProject({ title: 'Closing April — BMG', period: '2026-04' }),
    closeProject({ title: 'Closing Juni — BMG', period: '2026-06' }),
    closeProject({ title: 'Closing Mei — BMG', period: '2026-05' }),
    closeProject({ title: 'Closing Juni — OKI', period: '2026-06' }),
  ];

  it('picks the most recent prior period of that series', () => {
    expect(latestPriorClose(existing, '2026-07', 'BMG')?.period).toBe('2026-06');
  });

  it('never looks forward', () => {
    expect(latestPriorClose(existing, '2026-05', 'BMG')?.period).toBe('2026-04');
  });

  it('is null for a series with no history', () => {
    expect(latestPriorClose(existing, '2026-07', 'KGR')).toBeNull();
  });

  it('finds a prior close that was already marked done', () => {
    // The only source the first generation after a close-out has is a project
    // whose status is 'done'. A status filter here would end the series.
    const closed = [
      closeProject({ title: 'Closing Juni — KGR', period: '2026-06', status: 'done' }),
    ];
    expect(latestPriorClose(closed, '2026-07', 'KGR')?.period).toBe('2026-06');
  });
});

describe('rollForwardMilestone', () => {
  const source = milestone({
    id: 'old',
    text: 'Second task',
    done: true,
    status: 'done',
    pic: 'PIC-1',
    note: 'waiting on the June statement',
    escalateTo: 'other',
    startDate: '2026-07-07', // WD5 of the June period
    endDate: '2026-07-08', // WD6 of the June period
    documents: [{ label: 'Prior working paper', url: 'https://example.com/wp', addedAt: '2026-07-01' }],
  });
  const rolled = rollForwardMilestone(source, '2026-06', '2026-07');

  it('preserves the text and the PIC', () => {
    expect(rolled.text).toBe('Second task');
    expect(rolled.pic).toBe('PIC-1');
  });

  it('resets status and done', () => {
    expect(rolled.status).toBe('not-started');
    expect(rolled.done).toBe(false);
  });

  it('clears the note, the escalation and the documents', () => {
    expect(rolled.note).toBeUndefined();
    expect(rolled.escalateTo).toBe('none');
    expect(rolled.documents).toBeUndefined();
  });

  it('shifts dates by working day, not by adding a month', () => {
    expect(rolled.startDate).toBe('2026-08-07'); // WD5 of July
    expect(rolled.endDate).toBe('2026-08-10'); // WD6 of July — over the weekend
  });

  it('takes a fresh id — this is a new instance of the task', () => {
    expect(rolled.id).not.toBe('old');
    expect(rolled.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('migrates a legacy dueDate-only milestone onto endDate and drops dueDate', () => {
    const legacy = rollForwardMilestone(
      milestone({ dueDate: '2026-07-08', endDate: undefined }),
      '2026-06',
      '2026-07',
    );
    expect(legacy.endDate).toBe('2026-08-10');
    expect(legacy.dueDate).toBeUndefined();
  });

  it('leaves a milestone with no dates undated rather than inventing one', () => {
    const undated = rollForwardMilestone(milestone(), '2026-06', '2026-07');
    expect(undated.startDate).toBeUndefined();
    expect(undated.endDate).toBeUndefined();
  });

  it('keeps a date-confidence marking the owner set', () => {
    const marked = rollForwardMilestone(
      milestone({ dateConfidence: 'estimated', endDate: '2026-07-08' }),
      '2026-06',
      '2026-07',
    );
    expect(marked.dateConfidence).toBe('estimated');
  });

  it('carries a still-blocked milestone across blocked, with its note intact', () => {
    // Blocked at the end of the cycle means the blocker was never resolved, so
    // the new period inherits it rather than pretending the work is fresh.
    const blocked = rollForwardMilestone(
      milestone({ status: 'blocked', note: 'waiting on another department' }),
      '2026-06',
      '2026-07',
    );
    expect(blocked.status).toBe('blocked');
    expect(blocked.note).toBe('waiting on another department');
    expect(blocked.done).toBe(false);
    expect(blocked.escalateTo).toBe('none');
  });

  it('still resets an in-progress milestone and drops its note', () => {
    const inProgress = rollForwardMilestone(
      milestone({ status: 'in-progress', note: 'half of the reconciliation done' }),
      '2026-06',
      '2026-07',
    );
    expect(inProgress.status).toBe('not-started');
    expect(inProgress.note).toBeUndefined();
  });
});

describe('rollForwardProject', () => {
  const source = closeProject({
    title: 'Closing Juni — BMG',
    period: '2026-06',
    status: 'done',
    entityTag: 'BMG',
    order: 100,
    documents: [{ label: 'Prior pack', url: 'https://example.com/p', addedAt: '2026-07-01' }],
    milestones: [
      milestone({ id: 'a', text: 'Task A', done: true, status: 'done', endDate: '2026-07-03' }),
      milestone({ id: 'b', text: 'Task B', status: 'blocked', note: 'stuck', endDate: '2026-07-08' }),
    ],
  });
  const rolled = rollForwardProject(source, '2026-07', 'BMG');

  it('retitles and re-periods the project, and reactivates it', () => {
    expect(rolled.title).toBe('Closing Juli — BMG');
    expect(rolled.period).toBe('2026-07');
    expect(rolled.status).toBe('active');
    expect(rolled.recurring).toBe('monthly');
  });

  it('preserves the entity tag and clears project-level documents', () => {
    expect(rolled.entityTag).toBe('BMG');
    expect(rolled.documents).toBeUndefined();
  });

  it('leaves parent_id alone — closes stay outside the project hierarchy', () => {
    expect(rolled.parentId).toBeUndefined();
  });

  it('carries every milestone across, none skipped, with none left done', () => {
    expect(rolled.milestones.map((m) => m.text)).toEqual(['Task A', 'Task B']);
    expect(rolled.milestones.every((m) => !m.done)).toBe(true);
  });

  it('resets the finished milestone but inherits the blocked one and its note', () => {
    const [taskA, taskB] = rolled.milestones;
    expect(taskA.status).toBe('not-started');
    expect(taskA.note).toBeUndefined();
    expect(taskB.status).toBe('blocked');
    expect(taskB.note).toBe('stuck');
  });

  it('deadlines the rolled project on WD8 of the new period', () => {
    expect(rolled.deadline).toBe('2026-08-12');
    expect(rollForwardProject(source, '2026-07', 'Consolidation').deadline).toBe(
      '2026-08-12',
    );
  });

  it('does not additionally carry the unfinished ones over as leftovers', () => {
    // "Task B" was blocked in June. It appears exactly once — not twice.
    expect(rolled.milestones.filter((m) => m.text === 'Task B')).toHaveLength(1);
  });
});

describe('ensureMonthlyClose', () => {
  async function seedRepository(projects: Array<Omit<Project, 'id'>>) {
    const repository = new MockRepository();
    for (const existing of await repository.listProjects()) {
      await repository.deleteProject(existing.id);
    }
    for (const project of projects) await repository.createProject(project);
    return repository;
  }

  const june = (
    series: string,
    milestones: Milestone[],
    // The period a cycle rolls forward FROM is normally already closed out.
    status: Project['status'] = 'active',
  ): Omit<Project, 'id'> => ({
    domain: 'work',
    engagement: 'samb',
    title: `Closing Juni — ${series}`,
    type: 'other',
    status,
    milestones,
    order: 100,
    recurring: 'monthly',
    period: '2026-06',
  });

  const now = new Date(2026, 6, 25); // 25 Jul 2026 → period 2026-07

  it('rolls each series forward from its own prior period', async () => {
    const repository = await seedRepository([
      june('BMG', [
        milestone({ id: 'x', text: 'First task', pic: 'PIC-1', endDate: '2026-07-08' }),
      ]),
    ]);
    const created = await ensureMonthlyClose(repository, now);
    const bmg = created.find((project) => project.title === 'Closing Juli — BMG');
    expect(bmg?.milestones).toHaveLength(1);
    expect(bmg?.milestones[0].text).toBe('First task');
    expect(bmg?.milestones[0].pic).toBe('PIC-1');
    expect(bmg?.milestones[0].endDate).toBe('2026-08-10'); // WD6, over the weekend
  });

  it('rolls a closed-out period forward — the first cycle after "Sudah"', async () => {
    // Answering "Sudah" sets all six June projects to 'done'. Nothing may treat
    // that as "no history": it would stop every checklist at the first close.
    const repository = await seedRepository(
      ['BMG', 'OKI', 'KGR', 'NMG', 'KBF', 'Consolidation'].map((series) =>
        june(
          series,
          [milestone({ id: `${series}-1`, text: `${series} step`, pic: 'PIC-1', endDate: '2026-07-08' })],
          'done',
        ),
      ),
    );
    const created = await ensureMonthlyClose(repository, now);
    expect(created.map((project) => project.title)).toEqual([
      'Closing Juli — BMG',
      'Closing Juli — OKI',
      'Closing Juli — KGR',
      'Closing Juli — NMG',
      'Closing Juli — KBF',
      'Closing Juli — Consolidation',
    ]);
    const bmg = created[0];
    expect(bmg.status).toBe('active');
    expect(bmg.milestones.map((m) => m.text)).toEqual(['BMG step']);
    expect(bmg.milestones[0].pic).toBe('PIC-1');
    expect(bmg.milestones[0].endDate).toBe('2026-08-10'); // WD6, over the weekend
  });

  it('falls back to the generic template for a series with no history', async () => {
    const repository = await seedRepository([june('BMG', [milestone({ text: 'Custom' })])]);
    const created = await ensureMonthlyClose(repository, now);
    const oki = created.find((project) => project.title === 'Closing Juli — OKI');
    expect(oki?.milestones.map((m) => m.text)).toEqual([
      'Close the books',
      'TB final & reconciled',
    ]);
  });

  it('generates only the missing series when five of six already exist', async () => {
    const repository = await seedRepository(
      ['BMG', 'OKI', 'KGR', 'NMG', 'KBF'].map((series) => ({
        domain: 'work' as const,
        engagement: 'samb' as const,
        title: `Closing Juli — ${series}`,
        type: 'other' as const,
        status: 'active' as const,
        milestones: [],
        order: 100,
        recurring: 'monthly' as const,
        period: '2026-07',
      })),
    );
    const created = await ensureMonthlyClose(repository, now);
    expect(created.map((project) => project.title)).toEqual([
      'Closing Juli — Consolidation',
    ]);
  });

  it('creates nothing on a second run and leaves the in-flight close alone', async () => {
    const repository = await seedRepository([june('BMG', [milestone({ text: 'Custom' })])]);
    await ensureMonthlyClose(repository, now);

    // Someone starts working the new cycle.
    const [july] = (await repository.listProjects('work')).filter(
      (project) => project.period === '2026-07' && project.title.endsWith('— BMG'),
    );
    await repository.updateProject(july.id, {
      milestones: july.milestones.map((m) => ({ ...m, done: true, status: 'done' as const })),
    });

    const second = await ensureMonthlyClose(repository, now);
    expect(second).toEqual([]);
    const after = await repository.getProject(july.id);
    expect(after?.milestones.every((m) => m.done)).toBe(true);
    expect(
      (await repository.listProjects('work')).filter((p) => p.period === '2026-07'),
    ).toHaveLength(6);
  });
});
