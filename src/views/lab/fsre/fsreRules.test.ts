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
import replayJson from '../../../data/fsre/replay-unvr.json';
import skillsJson from '../../../data/fsre/skills.json';
import stagesJson from '../../../data/fsre/stages.json';
import {
  AGENT_STATUS_WORDS,
  EVENT_KIND_WORDS,
  FIGURE_LABELS,
  FILE_WORDS,
  FOLDER_STATUS_WORDS,
  GATE_RESULT_WORDS,
  ISSUE_STATE_WORDS,
  ITEM_STATE_WORDS,
  PARTNER_KIND_WORDS,
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
  const stageIds = stagesJson.stages.map((stage) => stage.id);
  const stageNames = stagesJson.stages.map((stage) => stage.name);
  const skillNames = [...new Set([...skillsJson.skills.map((skill) => skill.name), ...stagesJson.stages.flatMap((stage) => stage.skills)])];
  const tickers = [replayJson.company.ticker];
  const forbidden = new Set([...stageIds, ...stageNames, ...skillNames, ...tickers]);

  it('writes none of them as a literal anywhere in the view or the core', () => {
    const found = textTokens(ALL_CODE)
      .filter((token) => !token.classList)
      .filter((token) => forbidden.has(token.text) || [...forbidden].some((name) => (name.includes('-') || name === name.toUpperCase()) && new RegExp(`\\b${name}\\b`).test(token.text)))
      .map((token) => `${where(token.file, token.node)} ${JSON.stringify(token.text)}`);
    expect(found).toEqual([]);
  });

  it('keeps the floor plan free of a second skill list (layout.ts names no skill)', () => {
    const layout = readFileSync(path.join(CORE_DIR, 'layout.ts'), 'utf8');
    for (const skill of skillNames) expect(layout.includes(`'${skill}'`), skill).toBe(false);
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
