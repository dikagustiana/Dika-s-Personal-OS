// =============================================================================
// THE PROTOCOL — what the institution says to an agent, and what it accepts back
// =============================================================================
//
// Every step of the pipeline is one model call. This module renders the
// instruction for that call and parses the reply. Both halves are pure, so
// "a lead can refuse" and "a malformed reply does not become an acceptance"
// are testable without a provider.
//
// THE REPLY FORMAT IS A FENCED JSON BLOCK, and the parser is strict on
// purpose. A model that answers in prose has not answered the question the
// institution asked, and guessing its intent is how an unreviewed output
// becomes an accepted one. Every parser here fails CLOSED:
//
//   an unparseable intake  -> the assignment is returned, not accepted
//   an unparseable review  -> 'escalate', not 'accept'
//   an unparseable rebuttal weighing -> 'rejected', so the disagreement
//                             survives to the director rather than being
//                             silently resolved in the committee's favour
//
// Prompts are written in English (CLAUDE.md §7: code, comments and commit
// messages are English; UI copy matches its surface).

import type { DepartmentConfig, SeatConfig } from './department.ts';
import type { WeightClass } from './weight.ts';

// ---------------------------------------------------------------------------
// the JSON block
// ---------------------------------------------------------------------------

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

/** The last fenced block, or the whole reply if it is bare JSON. Never a guess. */
export function extractJson(reply: string): unknown | null {
  const blocks = [...reply.matchAll(new RegExp(FENCE, 'gi'))];
  const candidates = blocks.length > 0
    ? blocks.map((match) => match[1])
    : [reply];
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const text = candidates[i].trim();
    if (!text.startsWith('{') && !text.startsWith('[')) continue;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // A block that is nearly JSON is not JSON. Try the one before it.
    }
  }
  return null;
}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// ---------------------------------------------------------------------------
// shared prompt furniture
// ---------------------------------------------------------------------------

export interface BriefContext {
  question: string;
  restated: string;
  answerWouldBe: string;
  outOfScope: string;
  assumptions: string[];
  weightClass: WeightClass;
  dataClass: 'internal' | 'public';
}

const TOOLS_BLOCK = `TOOLS. You do not call tools yourself in this reply. The institution runs them for you and hands you what they returned. When you need something retrieved, say so in "needs" and name what you want; the lead routes it.`;

const PROVENANCE_BLOCK = `PROVENANCE (B-8). Every factual claim you write carries a citation [corpus:<id>] to an archived record, or is written as a numbered stated assumption ("Assumption 1: ..."). A figure that appears in no cited record will be refused by the number scan, and a [C] tag you write yourself buys nothing — you cannot mint your own exemption.`;

const laneNote = (dataClass: 'internal' | 'public'): string =>
  dataClass === 'internal'
    ? `DATA LANE: INTERNAL. This brief carries SAMB figures. You may retrieve public material, and you may never place an internal figure or a lifted internal sentence into an outbound query, URL or request body — the egress check blocks and logs it (B-4).`
    : `DATA LANE: PUBLIC. This brief carries no SAMB internal data. Do not introduce any.`;

export function briefBlock(brief: BriefContext): string {
  return [
    `QUESTION AS ASKED: ${brief.question}`,
    brief.restated ? `RESTATED BY THE PROGRAM OFFICE: ${brief.restated}` : '',
    brief.answerWouldBe ? `WHAT WOULD COUNT AS AN ANSWER: ${brief.answerWouldBe}` : '',
    brief.outOfScope ? `OUT OF SCOPE: ${brief.outOfScope}` : '',
    brief.assumptions.length > 0 ? `STATED ASSUMPTIONS SO FAR:\n${brief.assumptions.map((text, index) => `  ${index + 1}. ${text}`).join('\n')}` : '',
    `WEIGHT CLASS: ${brief.weightClass}`,
    laneNote(brief.dataClass),
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// 1-B: program office intake
// ---------------------------------------------------------------------------

export function renderProgramIntake(question: string, departments: readonly DepartmentConfig[]): string {
  const list = departments
    .filter((department) => department.kind === 'department')
    .sort((a, b) => a.pipelineOrder - b.pipelineOrder)
    .map((department) => `  ${department.slug} — ${department.purpose} Accountable for: ${department.accountableFor}`)
    .join('\n');
  return `You are the Program Office of a research institution. The director has asked a question. You do not answer it; you turn it into a brief the institution can work, choose which departments it needs, and say what it will cost.

THE REQUEST: ${question}

THE DEPARTMENTS AVAILABLE, in pipeline order:
${list}

RULES
- Verification is in every routing, at every weight class. It is the last line before the director's name goes on something.
- Route only the departments the question actually needs. A question that needs one department should visit one, plus Verification.
- brief: one department, one specialist, one peer review, no committee. standard: the departments it needs, full review, committee. full: the whole pipeline, committee, debate, upgrade proposals, evaluations.
- The lane is internal only if answering requires SAMB's own figures. Public otherwise.

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{
  "restated": "the question as the institution will actually answer it",
  "answerWouldBe": "what a finished answer contains",
  "outOfScope": "what this brief will not do",
  "assumptions": ["each assumption the question smuggles in"],
  "weightClass": "brief | standard | full",
  "classReason": "why that class",
  "dataClass": "public | internal",
  "routing": ["department-slug", "in the order they should work"]
}
\`\`\``;
}

export interface ProgramIntakeReply {
  restated: string;
  answerWouldBe: string;
  outOfScope: string;
  assumptions: string[];
  weightClass: WeightClass;
  classReason: string;
  dataClass: 'internal' | 'public';
  routing: string[];
}

export function parseProgramIntake(reply: string, knownDepartments: readonly string[]): ProgramIntakeReply | { error: string } {
  const parsed = asRecord(extractJson(reply));
  const restated = asString(parsed.restated).trim();
  if (restated.length < 12) {
    return { error: 'the program office did not return a restated question; the request is not yet a brief' };
  }
  const weightClass = ['brief', 'standard', 'full'].includes(asString(parsed.weightClass))
    ? (parsed.weightClass as WeightClass)
    : 'standard';
  const routing = asStrings(parsed.routing).filter((slug) => knownDepartments.includes(slug));
  return {
    restated,
    answerWouldBe: asString(parsed.answerWouldBe).trim(),
    outOfScope: asString(parsed.outOfScope).trim(),
    assumptions: asStrings(parsed.assumptions),
    weightClass,
    classReason: asString(parsed.classReason).trim(),
    dataClass: asString(parsed.dataClass) === 'internal' ? 'internal' : 'public',
    routing,
  };
}

// ---------------------------------------------------------------------------
// 1-A: lead intake
// ---------------------------------------------------------------------------

export function renderLeadIntake(config: DepartmentConfig, brief: BriefContext, upstream: string | null, bench: readonly SeatConfig[]): string {
  return `You are the lead of ${config.name} in a research institution. ${config.purpose}
You are accountable for: ${config.accountableFor}

${briefBlock(brief)}

${upstream ? `WHAT THE PREVIOUS DEPARTMENT SUBMITTED:\n${upstream}\n` : ''}
YOUR BENCH (the specialists you may assign, and what each seat is for):
${bench.map((seat) => `  ${seat.agentSlug} — ${seat.seatPurpose}`).join('\n') || '  (no staffed specialists)'}

YOUR DECISION. Accept this assignment, or return it as unanswerable-as-written with a reason. A department that cannot refuse bad input is a conveyor belt, not a function. Refuse when the question cannot be answered as written, when what would count as an answer is not stated, or when what arrived from upstream is not enough to work with.

If you accept: split the work by capability across the seats above. If a capability you need has no seat, name it in "authorNeeded" and the institution will have you author one — it will be a public-lane agent, always.

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{
  "accept": true,
  "reason": "one sentence: why you accept, or why you are returning it",
  "assignTo": ["agent-slug"],
  "authorNeeded": ["a capability with no seat, described in three or four words"],
  "instructions": { "agent-slug": "what exactly this specialist should produce" }
}
\`\`\``;
}

export interface LeadIntakeReply {
  accept: boolean;
  reason: string;
  assignTo: string[];
  authorNeeded: string[];
  instructions: Record<string, string>;
}

export function parseLeadIntake(reply: string, bench: readonly string[]): LeadIntakeReply {
  const parsed = asRecord(extractJson(reply));
  if (Object.keys(parsed).length === 0) {
    // Fails closed: an unreadable reply returns the assignment rather than
    // accepting it on the strength of a shrug.
    return {
      accept: false,
      reason: 'the lead did not answer in the required form, so the assignment is returned rather than accepted on an unreadable reply',
      assignTo: [],
      authorNeeded: [],
      instructions: {},
    };
  }
  const accept = parsed.accept === true;
  const assignTo = asStrings(parsed.assignTo).filter((slug) => bench.includes(slug));
  const instructionsRaw = asRecord(parsed.instructions);
  const instructions: Record<string, string> = {};
  for (const [slug, value] of Object.entries(instructionsRaw)) {
    if (typeof value === 'string' && bench.includes(slug)) instructions[slug] = value;
  }
  return {
    accept,
    reason: asString(parsed.reason, accept ? 'accepted' : 'returned without a stated reason').trim(),
    assignTo,
    authorNeeded: asStrings(parsed.authorNeeded).slice(0, 3),
    instructions,
  };
}

// ---------------------------------------------------------------------------
// specialist work
// ---------------------------------------------------------------------------

export interface ToolResultSummary {
  tool: string;
  ok: boolean;
  summary: string;
  corpusId?: string;
}

export function renderSpecialistWork(
  config: DepartmentConfig,
  seat: SeatConfig,
  brief: BriefContext,
  instruction: string,
  archived: readonly ToolResultSummary[],
  reworkNote: string | null,
): string {
  return `You are ${seat.agentSlug}, a specialist in ${config.name}. Your seat exists to: ${seat.seatPurpose}

${briefBlock(brief)}

YOUR ASSIGNMENT FROM THE LEAD: ${instruction}
${reworkNote ? `\nTHIS IS A REWORK. What the review asked you to fix:\n${reworkNote}\n` : ''}
${archived.length > 0 ? `WHAT THE INSTITUTION HAS ALREADY ARCHIVED FOR THIS BRIEF (cite these by id):\n${archived.map((entry) => `  ${entry.corpusId ? `[corpus:${entry.corpusId}] ` : ''}${entry.summary}`).join('\n')}\n` : 'NOTHING IS ARCHIVED FOR THIS BRIEF YET. Say in "needs" what you want retrieved.\n'}
${PROVENANCE_BLOCK}

${TOOLS_BLOCK}

Reply with your work as prose, THEN one fenced JSON block:
\`\`\`json
{
  "produced": "one sentence naming what you produced",
  "restsOn": ["corpus-id you actually used"],
  "uncertain": "what you are not sure of, or 'nothing material'",
  "didNotDo": "what you deliberately left out",
  "needs": [{ "tool": "web_search | web_fetch | public_data | execute", "why": "what you want and what for", "query": "the query or URL or script" }]
}
\`\`\``;
}

export interface SpecialistReply {
  prose: string;
  produced: string;
  restsOn: string[];
  uncertain: string;
  didNotDo: string;
  needs: Array<{ tool: string; why: string; query: string }>;
}

export function parseSpecialistWork(reply: string): SpecialistReply {
  const parsed = asRecord(extractJson(reply));
  const prose = reply.replace(new RegExp(FENCE, 'gi'), '').trim();
  const needs = Array.isArray(parsed.needs)
    ? parsed.needs.map((entry) => {
        const record = asRecord(entry);
        return { tool: asString(record.tool), why: asString(record.why), query: asString(record.query) };
      }).filter((need) => need.tool && need.query)
    : [];
  return {
    prose,
    produced: asString(parsed.produced, prose.slice(0, 200)).trim(),
    restsOn: asStrings(parsed.restsOn),
    uncertain: asString(parsed.uncertain, 'not stated').trim(),
    didNotDo: asString(parsed.didNotDo, 'not stated').trim(),
    needs,
  };
}

// ---------------------------------------------------------------------------
// reviews: peer, lead, committee
// ---------------------------------------------------------------------------

export interface ReviewFinding {
  claim: string;
  finding: string;
  severity: 'blocking' | 'material' | 'minor';
  suggestedFix?: string;
}

const REVIEW_JSON = `\`\`\`json
{
  "verdict": "accept | rework | reject | escalate",
  "summary": "one sentence a person can act on",
  "findings": [
    { "claim": "the sentence or figure you are challenging", "finding": "what is wrong with it", "severity": "blocking | material | minor", "suggestedFix": "what would fix it" }
  ]
}
\`\`\``;

export function renderPeerReview(config: DepartmentConfig, reviewerSlug: string, authorSlug: string, work: string, brief: BriefContext): string {
  return `You are ${reviewerSlug}, reviewing a sibling's work inside ${config.name}. You did not write this and you are not its author; your job is craft, not politeness.

${briefBlock(brief)}

WHAT ${authorSlug} PRODUCED:
${work}

LOOK FOR: unsupported steps, a claim with no citation, arithmetic that does not hold, a figure that no cited record contains, scope drift, and a conclusion stronger than the evidence carries.

Reply with ONE fenced JSON block and nothing else:
${REVIEW_JSON}`;
}

export function renderLeadReview(config: DepartmentConfig, brief: BriefContext, work: string, peerFindings: readonly ReviewFinding[]): string {
  return `You are the lead of ${config.name}, reviewing your department's combined output against the assignment. You are accountable for: ${config.accountableFor}

${briefBlock(brief)}

THE WORK:
${work}

WHAT PEER REVIEW FOUND:
${peerFindings.length > 0 ? peerFindings.map((finding) => `  [${finding.severity}] ${finding.claim} — ${finding.finding}`).join('\n') : '  (no findings)'}

Accept it, or return it for rework. You may return work twice; after that the program office arbitrates rather than a third round (B-5). Accepting work that should have been returned is your failure, not the specialist's.

Reply with ONE fenced JSON block and nothing else:
${REVIEW_JSON}`;
}

export function renderCommitteeReview(brief: BriefContext, submissions: string, reviewHistory: string): string {
  return `You are the Editorial Committee of a research institution — an editorial board, not a QA gate. Work has reached you from every department the brief visited.

${briefBlock(brief)}

WHAT THE DEPARTMENTS SUBMITTED:
${submissions}

THE REVIEW HISTORY:
${reviewHistory}

ASK, IN THIS ORDER:
  1. What does each claim rest on, and is it traceable to a corpus record?
  2. Does the conclusion survive removing its weakest assumption?
  3. What is asserted with more confidence than the evidence carries?
  4. What is absent that a hostile reader would ask for first?
  5. What does this reveal about a specialist's capability that should be fixed?
  6. What does this reveal about a lead's assignment and acceptance judgement?
  7. What does this reveal about the program office's routing?

You may propose upgrades to a specialist, a lead, the program office, or to yourself. A proposal never changes anything by itself: the agent keeps running its current version until the director approves it.

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{
  "verdict": "accept | rework | reject | escalate",
  "summary": "one sentence",
  "findings": [{ "claim": "...", "finding": "...", "severity": "blocking | material | minor", "suggestedFix": "..." }],
  "proposals": [
    { "agentSlug": "who this is about", "rationale": "what the work showed about this agent", "change": "the concrete change to its instructions, written as the replacement paragraph" }
  ]
}
\`\`\``;
}

export interface ReviewReply {
  verdict: 'accept' | 'rework' | 'reject' | 'escalate';
  summary: string;
  findings: ReviewFinding[];
  proposals: Array<{ agentSlug: string; rationale: string; change: string }>;
}

export function parseReview(reply: string): ReviewReply {
  const parsed = asRecord(extractJson(reply));
  if (Object.keys(parsed).length === 0) {
    // Fails closed: an unreadable review escalates rather than accepting.
    return {
      verdict: 'escalate',
      summary: 'the reviewer did not answer in the required form; escalated rather than read as an acceptance',
      findings: [],
      proposals: [],
    };
  }
  const verdictRaw = asString(parsed.verdict);
  const verdict = ['accept', 'rework', 'reject', 'escalate'].includes(verdictRaw)
    ? (verdictRaw as ReviewReply['verdict'])
    : 'escalate';
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings.map((entry) => {
        const record = asRecord(entry);
        const severityRaw = asString(record.severity, 'material');
        return {
          claim: asString(record.claim).slice(0, 2_000),
          finding: asString(record.finding).slice(0, 2_000),
          severity: (['blocking', 'material', 'minor'].includes(severityRaw) ? severityRaw : 'material') as ReviewFinding['severity'],
          ...(record.suggestedFix ? { suggestedFix: asString(record.suggestedFix).slice(0, 2_000) } : {}),
        };
      }).filter((finding) => finding.finding.length > 0)
    : [];
  const proposals = Array.isArray(parsed.proposals)
    ? parsed.proposals.map((entry) => {
        const record = asRecord(entry);
        return {
          agentSlug: asString(record.agentSlug),
          rationale: asString(record.rationale),
          change: asString(record.change),
        };
      }).filter((proposal) => proposal.agentSlug && proposal.change.length > 20 && proposal.rationale.length >= 10)
    : [];
  // An accept with a blocking finding is a contradiction; the finding wins.
  const blocking = findings.some((finding) => finding.severity === 'blocking');
  return {
    verdict: verdict === 'accept' && blocking ? 'rework' : verdict,
    summary: asString(parsed.summary, 'no summary given').trim(),
    findings,
    proposals,
  };
}

// ---------------------------------------------------------------------------
// submission (1-A): a record, not a message
// ---------------------------------------------------------------------------

export function renderSubmission(config: DepartmentConfig, brief: BriefContext, accepted: string, toName: string): string {
  return `You are the lead of ${config.name}. Your department's work is accepted and goes to ${toName}. Write the submission. It is a record, not a message.

${briefBlock(brief)}

THE ACCEPTED WORK:
${accepted}

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{
  "produced": "what your department produced, in two or three sentences",
  "restsOn": ["corpus-id"],
  "uncertainties": "what you are uncertain about; 'none material' is an answer, silence is not",
  "exclusions": "what your department explicitly did not do, so the next one does not assume it was done"
}
\`\`\``;
}

export interface SubmissionReply {
  produced: string;
  restsOn: string[];
  uncertainties: string;
  exclusions: string;
}

export function parseSubmission(reply: string): SubmissionReply {
  const parsed = asRecord(extractJson(reply));
  return {
    produced: asString(parsed.produced).trim(),
    restsOn: asStrings(parsed.restsOn),
    uncertainties: asString(parsed.uncertainties).trim(),
    exclusions: asString(parsed.exclusions).trim(),
  };
}

// ---------------------------------------------------------------------------
// debate (1-D)
// ---------------------------------------------------------------------------

export function renderRebuttal(agentSlug: string, findings: readonly ReviewFinding[], work: string): string {
  return `You are ${agentSlug}. The Editorial Committee has made findings against your work. You may contest them in writing, or accept them. Contesting is not a formality: a finding that misreads what you produced should be said so, with the evidence.

WHAT YOU PRODUCED:
${work}

THE FINDINGS:
${findings.map((finding, index) => `  ${index + 1}. [${finding.severity}] ${finding.claim} — ${finding.finding}`).join('\n')}

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{ "contest": true, "rebuttal": "which finding, and why it is wrong, with what it overlooked" }
\`\`\``;
}

export function parseRebuttal(reply: string): { contest: boolean; rebuttal: string } {
  const parsed = asRecord(extractJson(reply));
  const rebuttal = asString(parsed.rebuttal).trim();
  return { contest: parsed.contest === true && rebuttal.length > 20, rebuttal };
}

export function renderWeighing(rebuttals: ReadonlyArray<{ id: string; agentSlug: string; rebuttal: string }>): string {
  return `You are the Editorial Committee. These parties have contested your findings. Weigh each one explicitly and record the reason. An accepted rebuttal may mean your own instructions need changing — propose that against yourself if so.

${rebuttals.map((entry, index) => `  ${index + 1}. (${entry.id}) ${entry.agentSlug}: ${entry.rebuttal}`).join('\n\n')}

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{
  "weighings": [{ "id": "the id above", "outcome": "accepted | rejected | partially_accepted", "weighing": "your reason" }],
  "proposals": [{ "agentSlug": "who, possibly yourself", "rationale": "...", "change": "..." }]
}
\`\`\``;
}

export interface WeighingReply {
  weighings: Array<{ id: string; outcome: 'accepted' | 'rejected' | 'partially_accepted'; weighing: string }>;
  proposals: Array<{ agentSlug: string; rationale: string; change: string }>;
}

export function parseWeighing(reply: string, ids: readonly string[]): WeighingReply {
  const parsed = asRecord(extractJson(reply));
  const weighings = Array.isArray(parsed.weighings)
    ? parsed.weighings.map((entry) => {
        const record = asRecord(entry);
        const outcomeRaw = asString(record.outcome);
        return {
          id: asString(record.id),
          outcome: (['accepted', 'rejected', 'partially_accepted'].includes(outcomeRaw) ? outcomeRaw : 'rejected') as WeighingReply['weighings'][number]['outcome'],
          weighing: asString(record.weighing, 'no reason recorded').trim(),
        };
      }).filter((entry) => ids.includes(entry.id))
    : [];
  // Anything the committee did not weigh stands as unresolved, which is
  // 'rejected' for the purposes of B-5 — the disagreement survives to the
  // director rather than evaporating.
  for (const id of ids) {
    if (!weighings.some((entry) => entry.id === id)) {
      weighings.push({ id, outcome: 'rejected', weighing: 'the committee did not weigh this rebuttal; it stands unresolved' });
    }
  }
  const proposals = Array.isArray(parsed.proposals)
    ? parsed.proposals.map((entry) => {
        const record = asRecord(entry);
        return { agentSlug: asString(record.agentSlug), rationale: asString(record.rationale), change: asString(record.change) };
      }).filter((proposal) => proposal.agentSlug && proposal.change.length > 20)
    : [];
  return { weighings, proposals };
}

// ---------------------------------------------------------------------------
// authoring an agent (B-3) and arbitration
// ---------------------------------------------------------------------------

export function renderAuthoring(config: DepartmentConfig, capability: string, brief: BriefContext): string {
  return `You are the lead of ${config.name}. Your department needs a capability it has no seat for, and you are authoring the specialist that fills it.

${briefBlock(brief)}

THE MISSING CAPABILITY: ${capability}
YOUR DEPARTMENT IS ACCOUNTABLE FOR: ${config.accountableFor}

The agent you author is a PUBLIC-lane agent. It will not see SAMB internal data; promoting an agent to the internal lane is the director's action and yours to request, not to take (B-3). Write its instructions the way the rest of this institution is written: what it does, what it refuses, and what it never does.

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{
  "slug": "lower-case-hyphenated",
  "name": "Title Case Name",
  "description": "one sentence: what this specialist is for",
  "systemPrompt": "the agent's full instructions, several paragraphs, ending with its rules",
  "purpose": "why this department needs it, for the record"
}
\`\`\``;
}

export interface AuthoringReply {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  purpose: string;
}

export function parseAuthoring(reply: string): AuthoringReply | { error: string } {
  const parsed = asRecord(extractJson(reply));
  const slug = asString(parsed.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const systemPrompt = asString(parsed.systemPrompt).trim();
  if (!slug) return { error: 'the authoring reply carried no slug' };
  if (systemPrompt.length < 200) {
    return { error: `the authoring reply for ${slug} carried a ${systemPrompt.length}-character prompt; an agent's instructions are not three sentences` };
  }
  return {
    slug: slug.slice(0, 60),
    name: asString(parsed.name, slug).trim().slice(0, 120),
    description: asString(parsed.description).trim().slice(0, 500),
    systemPrompt,
    purpose: asString(parsed.purpose).trim().slice(0, 500),
  };
}

export function renderArbitration(subject: string, history: string): string {
  return `You are the Program Office. Work has hit a bounded limit and does not loop again; you decide what happens to it.

WHAT IS STUCK: ${subject}

THE HISTORY:
${history}

Your options: send it on as it stands with the disagreement recorded, drop the contested part and continue without it, or stop and tell the director. Choose one and say why in a sentence the director can read.

Reply with ONE fenced JSON block and nothing else:
\`\`\`json
{ "decision": "continue | drop | stop", "reason": "one sentence", "note": "what the next department needs to know" }
\`\`\``;
}

export interface ArbitrationReply {
  decision: 'continue' | 'drop' | 'stop';
  reason: string;
  note: string;
}

export function parseArbitration(reply: string): ArbitrationReply {
  const parsed = asRecord(extractJson(reply));
  const decisionRaw = asString(parsed.decision);
  return {
    // Fails closed: an unreadable arbitration stops and tells the director
    // rather than waving contested work onward.
    decision: (['continue', 'drop', 'stop'].includes(decisionRaw) ? decisionRaw : 'stop') as ArbitrationReply['decision'],
    reason: asString(parsed.reason, 'the program office did not answer in the required form').trim(),
    note: asString(parsed.note).trim(),
  };
}

// ---------------------------------------------------------------------------
// evaluations (B-9)
// ---------------------------------------------------------------------------

export function renderEvaluation(task: string): string {
  return `Answer the following as you would any assignment. Be specific and show the basis for anything you assert.

${task}`;
}
