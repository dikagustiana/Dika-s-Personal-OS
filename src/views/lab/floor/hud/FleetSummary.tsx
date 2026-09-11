import { useAgentStore } from '../store/agentStore';

const ORDER: Array<[string, string]> = [
  ['OFFICE_WORKING', 'working'],
  ['OFFICE_WALKING', 'walking'],
  ['OFFICE_COLLABORATING', 'meeting'],
  ['OFFICE_DELIVERING', 'delivering'],
  ['OFFICE_IDLE', 'idle'],
  ['OFFICE_ERROR', 'error'],
];

/** One line of fleet counts by state, from the store; unknown states are counted separately. */
export function FleetSummary() {
  const agents = useAgentStore((s) => s.agents);
  const records = Object.values(agents);
  if (records.length === 0) return <span className="text-xs text-foreground-muted">Waiting for agents</span>;
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const r of records) {
    if (!r.knownState) unknown++;
    counts.set(r.latest.currentState, (counts.get(r.latest.currentState) ?? 0) + 1);
  }
  const parts = ORDER.filter(([k]) => counts.get(k)).map(([k, label]) => (
    <span key={k} className={k === 'OFFICE_ERROR' ? 'text-destructive' : k === 'OFFICE_COLLABORATING' ? 'text-primary' : 'text-foreground-muted'}>
      {counts.get(k)} {label}
    </span>
  ));
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-xs" aria-label="Fleet summary">
      <span className="text-foreground">{records.length} agents</span>
      {parts}
      {unknown ? <span className="text-destructive">{unknown} unknown state</span> : null}
    </span>
  );
}
