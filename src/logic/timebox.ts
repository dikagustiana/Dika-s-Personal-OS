import type { Domain } from '../data/types';

export interface TimeSlot {
  start: string; // HH:mm
  end: string; // HH:mm
}

// Each workspace owns a distinct, non-overlapping stretch of the day:
// WORK gets office hours, GROWTH gets the evening. 30-minute slots.
export const DOMAIN_HOURS: Record<Domain, { startMinutes: number; endMinutes: number }> = {
  work: { startMinutes: 8 * 60 + 30, endMinutes: 18 * 60 + 30 }, // 08:30–18:30
  growth: { startMinutes: 18 * 60 + 30, endMinutes: 23 * 60 + 30 }, // 18:30–23:30
};

export function minutesToTime(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function slotsForDomain(domain: Domain): TimeSlot[] {
  const { startMinutes, endMinutes } = DOMAIN_HOURS[domain];
  const count = (endMinutes - startMinutes) / 30;
  return Array.from({ length: count }, (_, index) => {
    const start = startMinutes + index * 30;
    return { start: minutesToTime(start), end: minutesToTime(start + 30) };
  });
}

/** The slot `now` falls into for this domain's grid, or null when outside it. */
export function getCurrentSlot(now: Date, domain: Domain): string | null {
  const { startMinutes, endMinutes } = DOMAIN_HOURS[domain];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return null;
  return minutesToTime(startMinutes + Math.floor((currentMinutes - startMinutes) / 30) * 30);
}
