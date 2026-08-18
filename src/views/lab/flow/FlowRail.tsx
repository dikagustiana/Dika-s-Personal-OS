/**
 * The rail: four panels, all from data the system already holds.
 * Orkestrasi (front line, WIP against the cap, contradictions, sweep age,
 * gates refusing), Agent (the fixed roster with colour dots), Layanan
 * (Supabase, the Anthropic key, pg_cron, and Batas data — the boundary is
 * this module's hardest guarantee and the owner gets to watch it hold),
 * Pemakaian model (per-model tokens and IDR from the run log — cost was
 * always accounted; it had simply never been shown).
 *
 * The WIP bar carries role="meter", NOT progressbar: it measures a queue
 * against a KNOWN cap. Nothing in this rail fills toward an unknown total.
 */
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { formatDistanceToNow } from 'date-fns';
import { agentColor } from '../../../logic/lab/labAgentColors';
import { formatIdr, formatTokens, formatUsd } from '../../../logic/lab/labCost';
import type { LabFlowState } from '../../../logic/lab/labFlowState';
import { cn } from '../../../lib/utils';

const ROW = 'flex items-center justify-between gap-3 text-xs';
const LABEL = 'text-foreground-muted';
const VALUE = 'font-mono text-foreground-secondary';

function sweepLabel(state: LabFlowState): string {
  const { cron } = state.services;
  if (cron.state === 'unknown') return 'tidak bisa dicek';
  if (cron.state === 'never') return 'belum pernah tercatat';
  return `${Math.round(cron.ageHours ?? 0)} jam lalu${cron.state === 'stale' ? ' — BASI' : cron.state === 'late' ? ' — terlambat' : ''}`;
}

export function FlowRail({ state }: { state: LabFlowState }) {
  const { orchestration, agents, services, usage } = state;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Orkestrasi</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 pt-0">
          <div className={ROW}>
            <span className={LABEL}>Garis depan</span>
            <span className={VALUE}>
              {orchestration.frontLine
                ? `${orchestration.frontLine.code} ${orchestration.frontLine.title}`
                : 'semua tahap selesai'}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Posisi (dihitung)</span>
            <span className={VALUE}>
              {orchestration.doneCount}/13 selesai · {orchestration.blockedCount} terhalang
            </span>
          </div>
          <div>
            <div className={ROW}>
              <span className={LABEL}>Antrean IND vs WIP cap</span>
              <span className={VALUE}>
                {orchestration.indOpen}/{orchestration.indCap}
              </span>
            </div>
            {/* A known/known ratio — a meter, never a progressbar. */}
            <div
              role="meter"
              aria-label="Antrean IND terhadap WIP cap"
              aria-valuenow={orchestration.indOpen}
              aria-valuemin={0}
              aria-valuemax={orchestration.indCap}
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className={cn(
                  'h-full rounded-full',
                  orchestration.indOpen >= orchestration.indCap ? 'bg-destructive/70' : 'bg-escalate/70',
                )}
                style={{ width: `${Math.min(100, (orchestration.indOpen / orchestration.indCap) * 100)}%` }}
              />
            </div>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Kontradiksi terbuka</span>
            <span className={VALUE}>
              direct {orchestration.contradictions.direct} · tension {orchestration.contradictions.tension} · scope{' '}
              {orchestration.contradictions.scopeDifference}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Sweep kadaluarsa</span>
            <span className={VALUE}>{sweepLabel(state)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Gerbang sedang menolak</span>
            <span className={VALUE}>{orchestration.gatesRefusing}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Agent</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1.5 pt-0">
          {agents.map((agent) => (
            <div key={agent.slug} className={ROW}>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: agentColor(agent.slug) }}
                />
                <span className="truncate text-foreground-secondary">{agent.name}</span>
                {agent.stationCode && <span className="font-mono text-[10px] text-foreground-muted">{agent.stationCode}</span>}
              </span>
              <span className={cn('font-mono text-[11px]', agent.runningNow ? 'text-escalate' : 'text-foreground-muted')}>
                {agent.runningNow
                  ? 'sedang berjalan'
                  : agent.lastRanAt
                    ? `${agent.lastStatus} · ${formatDistanceToNow(new Date(agent.lastRanAt), { addSuffix: true })}`
                    : 'belum pernah dijalankan'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Layanan</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 pt-0">
          <div className={ROW}>
            <span className={LABEL}>Supabase</span>
            <span className={VALUE} title={services.supabase.detail}>
              {services.supabase.state === 'ok' ? 'jalan' : services.supabase.state === 'mock' ? 'mock (belum dikonfigurasi)' : 'GAGAL — lihat detail'}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Kunci Anthropic</span>
            <span className={VALUE}>
              {services.anthropicKey === null ? 'tidak bisa dicek' : services.anthropicKey ? 'terpasang' : 'BELUM di-set'}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>pg_cron (lab-stale-sweep)</span>
            <span className={VALUE}>{sweepLabel(state)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Batas data</span>
            <span
              className={cn(
                'font-mono',
                services.boundary.state === 'violated' ? 'font-semibold text-destructive' : 'text-success',
              )}
            >
              {services.boundary.state === 'verified'
                ? 'Enforced'
                : services.boundary.state === 'violated'
                  ? 'DILANGGAR'
                  : 'Enforced (trigger) — registry tak termuat'}
            </span>
          </div>
          {services.boundary.violations.map((violation) => (
            <p key={violation} className="text-[11px] leading-4 text-destructive">
              {violation}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Pemakaian model</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1.5 pt-0">
          {usage.length === 0 && <p className="text-xs text-foreground-muted">Belum ada run tercatat.</p>}
          {usage.map((row) => (
            <div key={row.model} className={ROW}>
              <span className="min-w-0">
                <span className="block truncate font-mono text-[11px] text-foreground-secondary">{row.model}</span>
                <span className="block text-[10px] text-foreground-muted">
                  {row.runs} run · {formatTokens(row.tokensIn)} in / {formatTokens(row.tokensOut)} out
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-[11px] text-foreground-secondary">{formatIdr(row.usd)}</span>
                <span className="block text-[10px] text-foreground-muted">{formatUsd(row.usd)}</span>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
