/**
 * Sources, references, commitments — the things evidence points AT.
 *
 * A source document cannot be recorded without its local snapshot path:
 * institutional URLs move without redirects, and the snapshot is the
 * citable artifact. References are born abstract_only and promoted only
 * with the full text on disk. Commitment sources are per-project: any
 * artifact where a claim has been publicly asserted and can no longer
 * change silently.
 */
import { Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { EmptyRow } from '../../../components/ui/EmptyRow';
import { Input } from '../../../components/ui/Input';
import { useMutation } from '../../../hooks/useMutation';
import { recheckSource, scoutSources } from '../../../data/labEvidenceAgents';
import type { LabCommitmentType, LabDocType } from '../../../data/labEvidenceTypes';
import { useAppStore } from '../../../store/appStore';
import { cn } from '../../../lib/utils';
import { LAB_CHIP, rowsOr } from '../labUi';
import { FIELD_LABEL, TEXTAREA, type EvidenceData } from './evidenceUi';

const DOC_TYPES: LabDocType[] = [
  'government_report',
  'multilateral_report',
  'journal_article',
  'statute',
  'dataset',
  'corporate_filing',
  'news',
];

const COMMITMENT_TYPES: LabCommitmentType[] = [
  'essay',
  'published_paper',
  'submitted_proposal',
  'public_presentation',
  'funder_document',
];

export function EvidenceSources({ data, projectId }: { data: EvidenceData; projectId: string }) {
  const repository = useAppStore((state) => state.repository);
  const { run: mutate, isPending } = useMutation();
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [sourceDraft, setSourceDraft] = useState({
    title: '',
    publisher: '',
    publicationDate: '',
    docType: '' as '' | LabDocType,
    url: '',
    localSnapshotPath: '',
    snapshotHash: '',
  });
  const [refDraft, setRefDraft] = useState({ title: '', authors: '', container: '', doi: '' });
  const [promotePath, setPromotePath] = useState<Record<string, string>>({});
  const [commitDraft, setCommitDraft] = useState({
    title: '',
    type: '' as '' | LabCommitmentType,
    committedAt: '',
    documentPath: '',
  });

  const [scoutPaste, setScoutPaste] = useState('');
  const [scoutNote, setScoutNote] = useState('');
  const [promoteDoc, setPromoteDoc] = useState<Record<string, string>>({});
  const [recheckNote, setRecheckNote] = useState('');

  const sources = rowsOr(data.sources);
  const references = rowsOr(data.references);
  const commitments = rowsOr(data.commitments).filter((row) => row.projectId === projectId);
  const candidates = rowsOr(data.candidates).filter(
    (candidate) => candidate.projectId === projectId || candidate.projectId === null,
  );

  const submitSource = async () => {
    if (!sourceDraft.docType) return;
    const saved = await mutate('Record source document', () =>
      repository.labEvidence.createSourceDocument({
        title: sourceDraft.title.trim(),
        publisher: sourceDraft.publisher.trim(),
        publicationDate: sourceDraft.publicationDate || null,
        docType: sourceDraft.docType as LabDocType,
        url: sourceDraft.url.trim(),
        localSnapshotPath: sourceDraft.localSnapshotPath.trim(),
        snapshotHash: sourceDraft.snapshotHash.trim(),
      }),
    );
    if (!saved) return;
    setShowSourceForm(false);
    setSourceDraft({ title: '', publisher: '', publicationDate: '', docType: '', url: '', localSnapshotPath: '', snapshotHash: '' });
    data.reload();
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <div className="grid gap-5 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Candidate sources</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs leading-5 text-foreground-muted">
              The scout structures pasted search listings into rows — title, publisher, URL, date,
              nothing else. There are no columns for its opinion, and the tier comes from the
              owner's allowlist in the database, never from the scout. Promotion requires the
              ingested document with its snapshot.
            </p>
            <form
              className="mb-4 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setScoutNote('');
                void scoutSources({ pastedResults: scoutPaste, projectId }).then((result) => {
                  if (result.ok) {
                    setScoutNote(`Scout recorded ${result.created.length} candidate(s); ${result.skipped.length} skipped.`);
                    setScoutPaste('');
                    data.reload();
                  } else setScoutNote(result.reason);
                });
              }}
            >
              <label className={FIELD_LABEL}>
                Paste search-result listings (no live search is wired — deliberately)
                <textarea
                  className={`${TEXTAREA} min-h-20`}
                  value={scoutPaste}
                  onChange={(event) => setScoutPaste(event.target.value)}
                />
              </label>
              <div>
                <Button type="submit" size="sm" variant="secondary" disabled={!scoutPaste.trim()}>
                  <Sparkles className="size-4" />
                  Run scout
                </Button>
              </div>
            </form>
            {scoutNote && <p className="mb-3 text-xs text-foreground-secondary">{scoutNote}</p>}
            {candidates.length === 0 ? (
              <EmptyRow label="Candidates" clause="belum ada kandidat sumber" />
            ) : (
              <ul className="grid gap-2">
                {candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    className={cn(
                      'rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs',
                      // Tier 3 renders degraded, on purpose: an unknown
                      // publisher is a lead, not evidence.
                      candidate.tier === 3 && 'opacity-60',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          LAB_CHIP,
                          candidate.tier === 1
                            ? 'bg-primary-dim text-primary'
                            : candidate.tier === 2
                              ? 'border border-border text-foreground-secondary'
                              : 'border border-escalate/40 text-escalate',
                        )}
                      >
                        tier {candidate.tier}
                      </span>
                      <span className="font-semibold text-foreground">{candidate.title}</span>
                      <span className="text-foreground-muted">
                        {candidate.publisher || 'penerbit tak dikenal'}
                        {candidate.claimedDate && ` · ${candidate.claimedDate}`} · {candidate.status}
                      </span>
                    </div>
                    {candidate.tier === 3 && (
                      <p className="mt-1 text-[11px] text-escalate">
                        Tier 3 — penerbit di luar allowlist: tidak dapat menopang komitmen layer A.
                      </p>
                    )}
                    {candidate.status === 'candidate' && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          className="native-select text-xs"
                          value={promoteDoc[candidate.id] ?? ''}
                          onChange={(event) =>
                            setPromoteDoc({ ...promoteDoc, [candidate.id]: event.target.value })
                          }
                          aria-label={`Promote ${candidate.title}`}
                        >
                          <option value="">— ingested document (with snapshot) —</option>
                          {sources.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.title.slice(0, 60)}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isPending || !promoteDoc[candidate.id]}
                          onClick={() =>
                            void mutate('Promote candidate', () =>
                              repository.labEvidence.promoteCandidate(
                                candidate.id,
                                promoteDoc[candidate.id],
                              ),
                            ).then((saved) => saved && data.reload())
                          }
                        >
                          Promote
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            void mutate('Dismiss candidate', () =>
                              repository.labEvidence.dismissCandidate(candidate.id),
                            ).then((saved) => saved && data.reload())
                          }
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source documents</CardTitle>
          <Button size="sm" variant="secondary" onClick={() => setShowSourceForm((open) => !open)}>
            <Plus className="size-4" />
            Source
          </Button>
        </CardHeader>
        <CardContent>
          {showSourceForm && (
            <form
              className="mb-4 grid gap-3 rounded-md border border-primary/30 bg-surface-2 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitSource();
              }}
            >
              <label className={FIELD_LABEL}>
                Title
                <Input value={sourceDraft.title} onChange={(event) => setSourceDraft({ ...sourceDraft, title: event.target.value })} required />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className={FIELD_LABEL}>
                  Publisher
                  <Input value={sourceDraft.publisher} onChange={(event) => setSourceDraft({ ...sourceDraft, publisher: event.target.value })} />
                </label>
                <label className={FIELD_LABEL}>
                  Publication date
                  <Input type="date" value={sourceDraft.publicationDate} onChange={(event) => setSourceDraft({ ...sourceDraft, publicationDate: event.target.value })} />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className={FIELD_LABEL}>
                  Type
                  <select
                    className="native-select"
                    value={sourceDraft.docType}
                    onChange={(event) => setSourceDraft({ ...sourceDraft, docType: event.target.value as LabDocType })}
                    required
                  >
                    <option value="" disabled>
                      pilih tipe
                    </option>
                    {DOC_TYPES.map((docType) => (
                      <option key={docType} value={docType}>
                        {docType}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={FIELD_LABEL}>
                  URL
                  <Input value={sourceDraft.url} onChange={(event) => setSourceDraft({ ...sourceDraft, url: event.target.value })} />
                </label>
              </div>
              <label className={FIELD_LABEL}>
                Local snapshot path (wajib — the snapshot is the citation)
                <Input
                  value={sourceDraft.localSnapshotPath}
                  onChange={(event) => setSourceDraft({ ...sourceDraft, localSnapshotPath: event.target.value })}
                  placeholder="snapshots/bps-yearbook-2026.pdf"
                  required
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending || !sourceDraft.docType}>
                  Record source
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowSourceForm(false)}>
                  Batal
                </Button>
              </div>
            </form>
          )}
          {recheckNote && <p className="mb-3 text-xs text-foreground-secondary">{recheckNote}</p>}
          {sources.length === 0 ? (
            <EmptyRow label="Sources" clause="belum ada dokumen sumber" />
          ) : (
            <ul className="grid gap-2">
              {sources.map((source) => (
                <li key={source.id} className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{source.title}</p>
                    {source.contentChangedAt && (
                      <span className={cn(LAB_CHIP, 'border border-escalate/40 text-escalate')}>
                        halaman berubah
                      </span>
                    )}
                    {source.url && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRecheckNote('');
                          void recheckSource({ sourceDocumentId: source.id }).then((result) => {
                            if (result.ok) {
                              setRecheckNote(
                                result.changed
                                  ? 'Recheck: halaman BERUBAH sejak snapshot — ini mendeteksi halamannya berubah, bukan angkanya. Tidak ada status yang diturunkan; tinjau sendiri.'
                                  : 'Recheck: halaman masih identik dengan snapshot.',
                              );
                              data.reload();
                            } else setRecheckNote(result.reason);
                          });
                        }}
                      >
                        <RefreshCw className="size-3.5" />
                        Recheck
                      </Button>
                    )}
                  </div>
                  <p className="mt-0.5 text-foreground-muted">
                    {source.publisher || '—'} · {source.docType} · snapshot: {source.localSnapshotPath}
                    {source.lastRecheckedAt && ` · rechecked ${source.lastRecheckedAt.slice(0, 10)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>References</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="mb-4 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate('Add reference', () =>
                  repository.labEvidence.createReference({
                    title: refDraft.title.trim(),
                    authors: refDraft.authors.trim(),
                    container: refDraft.container.trim(),
                    publicationYear: null,
                    doi: refDraft.doi.trim(),
                    url: '',
                  }),
                ).then((saved) => {
                  if (!saved) return;
                  setRefDraft({ title: '', authors: '', container: '', doi: '' });
                  data.reload();
                });
              }}
            >
              <label className={`${FIELD_LABEL} grow`}>
                Title (masuk sebagai abstract_only)
                <Input value={refDraft.title} onChange={(event) => setRefDraft({ ...refDraft, title: event.target.value })} required />
              </label>
              <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
                <Plus className="size-4" />
                Add
              </Button>
            </form>
            {references.length === 0 ? (
              <EmptyRow label="References" clause="belum ada referensi" />
            ) : (
              <ul className="grid gap-2">
                {references.map((reference) => (
                  <li key={reference.id} className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{reference.title}</span>
                      <span className="text-foreground-muted">{reference.verificationLevel}</span>
                    </div>
                    {reference.verificationLevel === 'abstract_only' && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className={`${FIELD_LABEL} grow`}>
                          Full text path — an abstract locates a paper, never cites a finding
                          <Input
                            value={promotePath[reference.id] ?? ''}
                            onChange={(event) =>
                              setPromotePath({ ...promotePath, [reference.id]: event.target.value })
                            }
                            placeholder="papers/author-2026.pdf"
                          />
                        </label>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isPending || !(promotePath[reference.id] ?? '').trim()}
                          onClick={() =>
                            void mutate('Promote reference', () =>
                              repository.labEvidence.promoteReference(
                                reference.id,
                                (promotePath[reference.id] ?? '').trim(),
                              ),
                            ).then((saved) => saved && data.reload())
                          }
                        >
                          Promote
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commitment sources</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="mb-4 grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!commitDraft.type) return;
                void mutate('Record commitment source', () =>
                  repository.labEvidence.createCommitmentSource({
                    projectId,
                    title: commitDraft.title.trim(),
                    type: commitDraft.type as LabCommitmentType,
                    committedAt: commitDraft.committedAt,
                    documentPath: commitDraft.documentPath.trim(),
                  }),
                ).then((saved) => {
                  if (!saved) return;
                  setCommitDraft({ title: '', type: '', committedAt: '', documentPath: '' });
                  data.reload();
                });
              }}
            >
              <label className={FIELD_LABEL}>
                Title
                <Input value={commitDraft.title} onChange={(event) => setCommitDraft({ ...commitDraft, title: event.target.value })} required />
              </label>
              <label className={FIELD_LABEL}>
                Type
                <select
                  className="native-select"
                  value={commitDraft.type}
                  onChange={(event) => setCommitDraft({ ...commitDraft, type: event.target.value as LabCommitmentType })}
                  required
                >
                  <option value="" disabled>
                    pilih tipe
                  </option>
                  {COMMITMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className={FIELD_LABEL}>
                Committed on
                <Input type="date" value={commitDraft.committedAt} onChange={(event) => setCommitDraft({ ...commitDraft, committedAt: event.target.value })} required />
              </label>
              <label className={FIELD_LABEL}>
                Document path
                <Input value={commitDraft.documentPath} onChange={(event) => setCommitDraft({ ...commitDraft, documentPath: event.target.value })} required />
              </label>
              <div className="md:col-span-2">
                <Button type="submit" size="sm" variant="secondary" disabled={isPending || !commitDraft.type}>
                  Record commitment
                </Button>
              </div>
            </form>
            {commitments.length === 0 ? (
              <EmptyRow label="Commitments" clause="proyek ini belum punya komitmen publik" />
            ) : (
              <ul className="grid gap-2">
                {commitments.map((commitment) => (
                  <li key={commitment.id} className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                    <span className="font-semibold text-foreground">{commitment.title}</span>
                    <span className="ml-2 text-foreground-muted">
                      {commitment.type} · {commitment.committedAt}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
