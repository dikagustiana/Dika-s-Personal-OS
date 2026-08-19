/**
 * What it MEANS when a workflow omits a canonical station — one line per
 * stage, DERIVED from the gate that will actually refuse, not hardcoded
 * prose per station.
 *
 * Derivation, literally: for every stage whose omission runs into a
 * database gate, this module CALLS the same client-side gate mirror the
 * mutation path runs (labEvidenceGuards), hands it the minimal state the
 * omission leaves behind (an IND datapoint, an abstract-only reference, an
 * unapproved claim, an unsatisfied requirement, an unbacked number), and
 * quotes the gate's own refusal inside the sentence. If a gate's wording
 * or logic changes, these lines follow it — they cannot silently drift,
 * and labFlowOmissions.test.ts pins the pairing.
 *
 * Stages with NO refusing gate say so explicitly — "tidak ada gerbang yang
 * menolak" — and name what is lost instead. Pretending a gate exists would
 * be the same dishonesty inverted.
 *
 * WHY THIS IS ONLY PROSE: workflows cannot weaken any guarantee. The gates
 * live in the database (os_lab_claims_gate_guard, os_lab_outputs_gate_guard,
 * …) and are not workflow-scoped; a route that skips S5 does not permit an
 * IND datapoint under an approved claim — it just meets the refusal later.
 * The one risk a route adds is a complete-LOOKING workshop, and that is a
 * rendering problem, solved here with words.
 */
import type { LabClaim, LabDatapoint, LabReference } from '../../data/labEvidenceTypes';
import {
  claimApprovalBlockers,
  formatNumberViolations,
  guardDatapointWrite,
  guardOutputContent,
  outputFinalizeBlockers,
} from '../../data/labEvidenceGuards';

// --- the minimal states an omission leaves behind ---------------------------

const DP_IND: LabDatapoint = {
  id: '(datapoint IND)',
  value: 0,
  unit: '',
  year: null,
  geography: '',
  definitionScope: 'contoh: datapoint yang belum pernah di-source-match',
  sourceDocumentId: '(source)',
  locator: 'p.1',
  retrievedAt: '2026-01-01T00:00:00Z',
  status: 'IND',
  verificationNote: '',
  verifiedAt: null,
  volatilityClass: 'static',
  extractionMethod: 'manual',
  internalCheckPassed: null,
};

const REF_ABSTRACT: LabReference = {
  id: '(referensi abstract_only)',
  title: '',
  authors: '',
  container: '',
  publicationYear: null,
  doi: '',
  url: '',
  verificationLevel: 'abstract_only',
  fullTextPath: '',
};

function claimWith(input: Partial<LabClaim>): LabClaim {
  return {
    id: '(klaim)',
    projectId: '(proyek)',
    statement: '',
    layer: 'B',
    commitmentSourceId: null,
    evidenceDirection: 'supports',
    status: 'reviewed',
    approvedByHumanAt: null,
    createdByRunId: null,
    inferenceStep: 'langkah inferensi contoh yang cukup panjang untuk gerbang',
    datapointIds: [],
    referenceIds: [],
    ...input,
  };
}

/** The gate's own words for "a number with nothing behind it". */
function gNumberQuote(content: string): string {
  return formatNumberViolations(guardOutputContent(content, [], []));
}

// --- the derivations, one per omittable station ------------------------------

const derive: Record<string, () => string> = {
  S0: () =>
    'dilewati — tidak ada gerbang yang menolak: tanpa pertanyaan terbingkai tidak ada sub-pertanyaan, jadi G-FALSIFY tidak pernah dapat kesempatan menggigit dan cakupan tidak pernah terukur.',
  S1: () => {
    const [reason] = outputFinalizeBlockers({
      stale: false,
      citedClaims: [],
      contradictions: [],
      addressedSubQuestionIds: ['(sub-pertanyaan)'],
      requirements: [],
    });
    return `dilewati — output yang mengalamatkan sub-pertanyaan akan ditolak finalize. Gerbangnya: ${reason}`;
  },
  S2: () =>
    'dilewati — tidak ada gerbang yang menolak: yang berkurang cakupan sumber (kandidat, snapshot), bukan kebenaran; tier tetap dihitung untuk apa pun yang masuk.',
  S3: () => {
    try {
      guardDatapointWrite({
        value: 1,
        unit: '',
        year: null,
        geography: '',
        definitionScope: 'contoh definition scope yang cukup panjang',
        sourceDocumentId: '(source)',
        locator: '',
        volatilityClass: 'static',
        extractionMethod: 'manual',
      });
      return 'dilewati — tidak ada gerbang yang menolak.';
    } catch (error) {
      return `dilewati — locator tetap wajib di setiap datapoint; tanpa stage ini kamu menunjuknya manual. Gerbangnya: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  S4: () =>
    `dilewati — tanpa datapoint, setiap angka di output ditolak. Gerbangnya: ${gNumberQuote('Kapasitas 9100 unit.')}`,
  S5: () => {
    const [reason] = claimApprovalBlockers({
      claim: claimWith({ datapointIds: [DP_IND.id] }),
      datapoints: [DP_IND],
      references: [],
      conflicts: [],
    });
    return `dilewati — klaim tidak akan bisa disetujui selama datapoint masih IND. Gerbangnya: ${reason}`;
  },
  S6: () => {
    const [reason] = claimApprovalBlockers({
      claim: claimWith({ referenceIds: [REF_ABSTRACT.id] }),
      datapoints: [],
      references: [REF_ABSTRACT],
      conflicts: [],
    });
    return `dilewati — klaim yang mengutip referensi abstract_only tidak akan bisa disetujui. Gerbangnya: ${reason}`;
  },
  S7: () =>
    `dilewati — tanpa hasil model yang lolos check, tag [sim:<id>] tidak punya penopang. Gerbangnya: ${gNumberQuote('Proyeksi 42 unit [sim:deadbeef42].')}`,
  S8: () => {
    const [reason] = outputFinalizeBlockers({
      stale: false,
      citedClaims: [claimWith({ status: 'draft' })],
      contradictions: [],
    });
    return `dilewati — tidak ada klaim, jadi tidak ada output: drafter menolak di 0 klaim approved, dan finalize menolak kutipan yang belum approved. Gerbangnya: ${reason}`;
  },
  S9: () =>
    'dilewati — tidak ada gerbang yang menolak: kontradiksi hanya memblokir approve kalau TERCATAT, dan tanpa review tidak ada yang mencatatnya. Risiko ditanggung, bukan dihilangkan.',
  S10: () => {
    const [reason] = outputFinalizeBlockers({
      stale: false,
      citedClaims: [claimWith({ status: 'reviewed' })],
      contradictions: [],
    });
    return `dilewati — tanpa approve tidak ada klaim yang bisa dikutip sampai final. Gerbangnya: ${reason}`;
  },
  S11: () =>
    'dilewati — tidak ada gerbang yang menolak: tanpa draf tidak ada objek untuk finalize, jadi gerbang S12 tidak pernah dihadapi.',
  S12: () =>
    'dilewati — output tetap draft selamanya; tidak ada yang menjadi final, dan gerbang finalize (sweep, klaim approved, G-NUMBER ulang) tidak pernah dilewati.',
};

const cache = new Map<string, string>();

/** One line: what omitting this station means, quoting the refusing gate. */
export function omittedConsequence(code: string): string {
  const held = cache.get(code);
  if (held) return held;
  const line = derive[code]?.() ?? 'dilewati — bukan bagian workflow ini.';
  cache.set(code, line);
  return line;
}
