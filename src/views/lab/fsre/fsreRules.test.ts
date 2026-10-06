/**
 * The building's seven rules, checked against the SOURCE, not the screen.
 *
 * A screen test can only see the cases it renders; these parse every FSRE
 * file with the TypeScript compiler and fail on the patterns the rules
 * forbid, so a literal or a colour added next month fails here before it
 * ships. Scope: src/views/lab/fsre/ and src/logic/lab/fsre/, tests and
 * fixtures excluded.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseFsreRun, type FsreRawFiles } from '../../../logic/lab/fsre/data';
import { FLOOR_ZONE_IDS, planFloors } from '../../../logic/lab/fsre/layout';
import { agentStatus, buildContext, gateSummary, partnerItems, reduceEvents, runTotals } from '../../../logic/lab/fsre/reducer';
import { PROVISIONAL_DATA, REAL_DATA, REAL_FILES, UNVR_FILE_NAMES } from '../../../logic/lab/fsre/__fixtures__/fsreFixtures';
import {
  AGENT_STATUSES,
  AGENT_STATUS_WORDS,
  EVENT_KIND_WORDS,
  FIGURE_LABELS,
  FILE_WORDS,
  FOLDER_STATUS_WORDS,
  GATE_RESULT_WORDS,
  ISSUE_STATE_WORDS,
  ITEM_STATE_WORDS,
  PARTNER_KIND_WORDS,
  FOLDER_STATUSES,
  GATE_RESULTS,
  ISSUE_STATES,
  ITEM_STATES,
  PARTNER_ITEM_KINDS,
  STAGE_STATUSES,
  STAGE_STATUS_WORDS,
} from '../../../logic/lab/fsre/statuses';

const here = path.dirname(fileURLToPath(import.meta.url));
const VIEW_DIR = here;
const CORE_DIR = path.resolve(here, '../../../logic/lab/fsre');

function sourceFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.includes('.test.'))
    .map((entry) => path.join(dir, entry.name));
}

const COMPONENTS = sourceFiles(VIEW_DIR, ['.tsx']);
const VIEW_CODE = sourceFiles(VIEW_DIR, ['.ts', '.tsx']);
const CORE_CODE = sourceFiles(CORE_DIR, ['.ts']);
const ALL_CODE = [...VIEW_CODE, ...CORE_CODE];

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

const where = (file: string, node: ts.Node) => {
  const source = node.getSourceFile();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart());
  return `${path.relative(path.resolve(here, '../../../..'), file)}:${line + 1}`;
};

/** Is this node inside a className="…" attribute or a cn(…) call (class lists, not copy)? */
function inClassList(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current) && current.name.getText() === 'className') return true;
    if (ts.isCallExpression(current) && current.expression.getText() === 'cn') return true;
  }
  return false;
}

interface TextToken {
  file: string;
  node: ts.Node;
  text: string;
  classList: boolean;
}

/** Every piece of text a file writes: string and template literals, and JSX text. */
function textTokens(files: string[]): TextToken[] {
  const tokens: TextToken[] = [];
  for (const file of files) {
    walk(parse(file), (node) => {
      if (ts.isImportDeclaration(node.parent ?? node) || ts.isExportDeclaration(node.parent ?? node)) return;
      let text: string | null = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
      else if (ts.isJsxText(node)) text = node.getText();
      if (text !== null && text.trim()) tokens.push({ file, node, text: text.trim(), classList: inClassList(node) });
    });
  }
  return tokens;
}

describe('rule 2: no number literals in components', () => {
  it('finds none in any FSRE component', () => {
    const found: string[] = [];
    for (const file of COMPONENTS) {
      walk(parse(file), (node) => {
        if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) found.push(`${where(file, node)} ${node.getText()}`);
      });
    }
    expect(found).toEqual([]);
  });
});

describe('rule 2: stage ids and names, skill names and tickers come only from the data', () => {
  type Vocabulary = { stages: { stages: Array<{ id: string; name: string; skills: string[] }> }; skills: { skills: Array<{ name: string }> }; replay: { company: { ticker: string } } };
  const namesIn = (data: Vocabulary) => ({
    stageIds: data.stages.stages.map((stage) => stage.id),
    stageNames: data.stages.stages.map((stage) => stage.name),
    skillNames: [...new Set([...data.skills.skills.map((skill) => skill.name), ...data.stages.stages.flatMap((stage) => stage.skills)])],
    tickers: [data.replay.company.ticker],
  });
  const all = (data: Vocabulary) => {
    const names = namesIn(data);
    return new Set([...names.stageIds, ...names.stageNames, ...names.skillNames, ...names.tickers]);
  };

  /**
   * The building's OWN closed vocabularies. Since brief 04 two of their words
   * are also names in the real data: the owner's skill is called `partner`,
   * which is also a floor zone (and the seat the skill data gives it), and
   * the router's last stage is `closed`, which is also an issue state. A
   * text scan cannot tell a zone from a skill, so those two words are pinned
   * here — any NEW collision fails — and the rename test below proves the
   * code depends on no stage or skill NAME, these two included.
   */
  const codeVocabulary = new Set<string>([
    ...FLOOR_ZONE_IDS,
    ...ISSUE_STATES,
    ...ITEM_STATES,
    ...AGENT_STATUSES,
    ...STAGE_STATUSES,
    ...GATE_RESULTS,
    ...FOLDER_STATUSES,
    ...PARTNER_ITEM_KINDS,
  ]);
  const provisional = all(PROVISIONAL_DATA);
  const real = all(REAL_DATA);
  const collisions = [...real].filter((word) => codeVocabulary.has(word)).sort();

  const literalsNaming = (forbidden: Set<string>) =>
    textTokens(ALL_CODE)
      .filter((token) => !token.classList)
      .filter((token) => forbidden.has(token.text) || [...forbidden].some((name) => (name.includes('-') || name === name.toUpperCase()) && new RegExp(`\\b${name}\\b`).test(token.text)))
      .map((token) => `${where(token.file, token.node)} ${JSON.stringify(token.text)}`);

  it('writes no name from the provisional data as a literal anywhere in the view or the core', () => {
    expect(literalsNaming(provisional)).toEqual([]);
  });

  it('writes no name from the real export either, beyond the two words the code owns', () => {
    expect(collisions).toEqual(['closed', 'partner']);
    expect(provisional.has('partner') || provisional.has('closed')).toBe(false);
    expect(literalsNaming(new Set([...real].filter((word) => !collisions.includes(word))))).toEqual([]);
  });

  it('keeps the floor plan free of a second skill list (layout.ts names no skill)', () => {
    const layout = readFileSync(path.join(CORE_DIR, 'layout.ts'), 'utf8');
    const skills = [...namesIn(PROVISIONAL_DATA).skillNames, ...namesIn(REAL_DATA).skillNames].filter((skill) => !collisions.includes(skill));
    for (const skill of skills) expect(layout.includes(`'${skill}'`), skill).toBe(false);
  });

  it('behaves the same when every stage, skill and ticker in the real export is renamed', () => {
    // Gates keep a gate id (the one documented id rule, GATE_STAGE_ID); every
    // other stage id, every stage name, every skill name and the ticker change.
    const stages = REAL_DATA.stages.stages;
    const gateCount = { n: 0 };
    const stageId = new Map(stages.map((stage, i) => [stage.id, /^gate/i.test(stage.id) ? `gate_${(gateCount.n += 1) + 90}` : `stage_${i}`]));
    const stageName = new Map(stages.map((stage, i) => [stage.name, `Renamed stage ${String.fromCharCode(65 + i)}`]));
    const skillNames = [...new Set([...REAL_DATA.skills.skills.map((skill) => skill.name), ...stages.flatMap((stage) => stage.skills)])];
    const skill = new Map(skillNames.map((name, i) => [name, `renamed-skill-${String.fromCharCode(97 + i)}`]));
    const ticker = new Map([[REAL_DATA.replay.company.ticker, 'ZZZZ']]);
    const map = <T,>(m: Map<T, T>, value: T) => m.get(value) ?? value;
    const renamed: FsreRawFiles = {
      stages: { ...REAL_DATA.stages, stages: stages.map((st) => ({ ...st, id: map(stageId, st.id), name: map(stageName, st.name), skills: st.skills.map((x) => map(skill, x)) })) },
      skills: { ...REAL_DATA.skills, skills: REAL_DATA.skills.skills.map((x) => ({ ...x, name: map(skill, x.name) })) },
      replay: {
        ...REAL_DATA.replay,
        company: { ...REAL_DATA.replay.company, ticker: 'ZZZZ' },
        events: REAL_DATA.replay.events.map((event) => ({
          ...event,
          ticker: event.ticker === null ? null : map(ticker, event.ticker),
          ...('stageId' in event && event.stageId ? { stageId: map(stageId, event.stageId) } : {}),
          ...('skill' in event && event.skill ? { skill: map(skill, event.skill) } : {}),
        })),
      },
    };
    const parse = (files: FsreRawFiles) => {
      const parsed = parseFsreRun(files, UNVR_FILE_NAMES);
      if (!parsed.ok) throw new Error(parsed.detail);
      return parsed.run;
    };
    const original = parse(REAL_FILES);
    const other = parse(renamed);
    const projection = (run: typeof original, back: (name: string) => string, backTicker: (t: string) => string, backStage: (s: string) => string) => {
      const ctx = buildContext(run);
      const plan = planFloors(run.stages, run.skills);
      const state = reduceEvents(ctx, run.events);
      const [company] = state.companyOrder.map((t) => state.companies[t]);
      return {
        floors: Object.fromEntries(Object.entries(plan.floorOfSkill).map(([name, floor]) => [back(name), floor])),
        agents: Object.fromEntries(plan.agentSkills.map((name) => [back(name), agentStatus(ctx, state, name)])),
        gates: plan.gateStageIds.map((id) => gateSummary(company, id).worst),
        items: partnerItems(state).map((item) => [item.kind, item.state, item.ticker && backTicker(item.ticker), item.stageId && backStage(item.stageId), item.eventId, item.title]),
        desk: company.deskKey?.replace(/^desk:/, '') && back(company.deskKey.replace(/^desk:/, '')),
        figures: runTotals(state).figures,
      };
    };
    const inverse = <T,>(m: Map<T, T>) => new Map([...m].map(([a, b]) => [b, a]));
    const identity = (x: string) => x;
    expect(projection(other, (n) => map(inverse(skill), n), (t) => map(inverse(ticker), t), (s) => map(inverse(stageId), s))).toEqual(
      projection(original, identity, identity, identity),
    );
  });
});

describe('rule 5: one source per list, and colours only as tokens', () => {
  const wordMaps = [
    AGENT_STATUS_WORDS,
    STAGE_STATUS_WORDS,
    GATE_RESULT_WORDS,
    FOLDER_STATUS_WORDS,
    PARTNER_KIND_WORDS,
    ITEM_STATE_WORDS,
    ISSUE_STATE_WORDS,
    EVENT_KIND_WORDS,
    FIGURE_LABELS,
    FILE_WORDS,
  ];
  const words = new Set(wordMaps.flatMap((map) => Object.values(map)));

  it('no component spells a status, kind or figure word of its own', () => {
    const found = textTokens(VIEW_CODE)
      .filter((token) => !token.classList && words.has(token.text))
      .map((token) => `${where(token.file, token.node)} ${JSON.stringify(token.text)}`);
    expect(found).toEqual([]);
  });

  it('no FSRE file carries a colour value: every colour is a token in src/index.css', () => {
    const colour = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i;
    const found = textTokens(ALL_CODE)
      .filter((token) => colour.test(token.text))
      .map((token) => `${where(token.file, token.node)} ${JSON.stringify(token.text)}`);
    expect(found).toEqual([]);
  });

  it('the tokens it uses exist in src/index.css, and the new ones are only agent states, selection and chips', () => {
    const css = readFileSync(path.resolve(here, '../../../index.css'), 'utf8');
    const declared = [...css.matchAll(/--(fsre-[\w-]+):/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(
      ['fsre-chip', 'fsre-chip-border', 'fsre-done', 'fsre-escalated', 'fsre-idle', 'fsre-selection', 'fsre-stalled', 'fsre-working'].sort(),
    );
  });
});

describe('rule 7: one number formatter', () => {
  it('nothing outside format.ts formats a number for the screen', () => {
    const banned = new Set(['toLocaleString', 'toPrecision', 'NumberFormat']);
    const found: string[] = [];
    for (const file of ALL_CODE) {
      const isFormatter = file.endsWith('format.ts');
      const isGeometry = file.endsWith('projection.ts'); // SVG coordinates, never on screen as text
      walk(parse(file), (node) => {
        if (!ts.isPropertyAccessExpression(node)) return;
        const name = node.name.getText();
        if (banned.has(name) || (name === 'toFixed' && !isFormatter && !isGeometry)) found.push(`${where(file, node)} ${name}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('no component renders a raw number as text', () => {
    const program = ts.createProgram(COMPONENTS, {
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const found: string[] = [];
    for (const file of COMPONENTS) {
      const source = program.getSourceFile(file);
      if (!source) throw new Error(`not in the program: ${file}`);
      walk(source, (node) => {
        // A {…} child of an element is rendered as text; attributes are not.
        if (!ts.isJsxExpression(node) || !node.expression || ts.isJsxAttribute(node.parent)) return;
        const type = checker.getTypeAtLocation(node.expression);
        const parts = type.isUnion() ? type.types : [type];
        const numeric = parts.some((part) => (part.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike)) !== 0);
        // A ReactNode slot (children, a badge) also admits elements: it passes
        // through what its caller rendered, and the caller is checked itself.
        const slot = parts.some((part) => (part.flags & ts.TypeFlags.Object) !== 0);
        if (numeric && !slot) {
          found.push(`${where(file, node)} ${node.expression.getText()}`);
        }
      });
    }
    expect(found).toEqual([]);
  }, 60_000);
});

describe('British English in the copy', () => {
  it('uses no American spelling in any string the building shows', () => {
    const american = /\b(?:colors?|behaviors?|centers?|centered|organiz\w*|analyz\w*|normaliz\w*|modeling|modeled|favorite|labeled|canceled|gray)\b/i;
    const found = textTokens(ALL_CODE)
      .filter((token) => !token.classList && american.test(token.text))
      .map((token) => `${where(token.file, token.node)} ${JSON.stringify(token.text)}`);
    expect(found).toEqual([]);
  });
});
