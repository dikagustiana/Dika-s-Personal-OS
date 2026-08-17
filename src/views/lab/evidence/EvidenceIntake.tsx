/**
 * Intake — the question layer (FRAMER, phase 2). The framing decides what
 * evidence gets sought before any downstream gate can act, so it is a
 * RECORD here, not a vibe:
 *
 *   * The raw ask renders beside the framed question, ALWAYS — drift from
 *     what was actually asked stays visible, never silent. The database
 *     freezes raw_statement at intake.
 *   * The framer proposes critique and 2–3 alternatives as JSON; choosing
 *     one is the owner's click, recorded as framing_source=owner_selected.
 *     The agent's write scope is empty — G-FRAME refuses it at the DB.
 *   * Every sub-question carries a falsifier: what evidence would show the
 *     expected answer is WRONG. G-FALSIFY blocks finalization of outputs
 *     addressing sub-questions whose requirements nothing satisfied.
 */
import { Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { useMutation } from '../../../hooks/useMutation';
import { useAppStore } from '../../../store/appStore';
import { cn } from '../../../lib/utils';
import { critiqueFraming, proposeFramings } from '../../../data/labEvidenceAgents';
import type {
  LabFramerAlternative,
  LabQuestion,
  LabRequirementKind,
} from '../../../data/labEvidenceTypes';
import { LAB_CHIP, rowsOr } from '../labUi';
import { FIELD_LABEL, TEXTAREA, type EvidenceData } from './evidenceUi';

export function EvidenceIntake({ data, projectId }: { data: EvidenceData; projectId: string }) {
  const repository = useAppStore((state) => state.repository);
  const { run: mutate, isPending } = useMutation();

  const questions = rowsOr(data.questions).filter((question) => question.projectId === projectId);
  const subQuestions = rowsOr(data.subQuestions);
  const requirements = rowsOr(data.requirements);
  const datapoints = rowsOr(data.datapoints);
  const references = rowsOr(data.references);

  const [draft, setDraft] = useState({ rawStatement: '', framedQuestion: '' });
  const [agentNote, setAgentNote] = useState('');
  const [critique, setCritique] = useState('');
  const [alternatives, setAlternatives] = useState<LabFramerAlternative[]>([]);
  const [alternativesFor, setAlternativesFor] = useState<LabQuestion | null>(null);
  const [subDraft, setSubDraft] = useState<{ questionId: string; statement: string; falsifier: string } | null>(null);
  const [reqDraft, setReqDraft] = useState<{ subQuestionId: string; description: string; kind: LabRequirementKind } | null>(null);

  const seam = repository.labEvidence;

  const recordAlternative = (question: LabQuestion, alternative: LabFramerAlternative) => {
    void mutate('Record framing', async () => {
      // Two owner writes: the reframe, then the proposed sub-questions —
      // each row an owner act; the framer only ever supplied the text.
      await seam.reframeQuestion(question.id, alternative.framedQuestion, 'owner_selected');
      for (const [index, subQuestion] of alternative.subQuestions.entries()) {
        await seam.createSubQuestion({
          questionId: question.id,
          statement: subQuestion.statement,
          falsifier: subQuestion.falsifier,
          position: index,
        });
      }
    }).then(() => {
      setAlternatives([]);
      setAlternativesFor(null);
      data.reload();
    });
  };

  return (
    <div className="grid gap-5">
      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-1 text-sm font-semibold text-foreground">New question</h2>
          <p className="mb-3 text-xs leading-5 text-foreground-muted">
            The raw ask is frozen at intake and stays visible beside every reframe — the framing
            may improve; what was actually asked may not quietly change.
          </p>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate('Record question', () =>
                seam.createQuestion({
                  projectId,
                  rawStatement: draft.rawStatement.trim(),
                  framedQuestion: draft.framedQuestion.trim(),
                  framingSource: 'owner_written',
                }),
              ).then((saved) => {
                if (!saved) return;
                setDraft({ rawStatement: '', framedQuestion: '' });
                data.reload();
              });
            }}
          >
            <label className={FIELD_LABEL}>
              Raw ask (your original words — frozen at intake)
              <textarea
                className={TEXTAREA}
                rows={2}
                value={draft.rawStatement}
                onChange={(event) => setDraft({ ...draft, rawStatement: event.target.value })}
                required
              />
            </label>
            <label className={FIELD_LABEL}>
              Framed question (min 20 chars)
              <Input
                value={draft.framedQuestion}
                onChange={(event) => setDraft({ ...draft, framedQuestion: event.target.value })}
                required
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                <Plus className="size-4" />
                Record question
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {agentNote && (
        <p role="alert" className="rounded-md border border-escalate/40 bg-escalate/5 px-3 py-2 text-xs leading-5 text-escalate">
          {agentNote}
        </p>
      )}
      {critique && (
        <Card className="border-primary/30">
          <CardContent className="pt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              Framer critique (advice, not a write)
            </h3>
            <p className="text-sm leading-6 text-foreground-secondary">{critique}</p>
          </CardContent>
        </Card>
      )}

      {questions.length === 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-foreground-muted">
              Belum ada pertanyaan — rekam raw ask dulu; framing menentukan bukti apa yang dicari.
            </p>
          </CardContent>
        </Card>
      )}

      {questions.map((question) => {
        const mySubs = subQuestions
          .filter((subQuestion) => subQuestion.questionId === question.id)
          .sort((a, b) => a.position - b.position);
        return (
          <Card key={question.id}>
            <CardContent className="pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{question.framedQuestion}</p>
                  {/* The raw ask, ALWAYS beside the framing — never collapsed. */}
                  <p className="mt-1 text-xs leading-5 text-foreground-muted">
                    <span className="font-semibold">Raw ask:</span> {question.rawStatement}
                  </p>
                </div>
                <span className={cn(LAB_CHIP, 'border border-border text-foreground-muted shrink-0')}>
                  {question.framingSource === 'owner_selected' ? 'owner-selected' : 'owner-written'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => {
                    setAgentNote('');
                    setCritique('');
                    void critiqueFraming({
                      rawStatement: question.rawStatement,
                      framedQuestion: question.framedQuestion,
                    }).then((result) => {
                      if (result.ok) setCritique(result.critique);
                      else setAgentNote(result.reason);
                    });
                  }}
                >
                  <Sparkles className="size-4" />
                  Critique framing
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => {
                    setAgentNote('');
                    setAlternatives([]);
                    setAlternativesFor(question);
                    void proposeFramings({ rawStatement: question.rawStatement }).then((result) => {
                      if (result.ok) setAlternatives(result.alternatives);
                      else {
                        setAlternativesFor(null);
                        setAgentNote(result.reason);
                      }
                    });
                  }}
                >
                  <Sparkles className="size-4" />
                  Propose alternatives
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSubDraft({ questionId: question.id, statement: '', falsifier: '' })}
                >
                  <Plus className="size-4" />
                  Sub-question
                </Button>
              </div>

              {alternativesFor?.id === question.id && alternatives.length > 0 && (
                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {alternatives.map((alternative, index) => (
                    // Selectable cards: the owner's click IS the write.
                    <button
                      key={index}
                      type="button"
                      className="rounded-md border border-border bg-surface-2 p-3 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => recordAlternative(question, alternative)}
                    >
                      <p className="text-sm font-semibold text-foreground">{alternative.framedQuestion}</p>
                      <p className="mt-1 text-xs leading-5 text-foreground-muted">{alternative.why}</p>
                      {alternative.subQuestions.length > 0 && (
                        <ul className="mt-2 grid gap-1 text-xs text-foreground-secondary">
                          {alternative.subQuestions.map((subQuestion, subIndex) => (
                            <li key={subIndex}>• {subQuestion.statement}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-2 text-[11px] font-semibold text-primary">Select this framing</p>
                    </button>
                  ))}
                </div>
              )}

              {subDraft?.questionId === question.id && (
                <form
                  className="mt-4 grid gap-3 rounded-md border border-border-subtle p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate('Record sub-question', () =>
                      seam.createSubQuestion({
                        questionId: question.id,
                        statement: subDraft.statement.trim(),
                        falsifier: subDraft.falsifier.trim(),
                        position: mySubs.length,
                      }),
                    ).then((saved) => {
                      if (!saved) return;
                      setSubDraft(null);
                      data.reload();
                    });
                  }}
                >
                  <label className={FIELD_LABEL}>
                    Sub-question
                    <Input
                      value={subDraft.statement}
                      onChange={(event) => setSubDraft({ ...subDraft, statement: event.target.value })}
                      required
                    />
                  </label>
                  <label className={FIELD_LABEL}>
                    Falsifier — what evidence would show the expected answer is wrong (min 20 chars)
                    <Input
                      value={subDraft.falsifier}
                      onChange={(event) => setSubDraft({ ...subDraft, falsifier: event.target.value })}
                      required
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={isPending}>Save</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setSubDraft(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {mySubs.length > 0 && (
                <ul className="mt-4 grid gap-3">
                  {mySubs.map((subQuestion) => {
                    const myReqs = requirements.filter(
                      (requirement) => requirement.subQuestionId === subQuestion.id,
                    );
                    const satisfied = myReqs.filter(
                      (requirement) =>
                        requirement.satisfiedByDatapointId !== null ||
                        requirement.satisfiedByReferenceId !== null,
                    ).length;
                    return (
                      <li key={subQuestion.id} className="rounded-md border border-border-subtle p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm text-foreground">{subQuestion.statement}</p>
                          <span
                            className={cn(
                              LAB_CHIP,
                              satisfied > 0
                                ? 'bg-primary-dim text-primary'
                                : 'border border-escalate/40 text-escalate',
                            )}
                          >
                            {satisfied}/{myReqs.length} satisfied
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-foreground-muted">
                          <span className="font-semibold">Falsifier:</span> {subQuestion.falsifier}
                        </p>
                        <ul className="mt-2 grid gap-2">
                          {myReqs.map((requirement) => (
                            <li key={requirement.id} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-foreground-secondary">{requirement.description}</span>
                              <span className={cn(LAB_CHIP, 'border border-border text-foreground-muted')}>
                                {requirement.kind}
                              </span>
                              {requirement.satisfiedByDatapointId || requirement.satisfiedByReferenceId ? (
                                <span className={cn(LAB_CHIP, 'bg-primary-dim text-primary')}>satisfied</span>
                              ) : requirement.kind === 'datapoint' ? (
                                <select
                                  className="native-select text-xs"
                                  aria-label={`Satisfy ${requirement.description}`}
                                  value=""
                                  onChange={(event) => {
                                    const datapointId = event.target.value;
                                    if (!datapointId) return;
                                    void mutate('Satisfy requirement', () =>
                                      seam.satisfyRequirement(requirement.id, { datapointId }),
                                    ).then(() => data.reload());
                                  }}
                                >
                                  <option value="">satisfy with source-matched datapoint…</option>
                                  {datapoints
                                    .filter((datapoint) => datapoint.status === 'V')
                                    .map((datapoint) => (
                                      <option key={datapoint.id} value={datapoint.id}>
                                        {datapoint.value} {datapoint.unit} — {datapoint.definitionScope.slice(0, 60)}
                                      </option>
                                    ))}
                                </select>
                              ) : (
                                <select
                                  className="native-select text-xs"
                                  aria-label={`Satisfy ${requirement.description}`}
                                  value=""
                                  onChange={(event) => {
                                    const referenceId = event.target.value;
                                    if (!referenceId) return;
                                    void mutate('Satisfy requirement', () =>
                                      seam.satisfyRequirement(requirement.id, { referenceId }),
                                    ).then(() => data.reload());
                                  }}
                                >
                                  <option value="">satisfy with full-text reference…</option>
                                  {references
                                    .filter((reference) => reference.verificationLevel === 'full_text_read')
                                    .map((reference) => (
                                      <option key={reference.id} value={reference.id}>
                                        {reference.title.slice(0, 70)}
                                      </option>
                                    ))}
                                </select>
                              )}
                            </li>
                          ))}
                        </ul>
                        {reqDraft?.subQuestionId === subQuestion.id ? (
                          <form
                            className="mt-2 flex flex-wrap items-end gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void mutate('Record requirement', () =>
                                seam.createEvidenceRequirement({
                                  subQuestionId: subQuestion.id,
                                  description: reqDraft.description.trim(),
                                  kind: reqDraft.kind,
                                }),
                              ).then((saved) => {
                                if (!saved) return;
                                setReqDraft(null);
                                data.reload();
                              });
                            }}
                          >
                            <label className={`${FIELD_LABEL} grow`}>
                              Evidence requirement
                              <Input
                                value={reqDraft.description}
                                onChange={(event) =>
                                  setReqDraft({ ...reqDraft, description: event.target.value })
                                }
                                required
                              />
                            </label>
                            <label className={FIELD_LABEL}>
                              Kind
                              <select
                                className="native-select"
                                value={reqDraft.kind}
                                onChange={(event) =>
                                  setReqDraft({ ...reqDraft, kind: event.target.value as LabRequirementKind })
                                }
                              >
                                <option value="datapoint">datapoint</option>
                                <option value="reference">reference</option>
                              </select>
                            </label>
                            <Button type="submit" size="sm" disabled={isPending}>Save</Button>
                            <Button type="button" size="sm" variant="secondary" onClick={() => setReqDraft(null)}>
                              Cancel
                            </Button>
                          </form>
                        ) : (
                          <Button
                            className="mt-2"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setReqDraft({ subQuestionId: subQuestion.id, description: '', kind: 'datapoint' })
                            }
                          >
                            <Plus className="size-4" />
                            Requirement
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
