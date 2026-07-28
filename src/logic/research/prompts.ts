/**
 * Prompt builders — ported from the owner's research console.
 *
 * The prompt text IS the instrument. Each builder encodes what the owner wants
 * a model held to: primary sources only, NOT FOUND preferred over invention,
 * claim layers never blended, and a standing refusal to let internal
 * organisational data reach a third party. research.prompts.test.ts diffs the
 * output of every builder against the console's own output for a synthetic
 * project, so a paraphrase fails the suite.
 *
 * prScope is the one addition; see its own comment.
 */
import type { ResearchProject, ResearchSettings } from '../../data/types';
import { templateOf } from './templates';
import { LOOPS, LOOP_KEYS } from './loops';
import {
  critIND,
  curStage,
  dueLoops,
  gatePass,
  loopDue,
  monthsSince,
  cyclesOf,
  staleItems,
} from './pipeline';
import { normaliseName } from './portfolio';

export const RULES = `RULES
1. Sources must be primary or authoritative: official government and central-bank publications, statistical agencies, regulators, or World Bank / IMF / IEA / IRENA / ADB / OECD, or peer-reviewed journals. Blogs, news aggregators and vendor marketing are not primary.
2. For every figure report: value, unit, reference period ("as of"), publisher, document title, direct URL, date accessed.
3. If you cannot find an authoritative source, write NOT FOUND. Do not estimate, do not interpolate, do not cite from memory, do not invent a URL. NOT FOUND is a useful answer.
4. If sources disagree, report the range and each source separately. Never silently average.
5. State the definition behind each number: coverage, base year, whether taxes are included, which class or scope.
6. Flag if the most recent available figure is older than 12 months.
7. Separate what the source says from what you infer. Label inference as INFERENCE.`;

export const OUTFMT = `OUTPUT FORMAT (strict)
Table: item | value | unit | as_of | publisher | document | url | accessed | confidence(H/M/L)
Then per item three bullets: definition and coverage caveat · what a sceptical reviewer would attack · what to check next.`;

/** Today as YYYY-MM-DD. Injectable so prompt output is testable. */
function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Context brief
// ---------------------------------------------------------------------------

export function prBrief(project: ResearchProject): string {
  const template = templateOf(project.meta.template);
  const stage = template.stages[curStage(project)];
  const baseline =
    project.claims
      .filter((claim) => claim.layer === 'a')
      .map((claim, index) => ` ${index + 1}. ${claim.text}`)
      .join('\n') || ' (none recorded)';
  const hypotheses =
    project.claims
      .filter((claim) => claim.layer === 'c')
      .map((claim, index) => ` ${index + 1}. ${claim.text}`)
      .join('\n') || ' (none recorded)';

  return `CONTEXT BRIEF — paste this first in a new session, then send the task prompt separately.

PROJECT: ${project.project.title}
RESEARCH QUESTION: ${project.meta.question}
TARGET OUTPUT: ${project.meta.output || '—'}
AUDIENCE: ${project.meta.audience || '—'}
METHOD FAMILY: ${template.name} — ${template.desc}
CURRENT STAGE: ${stage.n} ${stage.t}

BASELINE CLAIMS ALREADY IN USE (treat as claims to verify, not as given truth)
${baseline}

WORKING HYPOTHESES (mine, unverified — do not treat as established)
${hypotheses}

CLAIM DISCIPLINE — tag every statement you produce
 (a) baseline fact already in use · (b) newly verified finding with source · (c) hypothesis or inference
Never blend layers in one sentence.

${RULES}

CONSTRAINTS
- Do not ask for or assume internal organisational data. All case detail in this project is public or stylized.
- If something you find contradicts a baseline claim above, say so explicitly and prominently. Do not smooth it over.
- Reply "brief received" and wait for the task prompt.`;
}

// ---------------------------------------------------------------------------
// Verification batches
// ---------------------------------------------------------------------------

interface BlockItem {
  name: string;
  unit: string;
  crit: boolean;
  note: string;
  /** Only set on the consolidated cross-project batch. */
  where?: string;
}

function itemBlock(items: BlockItem[]): string {
  return items
    .map(
      (item, index) =>
        `${index + 1}. ${item.name} — expected unit: ${item.unit || 'n/a'}${
          item.crit ? ' [CRITICAL]' : ''
        }${item.note ? `\n   note: ${item.note}` : ''}${
          item.where ? `\n   needed by: ${item.where}` : ''
        }`,
    )
    .join('\n');
}

export function prBatch(project: ResearchProject): string {
  const pending = project.items.filter((item) => item.status === 'IND');
  if (pending.length === 0) return 'Tidak ada item IND di riset ini.';
  return `TASK — verify a batch of items for the research project below. Work item by item, skip none.

PROJECT: ${project.project.title}
QUESTION: ${project.meta.question}

ITEMS (${pending.length})
${itemBlock(pending)}

${RULES}

${OUTFMT}

At the end: list what you could not verify, ranked by how much damage the gap does to the project's central question.`;
}

/** Merges duplicate names across every non-done project — verify each once. */
export function prAllBatch(projects: ResearchProject[]): string {
  const byName = new Map<string, BlockItem & { whereList: string[] }>();
  for (const research of projects) {
    if (research.project.status === 'done') continue;
    for (const item of research.items) {
      if (item.status !== 'IND') continue;
      const key = normaliseName(item.name);
      const existing = byName.get(key);
      if (existing) {
        existing.crit = existing.crit || item.crit;
        existing.whereList.push(research.project.title);
      } else {
        byName.set(key, {
          name: item.name,
          unit: item.unit,
          crit: item.crit,
          note: item.note,
          whereList: [research.project.title],
        });
      }
    }
  }
  const list = [...byName.values()]
    .map((item) => ({ ...item, where: item.whereList.join('; ') }))
    .sort((a, b) => Number(b.crit) - Number(a.crit));
  if (list.length === 0) return 'Tidak ada item IND di seluruh riset.';
  return `TASK — verify a consolidated batch of items spanning several research projects. Duplicates across projects have been merged: verify each item once.

ITEMS (${list.length})
${itemBlock(list)}

${RULES}

${OUTFMT}

At the end: flag any item where the correct value depends on the project context (different definition needed for different projects) — that means it should not be merged and I need to split it.`;
}

// ---------------------------------------------------------------------------
// Review-loop prompts
// ---------------------------------------------------------------------------

export function prData(
  project: ResearchProject,
  settings: ResearchSettings,
  now: Date = new Date(),
): string {
  const verified = project.items.filter((item) => item.status === 'V');
  const stale = staleItems(project, settings, now);
  if (verified.length === 0) {
    return 'Belum ada item berstatus V di riset ini, jadi belum ada yang perlu di-review. Jalankan verifikasi dulu.';
  }
  const body = verified
    .map(
      (item, index) => `${index + 1}. ${item.name}
   recorded value: ${item.value || '(not recorded)'} ${item.unit || ''}
   recorded source: ${item.source || '(not recorded)'}
   recorded as_of: ${item.asof || '(not recorded)'}${
     item.note ? `\n   caveat on file: ${item.note}` : ''
   }${
        monthsSince(item.asof, now) > settings.staleMonths
          ? `   [STALE — older than ${settings.staleMonths} months]`
          : ''
      }`,
    )
    .join('\n');

  return `TASK — data review cycle. These items were verified earlier. Re-check each one against its source AS IT STANDS TODAY. Do not trust my notes.

ITEMS (${verified.length})
${body}
${stale.length ? `\nPRIORITISE the ${stale.length} items flagged STALE.` : ''}

CHECK EACH ITEM ON
1. Accuracy — does the source still show this value? Quote the figure as it appears now.
2. Timeliness — is there a newer release? If yes, give the new figure and its date. If no newer release exists, say so explicitly.
3. Completeness — is anything I recorded as a single number actually a range, a class, or conditional?
4. Conformance — do unit, coverage and base year match what I recorded?
5. Plausibility — sanity-check against one independent comparator and say whether it agrees.
6. Definition drift — has the publisher changed the definition, classification, or methodology between my as_of and now? This is the failure that does the most damage and is the easiest to miss.

${RULES}

OUTPUT
Table: item | recorded | current | changed? (yes/no/unknown) | new as_of | url | accessed | severity of change (none / minor / material)
Then: the items where a change would force me to redo analysis, ranked. Then: the items you could not re-verify and why.`;
}

export function prCite(project: ResearchProject): string {
  const claims = project.claims.filter(
    (claim) => claim.layer === 'b' || claim.layer === 'a',
  );
  const sourceTypes = ['paper', 'dokumen', 'baseline'];
  const sources = project.items.filter((item) => sourceTypes.includes(item.type));
  return `TASK — citation review cycle. Judge whether each source actually SUBSTANTIATES the claim attached to it. This is not a formatting check.

Background for calibration: meta-analyses of quotation accuracy find roughly one in six citations does not support the claim it is attached to, and about half of those are major errors. Assume errors are present and find them.

CLAIM–SOURCE PAIRS (${claims.length})
${
    claims.length
      ? claims
          .map(
            (claim, index) => `${index + 1}. CLAIM [${claim.layer}]: ${claim.text}
   ATTACHED EVIDENCE: ${claim.ev || '(none recorded — this alone is a finding)'}`,
          )
          .join('\n')
      : '(no claims recorded yet)'
  }

SOURCES ON FILE (${sources.length})
${
    sources.length
      ? sources
          .map(
            (item, index) =>
              `${index + 1}. ${item.name} — ${item.source || '(no source recorded)'} ${
                item.value ? `| recorded content: ${item.value}` : ''
              }`,
          )
          .join('\n')
      : '(none)'
  }

FOR EACH PAIR, CLASSIFY
- OK — source directly supports the claim.
- MAJOR ERROR — source fails to substantiate, is unrelated to, or contradicts the claim.
- MINOR ERROR — source supports a weaker or narrower version; the claim oversimplifies or overgeneralises.
- INDIRECT CITATION — the cited work is itself citing someone else; name the primary source I should cite instead.
- UNVERIFIABLE — you could not obtain the source. Say so; do not guess.

For every error: quote the passage in the source that settles it, give the URL, and write the narrowest reformulation of my claim that the source does support.

RULES
- Judge against the source text, not against plausibility. A claim can be true and still be a citation error.
- Do not invent page numbers or DOIs. If metadata is unavailable, write NOT FOUND.
- Flag any claim labelled (b) whose evidence is a secondary summary rather than the primary document.

CLOSE WITH: which claims should be demoted from (b) to (c) because no source on file supports them.`;
}

export function prMethod(project: ResearchProject): string {
  const template = templateOf(project.meta.template);
  const stage = template.stages[curStage(project)];
  const hypotheses =
    project.claims
      .filter((claim) => claim.layer === 'c')
      .map((claim, index) => `${index + 1}. ${claim.text}`)
      .join('\n') || '(none recorded)';
  const log =
    project.log
      .slice(-12)
      .map((entry) => `- ${entry.date}: ${entry.text}`)
      .join('\n') || '(empty)';

  return `TASK — methodology review cycle. Red-team this research design. Your job is to find the choices that could flip the conclusion, not to endorse the approach.

PROJECT: ${project.project.title}
QUESTION: ${project.meta.question}
METHOD FAMILY: ${template.name} — ${template.desc}
CURRENT STAGE: ${stage.n} ${stage.t}

WORKING HYPOTHESES
${hypotheses}

DECISION LOG (what I have already decided and why)
${log}

Background for calibration: when many independent teams analyse the same data for the same hypothesis, results diverge widely and most of the variance cannot be explained even after coding every identifiable analytic decision. I work alone, so I have no comparison analysts. Substitute for them.

DELIVER
1. Enumerate the researcher degrees of freedom in this design: specification choices, variable operationalisations, sample boundaries, distributional assumptions, outlier handling, aggregation levels. Be exhaustive; include the ones I have not mentioned.
2. For each, state the plausible alternative choice and whether taking it could reverse the conclusion.
3. Circularity audit: identify anything in the design that makes my hypothesis mechanically likely to win. Quote the specific assumption.
4. Name the value-laden assumptions being presented as technical ones.
5. Conceptual validation: is the model structure appropriate for the stated PURPOSE of use, not merely consistent with the data?
6. Propose the minimum multiverse or specification-curve I should report instead of a single preferred specification, and what its axes should be.
7. Say which stage of the pipeline my findings should send me back to, if any, and why.

Be blunt. If the design cannot answer the question as posed, say that first.`;
}

// ---------------------------------------------------------------------------
// Literature and adversarial passes
// ---------------------------------------------------------------------------

export function prLit(project: ResearchProject): string {
  return `TASK — literature pass for the project below. Return only real, checkable papers.

PROJECT: ${project.project.title}
QUESTION: ${project.meta.question}
METHOD FAMILY: ${templateOf(project.meta.template).name}

Break the question into 4–6 distinct literatures and treat each separately. State the breakdown before you search.

FOR EACH PAPER
authors | year | title | journal or working-paper series | DOI or stable URL | one sentence on the finding | one sentence on relevance to the question | supports or complicates my hypotheses.

RULES
- Only papers you can actually locate. No invented titles, no invented DOIs, no "commonly cited" placeholders. If a strand is thin, say the literature is thin — that is itself a finding.
- Put papers that CONTRADICT my working hypotheses first.
- Mark each entry (b) if verified against a real record, (c) if it is recollection or inference.
- Name the two most relevant journals and the two most relevant research groups for this question.`;
}

export function prContra(project: ResearchProject): string {
  const baseline = project.claims.filter((claim) => claim.layer === 'a');
  const hypotheses = project.claims.filter((claim) => claim.layer === 'c');
  return `TASK — adversarial check. Your job is to attack these claims, not support them.

For each: the strongest counter-evidence, its source with URL, how damaging it is (fatal / needs qualification / cosmetic), and the narrowest reformulation that would survive.

BASELINE CLAIMS
${baseline.map((claim, index) => `${index + 1}. ${claim.text}`).join('\n') || '(none)'}

MY HYPOTHESES
${
    hypotheses
      .map((claim, index) => `${baseline.length + index + 1}. ${claim.text}`)
      .join('\n') || '(none)'
  }

RULES
- Do not be polite. If a figure is definitionally shaky (different scope, different base year, different definition), say so and give the alternative figure.
- Separate "the number is wrong" from "the number is right but the inference is wrong".
- Sources must be primary or peer-reviewed, with URLs. NOT FOUND is acceptable; invention is not.

Close with: the three sentences in my framing most likely to be attacked first in a seminar, and why.`;
}

// ---------------------------------------------------------------------------
// Handover and digest
// ---------------------------------------------------------------------------

export function prHand(
  project: ResearchProject,
  settings: ResearchSettings,
  now: Date = new Date(),
): string {
  const template = templateOf(project.meta.template);
  const lines: string[] = [];
  const p = project.project;
  lines.push(`HANDOVER — ${p.title}`);
  lines.push(
    `Snapshot ${todayKey(now)} · template: ${template.name} · status: ${p.status} · prioritas ${
      p.priority ?? ''
    }${p.deadline ? ` · tenggat ${p.deadline}` : ''}`,
  );
  lines.push('');
  lines.push(`RQ: ${project.meta.question}`);
  lines.push(`Output: ${project.meta.output || '—'} · Audiens: ${project.meta.audience || '—'}`);
  lines.push('');
  lines.push('STATUS GATE');
  template.stages.forEach((stage, index) => {
    const gate = project.meta.gates[index] ?? [];
    lines.push(
      `  ${stage.n} ${stage.t} — ${gate.filter(Boolean).length}/${stage.g.length}${
        gatePass(project, index) ? ' — LULUS' : ''
      }`,
    );
    stage.g.forEach((criterion, j) => {
      if (!gate[j]) lines.push(`      [ ] ${criterion}`);
    });
  });
  const counts = { V: 0, IND: 0, NA: 0 };
  project.items.forEach((item) => {
    counts[item.status] += 1;
  });
  lines.push('');
  lines.push(
    `REGISTER — V:${counts.V} IND:${counts.IND} NA:${counts.NA} dari ${project.items.length}`,
  );
  lines.push('Kritikal masih IND:');
  const critical = critIND(project);
  if (critical.length === 0) lines.push('  (tidak ada)');
  critical.forEach((item) => lines.push(`  - ${item.name}`));
  lines.push('Terverifikasi:');
  const verified = project.items.filter((item) => item.status === 'V');
  if (verified.length === 0) lines.push('  (belum ada)');
  verified.forEach((item) =>
    lines.push(
      `  - ${item.name} = ${item.value || '(nilai belum diisi)'} | ${
        item.source || '(sumber belum diisi)'
      } | as of ${item.asof || '-'}${item.note ? ` | ${item.note}` : ''}`,
    ),
  );
  lines.push('');
  lines.push('LOOP REVIEW');
  LOOP_KEYS.forEach((loop) => {
    const due = loopDue(project, loop, settings, now);
    const cycles = cyclesOf(project, loop);
    const last = cycles.at(-1);
    lines.push(
      `  ${LOOPS[loop].name}: ${cycles.length} siklus · ${
        due.due ? 'JATUH TEMPO' : 'bersih'
      } — ${due.why}`,
    );
    if (last && last.verdict === 'rework') {
      lines.push(
        `      siklus terakhir rework → stage ${last.backLabel}${
          last.invalidated ? `, ${last.invalidated} gate dibatalkan` : ''
        }`,
      );
    }
    if (last && last.findings) lines.push(`      temuan terakhir: ${last.findings}`);
  });
  const stale = staleItems(project, settings, now);
  if (stale.length > 0) {
    lines.push(`  Item V melewati batas kebasian ${settings.staleMonths} bulan:`);
    stale.forEach((item) =>
      lines.push(`      - ${item.name} (as of ${item.asof || 'tidak dicatat'})`),
    );
  }
  lines.push('');
  lines.push('LEDGER KLAIM');
  project.claims.forEach((claim) =>
    lines.push(`  (${claim.layer}) ${claim.text}${claim.ev ? `  [bukti: ${claim.ev}]` : ''}`),
  );
  lines.push('');
  lines.push('LOG KEPUTUSAN');
  project.log.forEach((entry) => lines.push(`  ${entry.date} — ${entry.text}`));
  lines.push('');
  lines.push('ATURAN YANG BERLAKU');
  lines.push('  - Tiga lapis klaim (a)/(b)/(c), jangan dicampur.');
  lines.push('  - Tidak ada item IND yang boleh masuk teks atau grafik.');
  lines.push('  - Data internal organisasi tidak masuk output kecuali sudah publik.');
  lines.push('  - Temuan yang berkontradiksi dengan tulisan sebelumnya di-flag eksplisit.');
  lines.push('  - Desain harus mengizinkan hipotesis ditolak. Kalau selalu menang, itu circular.');
  return lines.join('\n');
}

export function prDigest(
  projects: ResearchProject[],
  settings: ResearchSettings,
  now: Date = new Date(),
): string {
  const lines: string[] = [];
  lines.push(`DIGEST PORTFOLIO RISET — ${todayKey(now)}`);
  lines.push(
    `Aktif: ${
      projects.filter((item) => item.project.status === 'active').length
    } dari ${projects.length} · batas WIP: ${settings.wipLimit}`,
  );
  lines.push('');
  projects.forEach((research) => {
    const template = templateOf(research.meta.template);
    const index = curStage(research);
    const action = nextActionText(research);
    const critical = critIND(research).length;
    const p = research.project;
    lines.push(`[${p.status.toUpperCase()} · p${p.priority ?? ''}] ${p.title}`);
    lines.push(
      `   template ${template.name} · posisi stage ${template.stages[index].n} ${template.stages[index].t}`,
    );
    lines.push(
      `   register: ${
        research.items.filter((item) => item.status === 'V').length
      }/${research.items.length} V${critical ? ` · ${critical} kritikal IND` : ''}`,
    );
    lines.push(`   aksi berikutnya: ${action}`);
    const due = dueLoops(research, settings, now);
    lines.push(
      `   loop: ${LOOP_KEYS.map(
        (loop) =>
          `${LOOPS[loop].name.replace('Review ', '')} ${cyclesOf(research, loop).length}x${
            loopDue(research, loop, settings, now).due ? ' (jatuh tempo)' : ''
          }`,
      ).join(' · ')}`,
    );
    if (due.length > 0) {
      lines.push(
        `   review jatuh tempo: ${due
          .map((loop) => `${LOOPS[loop].name} — ${loopDue(research, loop, settings, now).why}`)
          .join(' | ')}`,
      );
    }
    if (p.deadline) lines.push(`   tenggat: ${p.deadline}`);
    lines.push('');
  });
  const dup = new Map<string, string[]>();
  projects.forEach((research) =>
    research.items
      .filter((item) => item.status === 'IND')
      .forEach((item) => {
        const key = normaliseName(item.name);
        dup.set(key, [...(dup.get(key) ?? []), research.project.title]);
      }),
  );
  const shared = [...dup.entries()].filter(([, list]) => list.length > 1);
  if (shared.length > 0) {
    lines.push('VERIFIKASI YANG BISA DIGABUNG (satu kerja, beberapa riset)');
    shared.forEach(([key, list]) => lines.push(`  - ${key} → ${list.join(', ')}`));
  }
  return lines.join('\n');
}

/** Kept local so prDigest matches the console's inlined use of nextAction. */
function nextActionText(project: ResearchProject): string {
  const index = curStage(project);
  const stage = templateOf(project.meta.template).stages[index];
  const gate = project.meta.gates[index] ?? [];
  const firstOpen = gate.findIndex((checked) => !checked);
  if (firstOpen < 0) return 'Semua gate lulus — riset ini siap ditandai done.';
  return stage.g[firstOpen];
}

// ---------------------------------------------------------------------------
// prScope — the one addition, not in the console
// ---------------------------------------------------------------------------

/**
 * A cold-start sweep for a raw research question, BEFORE any pipeline exists.
 *
 * Deliberately takes a bare string rather than a project: its whole purpose is
 * to run before stage 00, when there is nothing to attach to, and to help pick
 * which of the five templates the question even belongs to.
 *
 * The four asks are ordered on purpose. "Is this answerable as posed" comes
 * first because it is the answer that saves the most wasted work — everything
 * after it is moot if the question cannot be answered as written.
 */
export function prScope(question: string, output?: string, audience?: string): string {
  return `TASK — cold-start scoping sweep for a research question that has no pipeline yet. Answer the four sections in the order given.

RESEARCH QUESTION (raw, as drafted)
${question}
TARGET OUTPUT: ${output || '—'}
AUDIENCE: ${audience || '—'}

1. IS THE QUESTION ANSWERABLE AS POSED?
Answer this first and plainly. If it is not answerable as written, give the narrowest reformulation that is, and say what makes the original unanswerable: undefined scope, no observable outcome, no accessible data, or a causal claim the available variation cannot support. If it is answerable, say what makes it so.

2. RECENT LITERATURE — prioritise the last five years
authors | year | title | venue | DOI or stable URL | one line on the finding | one line on relevance to this question | supports or complicates the question.
List papers that COMPLICATE the question FIRST. A thin literature is a finding — say so rather than padding.

3. PUBLIC DATASETS THAT COULD SUPPLY THE PARAMETERS
publisher | coverage | period available | access URL | licence | whether registration or payment is required | update frequency.
Say explicitly where no public dataset exists for a parameter the question needs.

4. METHODOLOGICAL APPROACHES USED IN THAT LITERATURE
For each approach: what it does, what it requires, and which of these five method families it maps to —
 sim    — simulation and uncertainty exploration (thresholds, not point estimates)
 emp    — empirical / econometric (causal effects from existing data)
 slr    — systematic literature review (what is already known)
 policy — case study and policy instrument design
 min    — generic minimal (small or early-stage work)
End with ONE recommended template and why, plus the strongest reason NOT to choose it.

${RULES}

CONSTRAINTS
- Do not ask for or assume internal organisational data. Any case detail is public or stylized.
- Tag everything you produce: (b) if verified against a record you opened, (c) if it is recollection or inference. Nothing here is (a).
- This output SEEDS a pipeline but verifies nothing. Every dataset and paper you return arrives as an unverified register item; every finding arrives as a layer (c) claim. Do not present anything as established.`;
}
