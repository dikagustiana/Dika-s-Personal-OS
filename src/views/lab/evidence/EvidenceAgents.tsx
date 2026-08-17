/**
 * The agent surface of the epistemic layer — steps 4–7 of the brief.
 *
 * Every button here spends the owner's tokens (the function checks the app
 * key first) and every write the agents make lands under the service role,
 * where the 077 rails bind it: datapoints at IND, references abstract_only,
 * conflicts unresolved, contradictions open, outputs as drafts. What the
 * agents PROPOSE and what the system RECORDS are different things, and the
 * difference is enforced below this screen, not by it.
 *
 * The two-stage pipeline is deliberately manual in the middle: stage 1
 * returns locators, the owner pastes the selected region, stage 2 extracts
 * from that region alone — the pre-selection is where extraction accuracy
 * comes from, so the screen does not pretend to automate it away.
 */
import { Bot, FileSearch, Play, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { EmptyRow } from '../../../components/ui/EmptyRow';
import { Input } from '../../../components/ui/Input';
import {
  coordinateEvidence,
  draftOutput,
  extractDatapoints,
  locateQuantity,
  runReviewer,
  structureLiterature,
  type LocateResult,
} from '../../../data/labEvidenceAgents';
import { LAB_UNCONFIGURED, probeLab, type LabCapabilities } from '../../../data/labModel';
import type { LabOutputType } from '../../../data/labEvidenceTypes';
import { pushToast } from '../../../store/toastStore';
import { useAppStore } from '../../../store/appStore';
import type { NumberViolation } from '../../../logic/lab/labNumbers';
import { rowsOr } from '../labUi';
import { FIELD_LABEL, TEXTAREA, type EvidenceData } from './evidenceUi';

export function EvidenceAgents({ data, projectId }: { data: EvidenceData; projectId: string }) {
  const repository = useAppStore((state) => state.repository);
  const setLabView = useAppStore((state) => state.setLabView);
  const setLabLogFocus = useAppStore((state) => state.setLabLogFocus);
  const [capabilities, setCapabilities] = useState<LabCapabilities>(LAB_UNCONFIGURED);
  const [busy, setBusy] = useState<string | null>(null);

  // Pipeline state
  const [sourceId, setSourceId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [locators, setLocators] = useState<LocateResult['locators'] | null>(null);
  const [selectedText, setSelectedText] = useState('');
  // Literature / reviewer / drafter / coordinator state
  const [pastedResults, setPastedResults] = useState('');
  const [reviewReport, setReviewReport] = useState('');
  const [draftInstruction, setDraftInstruction] = useState('');
  const [draftType, setDraftType] = useState<'' | LabOutputType>('');
  const [draftBlocked, setDraftBlocked] = useState<NumberViolation[]>([]);
  const [coordinatorRequest, setCoordinatorRequest] = useState('');
  const [coordinatorPlan, setCoordinatorPlan] = useState('');

  useEffect(() => {
    void probeLab().then(setCapabilities);
  }, []);

  const sources = rowsOr(data.sources);
  const tasks = rowsOr(data.tasks ?? null);
  const openRun = (runId: string) => {
    setLabLogFocus({ runId });
    setLabView('runs');
  };

  /** One in flight at a time; every outcome lands as a toast + reload. */
  const act = async <T,>(
    name: string,
    action: () => Promise<{ ok: true } & T | { ok: false; reason: string; runId?: string; blocked?: NumberViolation[] }>,
    onOk: (result: { ok: true } & T) => string,
  ) => {
    setBusy(name);
    const result = await action();
    setBusy(null);
    if (result.ok) {
      pushToast({ tone: 'info', message: onOk(result) });
      data.reload();
    } else {
      pushToast({ tone: 'error', message: result.reason });
    }
    return result;
  };

  const anthropicReady = capabilities.providers.anthropic;

  return (
    <div className="grid gap-5">
      {!anthropicReady && (
        <p className="rounded-md border border-escalate/40 bg-card px-3 py-2 text-xs leading-5 text-foreground-secondary">
          Lima dari enam agent ini internal — terkunci ke Anthropic — dan kunci{' '}
          <span className="font-semibold">LAB_ANTHROPIC_API_KEY</span> belum di-set sebagai function
          secret. evidence-literature (public, Kimi) sudah bisa jalan sekarang.
        </p>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Two-stage extraction</CardTitle>
            <p className="mt-1 text-xs text-foreground-muted">
              Stage 1 menemukan LOKASI; kamu memilih teksnya; stage 2 mengekstrak dari teks terpilih
              saja — datapoint lahir IND, verifikasi tetap tanganmu.
            </p>
          </div>
          <FileSearch className="size-4 text-foreground-muted" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className={FIELD_LABEL}>
                Source document (snapshot wajib sudah tercatat)
                <select className="native-select" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                  <option value="">— pilih sumber —</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={FIELD_LABEL}>
                Quantity sought
                <Input
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="realisasi transfer fiskal 2024, basis APBD-P"
                />
              </label>
            </div>
            <label className={FIELD_LABEL}>
              Document text (stage 1 membaca ini)
              <textarea
                className={`${TEXTAREA} min-h-32`}
                value={documentText}
                onChange={(event) => setDocumentText(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null || !quantity.trim() || !documentText.trim()}
                onClick={() =>
                  void act('locate', () => locateQuantity({ quantity, documentText }), (result) => {
                    setLocators(result.locators);
                    return `Stage 1: ${result.locators.length} kandidat lokasi.`;
                  })
                }
              >
                <Play className="size-4" />
                {busy === 'locate' ? 'Mencari…' : 'Stage 1 — locate'}
              </Button>
            </div>
            {locators && (
              <ul className="grid gap-1 text-xs leading-5 text-foreground-secondary">
                {locators.length === 0 && <li>Tidak ditemukan — absen juga jawaban.</li>}
                {locators.map((entry, index) => (
                  <li key={index} className="rounded-sm border border-border-subtle bg-surface-2 px-2 py-1">
                    <span className="font-semibold">{entry.locator}</span> — {entry.quantity}
                    {entry.note && <span className="text-foreground-muted"> · {entry.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            <label className={FIELD_LABEL}>
              Selected text (tempel region dari locator pilihanmu — stage 2 hanya melihat ini)
              <textarea
                className={`${TEXTAREA} min-h-24`}
                value={selectedText}
                onChange={(event) => setSelectedText(event.target.value)}
              />
            </label>
            <div>
              <Button
                size="sm"
                disabled={busy !== null || !sourceId || !selectedText.trim()}
                onClick={() =>
                  void act(
                    'extract',
                    () => extractDatapoints({ sourceDocumentId: sourceId, selectedText, quantity }),
                    (result) =>
                      `Stage 2: ${result.created.length} datapoint lahir IND${
                        result.skipped.length > 0 ? `, ${result.skipped.length} ditolak gate` : ''
                      }.`,
                  )
                }
              >
                <Play className="size-4" />
                {busy === 'extract' ? 'Mengekstrak…' : 'Stage 2 — extract'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Literature</CardTitle>
          </CardHeader>
          <CardContent>
            <label className={FIELD_LABEL}>
              Pasted search results → reference records (abstract_only, selalu)
              <textarea
                className={`${TEXTAREA} min-h-24`}
                value={pastedResults}
                onChange={(event) => setPastedResults(event.target.value)}
              />
            </label>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              disabled={busy !== null || !pastedResults.trim()}
              onClick={() =>
                void act('literature', () => structureLiterature({ pastedResults }), (result) => {
                  setPastedResults('');
                  return `${result.created.length} referensi tercatat abstract_only.`;
                })
              }
            >
              {busy === 'literature' ? 'Menstrukturkan…' : 'Structure references'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reviewer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs leading-5 text-foreground-muted">
              Membaca seluruh basis bukti (lintas proyek — datapoint dibagi bersama), mencatat
              konflik sebagai unresolved dan kontradiksi sebagai open. Putusan tetap milikmu.
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                void act('review', () => runReviewer({ projectId }), (result) => {
                  setReviewReport(result.report);
                  return `Reviewer: ${result.created.conflicts} konflik, ${result.created.contradictions} kontradiksi tercatat.`;
                })
              }
            >
              {busy === 'review' ? 'Meninjau…' : 'Run reviewer'}
            </Button>
            {reviewReport && (
              <p className="mt-3 whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs leading-5 text-foreground-secondary">
                {reviewReport}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Drafter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <p className="text-xs leading-5 text-foreground-muted">
              Menulis dari klaim APPROVED saja; G-NUMBER memindai ulang di server — draf dengan angka
              tanpa datapoint tidak pernah menjadi baris output (teksnya tetap ada di run log).
            </p>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className={FIELD_LABEL}>
                Instruction
                <Input
                  value={draftInstruction}
                  onChange={(event) => setDraftInstruction(event.target.value)}
                  placeholder="Ringkas temuan utilisasi untuk bagian data komparasi"
                />
              </label>
              <label className={FIELD_LABEL}>
                Type
                <select
                  className="native-select"
                  value={draftType}
                  onChange={(event) => setDraftType(event.target.value as LabOutputType)}
                >
                  <option value="">— pilih —</option>
                  {(['paper_section', 'essay_section', 'literature_note', 'data_comparison', 'briefing', 'annotated_bibliography'] as const).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <Button
                size="sm"
                disabled={busy !== null || !draftInstruction.trim() || !draftType}
                onClick={() =>
                  void (async () => {
                    setBusy('draft');
                    setDraftBlocked([]);
                    const result = await draftOutput({
                      projectId,
                      outputType: draftType,
                      instruction: draftInstruction,
                    });
                    setBusy(null);
                    if (result.ok) {
                      pushToast({ tone: 'info', message: 'Draf tersimpan — lihat tab Outputs.' });
                      data.reload();
                    } else {
                      if (result.blocked) setDraftBlocked(result.blocked);
                      pushToast({ tone: 'error', message: result.reason });
                    }
                  })()
                }
              >
                <Bot className="size-4" />
                {busy === 'draft' ? 'Menulis…' : 'Draft with agent'}
              </Button>
            </div>
            {draftBlocked.length > 0 && (
              <div role="alert" className="rounded-md border border-destructive/40 bg-card p-3">
                <p className="text-sm font-semibold text-destructive">
                  G-NUMBER menolak draf agent — {draftBlocked.length} angka tanpa datapoint.
                </p>
                <ul className="mt-2 grid gap-1 text-xs leading-5 text-foreground-secondary">
                  {draftBlocked.map((violation) => (
                    <li key={`${violation.token}-${violation.index}`}>
                      <span className="font-semibold text-destructive">{violation.token}</span> — …
                      {violation.context}…
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-foreground-muted">
                  Teks lengkapnya ada di run log; verifikasi datapoint yang hilang atau minta draf
                  ulang.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coordinator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <label className={FIELD_LABEL}>
              Request — didekomposisi menjadi task untuk kelima agent; task hanyalah rencana, kamu
              yang menjalankannya
              <textarea
                className={`${TEXTAREA} min-h-20`}
                value={coordinatorRequest}
                onChange={(event) => setCoordinatorRequest(event.target.value)}
              />
            </label>
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null || !coordinatorRequest.trim()}
                onClick={() =>
                  void act(
                    'coordinate',
                    () => coordinateEvidence({ request: coordinatorRequest, projectId }),
                    (result) => {
                      setCoordinatorPlan(result.plan);
                      return `${result.tasks.length} task tercatat.`;
                    },
                  )
                }
              >
                {busy === 'coordinate' ? 'Mendekomposisi…' : 'Decompose'}
              </Button>
            </div>
            {coordinatorPlan && (
              <p className="whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs leading-5 text-foreground-secondary">
                {coordinatorPlan}
              </p>
            )}
            {tasks.length === 0 ? (
              <EmptyRow label="Tasks" clause="belum ada delegasi" />
            ) : (
              <ul className="grid gap-2">
                {tasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                    <span className="font-semibold text-foreground">{task.title}</span>
                    <span className="text-foreground-muted">→ {task.agentSlug}</span>
                    <span className="text-foreground-muted">· {task.status}</span>
                    <span className="ml-auto flex items-center gap-2">
                      {task.runId && (
                        <button
                          className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => openRun(task.runId as string)}
                        >
                          <ScrollText className="inline size-3.5" /> log
                        </button>
                      )}
                      {task.status === 'queued' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void repository.labEvidence
                              .updateTaskStatus(task.id, 'done')
                              .then(() => data.reload())
                              .catch(() => pushToast({ tone: 'error', message: 'Gagal menandai task.' }))
                          }
                        >
                          Tandai selesai
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
