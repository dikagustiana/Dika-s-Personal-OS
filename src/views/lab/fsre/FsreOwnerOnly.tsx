/**
 * What a contributor sees if the store sends them to the FSRE building.
 * A sentence and nothing else: no read, no request, no import from the
 * building — so the lazy chunk with the replay data is never asked for.
 * The same shape as FinishLineSimulationOwnerOnly.
 */
export function FsreOwnerOnly() {
  return (
    <div className="page-shell">
      <div role="status" className="rounded-lg border border-border bg-card p-5 shadow-card">
        <p className="surface-label">FSRE building</p>
        <p className="mt-1 text-sm text-foreground-secondary">This view is for the owner only.</p>
      </div>
    </div>
  );
}
