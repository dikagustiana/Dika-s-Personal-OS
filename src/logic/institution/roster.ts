/**
 * The roster check.
 *
 * Phase 4 asks for a property that is easy to assert and easy to break:
 * every roster agent sits in exactly one department, none duplicated, none
 * orphaned, and every seat is either filled or a named empty desk with a
 * reason. This computes that from the live rows, so the director's room can
 * show it and a test can assert it — rather than it being something someone
 * checked once.
 */
import type { InstDepartment, InstSeat } from '../../data/institutionTypes';

export interface RosterAgent {
  slug: string;
  dataClass: 'internal' | 'public';
  isActive: boolean;
}

export interface RosterProblem {
  kind: 'orphaned' | 'duplicated' | 'unknown-seat' | 'no-lead-seat' | 'lead-mismatch';
  subject: string;
  detail: string;
}

export interface RosterReport {
  ok: boolean;
  problems: RosterProblem[];
  seated: number;
  phantomSeats: Array<{ departmentSlug: string; agentSlug: string; role: 'lead' | 'specialist'; seatPurpose: string }>;
  byDepartment: Array<{ slug: string; name: string; lead: string; leadStaffed: boolean; specialists: string[]; empty: string[] }>;
}

export function checkRoster(
  departments: readonly InstDepartment[],
  seats: readonly InstSeat[],
  agents: readonly RosterAgent[],
): RosterReport {
  const problems: RosterProblem[] = [];
  const agentSlugs = new Set(agents.filter((agent) => agent.isActive).map((agent) => agent.slug));
  const departmentById = new Map(departments.map((department) => [department.id, department]));

  const seatsBySlug = new Map<string, InstSeat[]>();
  for (const seat of seats) {
    const list = seatsBySlug.get(seat.agentSlug) ?? [];
    list.push(seat);
    seatsBySlug.set(seat.agentSlug, list);
    if (!departmentById.has(seat.departmentId)) {
      problems.push({ kind: 'unknown-seat', subject: seat.agentSlug, detail: `seat points at department ${seat.departmentId}, which does not exist` });
    }
  }

  for (const [slug, list] of seatsBySlug) {
    if (list.length > 1) {
      const where = list.map((seat) => departmentById.get(seat.departmentId)?.slug ?? seat.departmentId).join(', ');
      problems.push({ kind: 'duplicated', subject: slug, detail: `seated in ${list.length} departments (${where}); an agent sits in exactly one` });
    }
  }

  for (const slug of agentSlugs) {
    if (!seatsBySlug.has(slug)) {
      problems.push({ kind: 'orphaned', subject: slug, detail: 'an active agent with no seat in any department' });
    }
  }

  const phantomSeats: RosterReport['phantomSeats'] = [];
  const byDepartment: RosterReport['byDepartment'] = [];
  for (const department of departments) {
    const mine = seats.filter((seat) => seat.departmentId === department.id).sort((a, b) => a.position - b.position);
    const lead = mine.find((seat) => seat.role === 'lead');
    if (!lead) {
      problems.push({ kind: 'no-lead-seat', subject: department.slug, detail: 'a department with no lead seat' });
    } else if (lead.agentSlug !== department.leadAgentSlug) {
      problems.push({
        kind: 'lead-mismatch',
        subject: department.slug,
        detail: `the department names ${department.leadAgentSlug} as its lead, the seat holds ${lead.agentSlug}`,
      });
    }
    const empty: string[] = [];
    for (const seat of mine) {
      if (!agentSlugs.has(seat.agentSlug)) {
        empty.push(seat.agentSlug);
        phantomSeats.push({ departmentSlug: department.slug, agentSlug: seat.agentSlug, role: seat.role, seatPurpose: seat.seatPurpose });
      }
    }
    byDepartment.push({
      slug: department.slug,
      name: department.name,
      lead: department.leadAgentSlug,
      leadStaffed: lead ? agentSlugs.has(lead.agentSlug) : false,
      specialists: mine.filter((seat) => seat.role === 'specialist').map((seat) => seat.agentSlug),
      empty,
    });
  }

  return {
    ok: problems.length === 0,
    problems,
    seated: [...seatsBySlug.keys()].filter((slug) => agentSlugs.has(slug)).length,
    phantomSeats,
    byDepartment,
  };
}
