// Every roster agent sits in exactly one department, none duplicated, none
// orphaned. Asserted here, and shown in the director's room, rather than
// checked once by someone reading a seed file.

import { describe, expect, it } from 'vitest';
import { checkRoster, type RosterAgent } from './roster';
import { MOCK_DEPARTMENTS, MOCK_SEATS } from '../../data/institutionMock';

const agents = (slugs: string[]): RosterAgent[] =>
  slugs.map((slug) => ({ slug, dataClass: 'public', isActive: true }));

const SEATED = MOCK_SEATS.map((seat) => seat.agentSlug);

describe('checkRoster', () => {
  it('passes when every agent is seated once and every seat is filled', () => {
    const report = checkRoster(MOCK_DEPARTMENTS, MOCK_SEATS, agents(SEATED));
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.seated).toBe(SEATED.length);
    expect(report.phantomSeats).toEqual([]);
  });

  it('names an agent with no seat', () => {
    const report = checkRoster(MOCK_DEPARTMENTS, MOCK_SEATS, agents([...SEATED, 'unseated-specialist']));
    expect(report.problems).toContainEqual({
      kind: 'orphaned',
      subject: 'unseated-specialist',
      detail: 'an active agent with no seat in any department',
    });
  });

  it('names an agent seated in two departments', () => {
    const doubled = [...MOCK_SEATS, { ...MOCK_SEATS[2], id: 'seat-dup', departmentId: 'dept-verification' }];
    const report = checkRoster(MOCK_DEPARTMENTS, doubled, agents(SEATED));
    const problem = report.problems.find((entry) => entry.kind === 'duplicated');
    expect(problem?.subject).toBe('evidence-framer');
    expect(problem?.detail).toContain('exactly one');
  });

  it('reports an empty desk as a phantom rather than as an error', () => {
    const withPhantom = [...MOCK_SEATS, {
      id: 'seat-phantom', departmentId: 'dept-verification', agentSlug: 'verify-financial-model',
      role: 'specialist' as const, seatPurpose: 'Arithmetic and tie-out checks. Phantom until authored.', position: 3,
    }];
    const report = checkRoster(MOCK_DEPARTMENTS, withPhantom, agents(SEATED));
    expect(report.ok).toBe(true);
    expect(report.phantomSeats).toEqual([{
      departmentSlug: 'verification',
      agentSlug: 'verify-financial-model',
      role: 'specialist',
      seatPurpose: 'Arithmetic and tie-out checks. Phantom until authored.',
    }]);
  });

  it('catches a department whose named lead is not the agent in its lead seat', () => {
    const mismatched = MOCK_DEPARTMENTS.map((department) =>
      department.slug === 'framing-office' ? { ...department, leadAgentSlug: 'someone-else' } : department);
    const report = checkRoster(mismatched, MOCK_SEATS, agents(SEATED));
    expect(report.problems.some((problem) => problem.kind === 'lead-mismatch')).toBe(true);
  });

  it('reports whether each department has a staffed lead, for the floor', () => {
    const report = checkRoster(MOCK_DEPARTMENTS, MOCK_SEATS, agents(SEATED.filter((slug) => slug !== 'verification-lead')));
    const verification = report.byDepartment.find((entry) => entry.slug === 'verification');
    expect(verification?.leadStaffed).toBe(false);
    expect(verification?.empty).toContain('verification-lead');
  });
});
