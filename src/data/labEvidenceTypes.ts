/**
 * The epistemic layer's domain types. camelCase, hand-written, mapped by
 * hand in labEvidenceRepository — same contract as labTypes.ts.
 *
 * The scoping rule these types carry: DATAPOINTS ARE SHARED ACROSS PROJECTS
 * (a national statistic is one fact however many papers cite it); claims,
 * outputs and commitments are project-scoped. The same datapoint may
 * support different, even opposing, claims in different projects.
 */

export type LabProjectStatus = 'active' | 'dormant' | 'closed';

export interface LabProject {
  id: string;
  name: string;
  researchQuestion: string;
  status: LabProjectStatus;
  wipSlot: number | null;
}

export type LabDocType =
  | 'government_report'
  | 'multilateral_report'
  | 'journal_article'
  | 'statute'
  | 'dataset'
  | 'corporate_filing'
  | 'news';

export interface LabSourceDocument {
  id: string;
  title: string;
  publisher: string;
  publicationDate: string | null;
  docType: LabDocType;
  url: string;
  /** Mandatory: the snapshot is the citable artifact; the URL is a courtesy. */
  localSnapshotPath: string;
  snapshotHash: string;
  retrievedAt: string;
  /** Recheck bookkeeping (081). The flag means the PAGE changed — never the figure. */
  lastRecheckedAt: string | null;
  contentChangedAt: string | null;
}

// ---------------------------------------------------------------------------
// Curation (SCOUT, 081). Candidates carry title/publisher/url/date — and
// structurally CANNOT carry notes, summaries or relevance: no columns exist.
// ---------------------------------------------------------------------------

export type LabCandidateStatus = 'candidate' | 'promoted' | 'dismissed';

export interface LabCandidateSource {
  id: string;
  projectId: string | null;
  title: string;
  publisher: string;
  url: string;
  claimedDate: string | null;
  /** Trigger-computed from the owner's allowlist. 3 = unknown publisher. */
  tier: 1 | 2 | 3;
  status: LabCandidateStatus;
  promotedSourceDocumentId: string | null;
  createdByRunId: string | null;
}

/** IND = extracted, unverified. V = verified. NA = sought, not available. */
export type LabDatapointStatus = 'IND' | 'V' | 'NA';
export type LabVolatility = 'static' | 'slow' | 'volatile';
export type LabExtractionMethod = 'manual' | 'agent_from_selected_text' | 'agent_from_full_pdf';

export interface LabDatapoint {
  id: string;
  value: number;
  unit: string;
  year: number | null;
  geography: string;
  /** The exact concept measured — min 20 chars, enforced by G-EXTRACT. */
  definitionScope: string;
  sourceDocumentId: string;
  /** Page, table number, or section identifier. */
  locator: string;
  retrievedAt: string;
  status: LabDatapointStatus;
  verificationNote: string;
  /** Guard-stamped when V is granted; drives G-STALE. */
  verifiedAt: string | null;
  volatilityClass: LabVolatility;
  extractionMethod: LabExtractionMethod;
  internalCheckPassed: boolean | null;
}

export interface LabDatapointWrite {
  value: number;
  unit: string;
  year: number | null;
  geography: string;
  definitionScope: string;
  sourceDocumentId: string;
  locator: string;
  volatilityClass: LabVolatility;
  extractionMethod: LabExtractionMethod;
  /** IND (default) or NA; V is unreachable at insert by design. */
  status?: 'IND' | 'NA';
}

export type LabConflictType = 'value_mismatch' | 'definition_mismatch' | 'vintage_mismatch';
export type LabConflictResolution =
  | 'unresolved'
  | 'resolved_prefer_a'
  | 'resolved_prefer_b'
  | 'resolved_both_valid';

export interface LabDatapointConflict {
  id: string;
  datapointAId: string;
  datapointBId: string;
  conflictType: LabConflictType;
  resolutionStatus: LabConflictResolution;
  resolutionNote: string;
}

export type LabReferenceLevel = 'abstract_only' | 'full_text_read';

export interface LabReference {
  id: string;
  title: string;
  authors: string;
  container: string;
  publicationYear: number | null;
  doi: string;
  url: string;
  verificationLevel: LabReferenceLevel;
  fullTextPath: string;
}

export type LabCommitmentType =
  | 'essay'
  | 'published_paper'
  | 'submitted_proposal'
  | 'public_presentation'
  | 'funder_document';

export interface LabCommitmentSource {
  id: string;
  projectId: string;
  title: string;
  type: LabCommitmentType;
  committedAt: string;
  documentPath: string;
}

/**
 * A = committed in a commitment_source; frozen until that commitment is
 *     explicitly revised (a document act, not a database update).
 * B = verified finding produced in this research.
 * C = researcher hypothesis or inference — usually where the contribution
 *     lives. Not lesser; the rule is only that the three never blend in an
 *     output.
 */
export type LabClaimLayer = 'A' | 'B' | 'C';
export type LabEvidenceDirection = 'supports' | 'mixed' | 'contradicts' | 'untested';
export type LabClaimStatus = 'draft' | 'reviewed' | 'approved';

export interface LabClaim {
  id: string;
  projectId: string;
  statement: string;
  layer: LabClaimLayer;
  commitmentSourceId: string | null;
  evidenceDirection: LabEvidenceDirection;
  status: LabClaimStatus;
  /** Guard-stamped on approval; no client and no agent writes it. */
  approvedByHumanAt: string | null;
  /** The execution-layer run this claim came out of, when it did. */
  createdByRunId: string | null;
  /**
   * The step from evidence to statement. Approval requires it (min 20
   * chars) for layer B, and for layer C — where the step IS the
   * contribution. Rendered inline with the layer tag, never implied.
   */
  inferenceStep: string;
  datapointIds: string[];
  referenceIds: string[];
}

export interface LabClaimWrite {
  projectId: string;
  statement: string;
  layer: LabClaimLayer;
  commitmentSourceId: string | null;
  evidenceDirection: LabEvidenceDirection;
  inferenceStep?: string;
  createdByRunId?: string | null;
}

export type LabContradictionSeverity = 'direct' | 'tension' | 'scope_difference';

export interface LabClaimContradiction {
  id: string;
  claimAId: string;
  claimBId: string;
  severity: LabContradictionSeverity;
  status: 'open' | 'resolved';
  resolutionNote: string;
}

export type LabOutputType =
  | 'paper_section'
  | 'essay_section'
  | 'literature_note'
  | 'data_comparison'
  | 'briefing'
  | 'annotated_bibliography';

/** A coordinator delegation — the COORDINATOR's entire write scope. */
export interface LabTask {
  id: string;
  projectId: string | null;
  title: string;
  agentSlug: string;
  input: string;
  status: 'queued' | 'running' | 'done' | 'error';
  detail: string;
  runId: string | null;
  createdAt: string;
}

export interface LabOutput {
  id: string;
  projectId: string;
  outputType: LabOutputType;
  content: string;
  status: 'draft' | 'final';
  /** Cascade-set when supporting evidence loses V; cleared only by hand. */
  stale: boolean;
  generatedByRunId: string | null;
  claimIds: string[];
  /** Which sub-questions this output claims to address — G-FALSIFY input. */
  subQuestionIds: string[];
}

// ---------------------------------------------------------------------------
// The question layer (FRAMER intake, 080). The framing decided what evidence
// was sought before any gate below could act — so the framing is a record.
// ---------------------------------------------------------------------------

/**
 * owner_written = the owner typed the framing. owner_selected = the owner
 * picked one of the framer's proposed alternatives — still an owner act;
 * there is no agent_framed and there never will be.
 */
export type LabFramingSource = 'owner_written' | 'owner_selected';

export interface LabQuestion {
  id: string;
  projectId: string;
  /** The owner's original ask, verbatim — frozen at intake by the guard. */
  rawStatement: string;
  framedQuestion: string;
  framingSource: LabFramingSource;
}

export interface LabSubQuestion {
  id: string;
  questionId: string;
  statement: string;
  /** What evidence would show the expected answer is WRONG. Min 20 chars. */
  falsifier: string;
  position: number;
}

export type LabRequirementKind = 'datapoint' | 'reference';

export interface LabEvidenceRequirement {
  id: string;
  subQuestionId: string;
  description: string;
  kind: LabRequirementKind;
  /** Only a source-matched (V) datapoint may land here — G-FALSIFY. */
  satisfiedByDatapointId: string | null;
  /** Only a full_text_read reference may land here — G-FALSIFY. */
  satisfiedByReferenceId: string | null;
  /** Guard-stamped when satisfaction lands. */
  satisfiedAt: string | null;
}

/** One of the framer's 2–3 proposed framings — JSON, never a row. */
export interface LabFramerAlternative {
  framedQuestion: string;
  why: string;
  subQuestions: Array<{ statement: string; falsifier: string }>;
}
