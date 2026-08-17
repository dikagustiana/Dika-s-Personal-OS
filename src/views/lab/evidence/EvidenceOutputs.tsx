/**
 * Outputs: where the layers must not blend, and where G-NUMBER blocks.
 *
 * THE ACCEPTANCE PATH LIVES HERE: saving a draft whose numbers nothing
 * stands behind is refused by a blocking panel that names each offending
 * token; the only routes forward are a verified datapoint (linked through a
 * cited claim) or an explicit [C] / [sim] tag on the figure. The panel is
 * not a warning beside a working save button — the save does not happen.
 *
 * Working drafts render layer tags beside every cited claim, because
 * drafting is when the layers actually blend.
 */
import { Plus, ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { EmptyRow } from '../../../components/ui/EmptyRow';
import { useMutation } from '../../../hooks/useMutation';
import { outputFinalizeBlockers } from '../../../data/labEvidenceGuards';
import type { LabOutputType } from '../../../data/labEvidenceTypes';
import { checkOutputNumbers } from '../../../logic/lab/labNumbers';
import { useAppStore } from '../../../store/appStore';
import { cn } from '../../../lib/utils';
import { rowsOr } from '../labUi';
import { ClaimStatusChip, FIELD_LABEL, LayerChip, StaleChip, TEXTAREA, type EvidenceData } from './evidenceUi';

const OUTPUT_TYPES: LabOutputType[] = [
  'paper_section',
  'essay_section',
  'literature_note',
  'data_comparison',
  'briefing',
  'annotated_bibliography',
];

export function EvidenceOutputs({ data, projectId }: { data: EvidenceData; projectId: string }) {
  const repository = useAppStore((state) => state.repository);
  const { run: mutate, isPending } = useMutation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newType, setNewType] = useState<'' | LabOutputType>('');
  const [content, setContent] = useState('');
  const [linkPick, setLinkPick] = useState('');
  /** Violations from the LAST save attempt — the blocking panel's content. */
  const [blockedNumbers, setBlockedNumbers] = useState<ReturnType<typeof checkOutputNumbers>>([]);

  const outputs = rowsOr(data.outputs).filter((output) => output.projectId === projectId);
  const claims = rowsOr(data.claims);
  const datapoints = rowsOr(data.datapoints);
  const contradictions = rowsOr(data.contradictions);
  const selected = outputs.find((output) => output.id === selectedId);

  const citedClaims = useMemo(
    () => (selected ? claims.filter((claim) => selected.claimIds.includes(claim.id)) : []),
    [selected, claims],
  );
  /** The numbers this output may use: datapoints of its cited claims. */
  const backing = useMemo(
    () =>
      datapoints.filter((datapoint) =>
        citedClaims.some((claim) => claim.datapointIds.includes(datapoint.id)),
      ),
    [datapoints, citedClaims],
  );
  const finalizeBlockers = selected
    ? outputFinalizeBlockers({ stale: selected.stale, citedClaims, contradictions })
    : [];

  const open = (id: string) => {
    const output = outputs.find((row) => row.id === id);
    setSelectedId(id);
    setContent(output?.content ?? '');
    setBlockedNumbers([]);
  };

  const save = async () => {
    if (!selected) return;
    // G-NUMBER, interactively: the same scan the repository re-runs on the
    // mutation path. Violations render the blocking panel and NO save fires.
    const violations = checkOutputNumbers(content, backing);
    setBlockedNumbers(violations);
    if (violations.length > 0) return;
    const saved = await mutate('Save output', () =>
      repository.labEvidence.saveOutputContent(selected.id, content, backing),
    );
    if (saved) data.reload();
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1fr_2fr]">
      <div className="grid gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newType) return;
            void mutate('Create output', () =>
              repository.labEvidence.createOutput({ projectId, outputType: newType as LabOutputType }),
            ).then((saved) => {
              if (!saved) return;
              setNewType('');
              data.reload();
              open(saved.id);
            });
          }}
        >
          <label className={`${FIELD_LABEL} grow`}>
            New output
            <select
              className="native-select text-xs"
              value={newType}
              onChange={(event) => setNewType(event.target.value as LabOutputType)}
              required
            >
              <option value="" disabled>
                pilih tipe
              </option>
              {OUTPUT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={isPending || !newType}>
            <Plus className="size-4" />
            Create
          </Button>
        </form>
        {outputs.length === 0 ? (
          <EmptyRow label="Outputs" clause="belum ada output" />
        ) : (
          outputs.map((output) => (
            <button
              key={output.id}
              onClick={() => open(output.id)}
              className={cn(
                'rounded-lg border bg-card p-3 text-left shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selectedId === output.id ? 'border-primary' : 'border-border hover:bg-surface-2',
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <ScrollText className="size-3.5 text-foreground-muted" />
                <span className="font-semibold text-foreground">{output.outputType}</span>
                <span className="text-foreground-muted">{output.status}</span>
                {output.stale && <StaleChip />}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground-muted">
                {output.content || 'kosong'}
              </p>
            </button>
          ))
        )}
      </div>

      {selected ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>
                {selected.outputType} — {selected.status}
              </CardTitle>
              {selected.stale && (
                <p className="mt-1 text-xs text-escalate">
                  Bukti pendukung bergeser sejak draf ini ditulis — tinjau ulang klaimnya, lalu bersihkan.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selected.stale && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void mutate('Clear stale flag', () =>
                      repository.labEvidence.clearOutputStale(selected.id),
                    ).then((saved) => saved && data.reload())
                  }
                >
                  Sudah ditinjau — clear stale
                </Button>
              )}
              {selected.status === 'draft' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending || finalizeBlockers.length > 0}
                  onClick={() =>
                    void mutate('Finalize output', () =>
                      repository.labEvidence.finalizeOutput(selected.id),
                    ).then((saved) => saved && data.reload())
                  }
                >
                  Finalize
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void mutate('Revert to draft', () =>
                      repository.labEvidence.revertOutputToDraft(selected.id),
                    ).then((saved) => saved && data.reload())
                  }
                >
                  Revert to draft
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="surface-label">Cites</span>
                {citedClaims.length === 0 && (
                  <span className="text-foreground-muted">
                    belum mengutip klaim — angka apa pun akan terblokir tanpa datapoint di baliknya
                  </span>
                )}
                {citedClaims.map((claim) => (
                  <span
                    key={claim.id}
                    className="flex items-center gap-1 rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5"
                  >
                    {/* The inline layer tag: what keeps A/B/C from blending
                        while drafting, which is when blending happens. */}
                    <LayerChip layer={claim.layer} />
                    <ClaimStatusChip status={claim.status} />
                    <span>{claim.statement.slice(0, 48)}</span>
                  </span>
                ))}
                <select
                  className="native-select text-xs"
                  value={linkPick}
                  onChange={(event) => setLinkPick(event.target.value)}
                  aria-label="Cite a claim"
                >
                  <option value="">— cite claim —</option>
                  {claims
                    .filter((claim) => claim.projectId === projectId && !selected.claimIds.includes(claim.id))
                    .map((claim) => (
                      <option key={claim.id} value={claim.id}>
                        [{claim.layer}] {claim.statement.slice(0, 50)}
                      </option>
                    ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending || !linkPick}
                  onClick={() =>
                    void mutate('Cite claim', () =>
                      repository.labEvidence.linkOutputClaim(selected.id, linkPick),
                    ).then(() => {
                      setLinkPick('');
                      data.reload();
                    })
                  }
                >
                  Cite
                </Button>
              </div>

              <label className={FIELD_LABEL}>
                Content — angka yang boleh: {backing.length === 0 ? 'tidak ada (belum ada datapoint di balik kutipan)' : backing.map((datapoint) => datapoint.value).join(', ')}
                <textarea
                  className={`${TEXTAREA} min-h-64`}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  disabled={selected.status === 'final'}
                />
              </label>

              {blockedNumbers.length > 0 && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-card p-3"
                >
                  <p className="text-sm font-semibold text-destructive">
                    G-NUMBER: {blockedNumbers.length} angka tanpa datapoint di baliknya — draf tidak disimpan.
                  </p>
                  <ul className="mt-2 grid gap-1 text-xs leading-5 text-foreground-secondary">
                    {blockedNumbers.map((violation) => (
                      <li key={`${violation.token}-${violation.index}`}>
                        <span className="font-semibold text-destructive">{violation.token}</span>
                        {' — …'}
                        {violation.context}…
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs leading-5 text-foreground-muted">
                    Jalan keluar: buat datapoint terverifikasi dan kutip klaim yang memakainya, atau
                    tandai angkanya secara eksplisit — {'"'}9.100 [C]{'"'} untuk inferensi layer C,
                    {' "'}9.100 [sim]{'"'} untuk keluaran model. Angka dalam kutipan {'"'}…{'"'} milik
                    sumber yang dikutip.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void save()} disabled={isPending || selected.status === 'final'}>
                  Save draft
                </Button>
                {finalizeBlockers.length > 0 && selected.status === 'draft' && (
                  <span className="text-xs text-foreground-muted">{finalizeBlockers[0]}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-foreground-muted">Pilih output di kiri, atau buat yang baru.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
