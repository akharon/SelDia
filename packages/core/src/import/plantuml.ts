// =============================================================================
// SelDiA — PlantUML Importer
// =============================================================================
// The second peer input format, built on exactly the principle stated in
// import/mermaid.ts: this is a *frontend*, not a translator. PlantUML source
// goes straight to SelDiA's IR; it is never lowered into SelDiA DSL text and
// re-parsed, because that would make every PlantUML construct hostage to
// whatever the DSL happens to express.
//
// PlantUML differs from Mermaid in one structural way that shapes this whole
// file: it has no per-diagram header keyword. Everything is `@startuml`, and
// the diagram *kind* is implied by the statements inside. So the entry point
// scores the body against per-type signatures and routes on the winner
// (detectPlantUmlType), where the Mermaid importer just reads line one.
//
// Scope: sequence, class, ER (IE/crow's-foot `entity` form), use case,
// activity (modern `:action;` syntax plus the legacy `(*) -->` form),
// component, deployment, state, mindmap (`@startmindmap`, `@startwbs`) and
// gantt (`@startgantt`). Non-diagram blocks (`@startjson`, `@startsalt`,
// `@startditaa`, …) report a diagnostic rather than throwing, so a document
// containing one unsupported block still renders its other blocks.
// =============================================================================

import type { DiagramIR, IRNode, IREdge, IRGroup } from '../ir/types.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle } from '../types/style.js';
import { sizeForLabel } from '../layout/text-measure.js';
import { sizeForShape } from '../render/node-label-geometry.js';
import { erEntitySize } from '../render/custom-renderers.js';

export interface PlantUmlImportDiagnostic {
  line: number;
  message: string;
}

export interface PlantUmlImportResult {
  ir?: DiagramIR;
  diagnostics: PlantUmlImportDiagnostic[];
}

/** One surviving source line: text with directives/comments already removed,
 *  plus the original 1-based line number so diagnostics point at the file the
 *  user actually wrote, not at the filtered stream. */
interface PLine {
  text: string;
  n: number;
}

interface Preprocessed {
  lines: PLine[];
  /** The `@start<word>` block kind — `uml` when the source has no wrapper. */
  block: string;
  title?: string;
  direction: string;
}

// -----------------------------------------------------------------------------
// Shared lexical helpers
// -----------------------------------------------------------------------------

/** Element-declaration keywords PlantUML accepts across its diagram families.
 *  A line only counts as a declaration when its first word is in here — which
 *  is what stops `Alice -> Bob : node down` from declaring a deployment node. */
const ELEMENT_KEYWORDS = new Set([
  'participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections',
  'queue', 'class', 'abstract', 'interface', 'enum', 'annotation', 'object', 'protocol',
  'struct', 'exception', 'metaclass', 'stereotype', 'usecase', 'component', 'node',
  'device', 'cloud', 'folder', 'frame', 'package', 'rectangle', 'storage', 'card',
  'agent', 'artifact', 'file', 'stack', 'person', 'together', 'state', 'hexagon',
  'circle', 'namespace', 'partition', 'label', 'map',
]);

/** Declaration keywords that open a nested container when the line ends in `{`. */
const CONTAINER_KEYWORDS = new Set([
  'package', 'namespace', 'node', 'cloud', 'folder', 'frame', 'rectangle', 'together',
  'database', 'component', 'state', 'artifact', 'storage', 'card', 'agent', 'file',
  'stack', 'partition', 'box',
]);

/** Strip PlantUML's optional quoting and unescape its `\n` line breaks. */
function cleanLabel(raw: string): string {
  let s = raw.trim();
  if (s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1);
  }
  // PlantUML writes explicit breaks as a literal backslash-n, and Creole
  // markup as \\ — both mean "new line" in a label.
  s = s.replace(/\\n/g, '\n').replace(/\\\\/g, '\n');
  // Creole emphasis and HTML-ish tags carry no structure into the IR.
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  return s.trim();
}

/** Turn arbitrary element text into an identifier-safe id. PlantUML lets an
 *  element be named by a quoted phrase with no alias (`participant "Web App"`),
 *  so ids frequently have to be synthesised from the label. */
function slugId(text: string): string {
  const s = text.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'n';
}

/** Index of `token` in `s`, skipping any occurrence inside a quoted run — the
 *  same quote-awareness the Mermaid importer needs, for the same reason: a
 *  quoted label may legitimately contain arrow characters. */
function indexOfUnquoted(s: string, token: string, from = 0): number {
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"') { quote = ch; continue; }
    if (s.startsWith(token, i)) return i;
  }
  return -1;
}

/** Split a relation statement's trailing `: label`, ignoring colons inside
 *  quotes and the `::` namespace separator. */
function splitTrailingLabel(line: string): { head: string; label?: string } {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"') { quote = ch; continue; }
    if (ch === ':') {
      if (line[i + 1] === ':') { i++; continue; }
      return { head: line.slice(0, i).trim(), label: cleanLabel(line.slice(i + 1)) };
    }
  }
  return { head: line.trim() };
}

/** Classify class members the way `diagrams/class.ts` does — a line holding
 *  `(` is an operation, anything else an attribute. Mirrored (not imported:
 *  it is private to that plugin) so the size reserved here matches the
 *  compartments the renderer actually draws. */
function splitMembers(lines: string[]): { attributes: string[]; operations: string[] } {
  const attributes: string[] = [];
  const operations: string[] = [];
  for (const line of lines) {
    if (line.includes('(')) operations.push(line);
    else attributes.push(line);
  }
  return { attributes, operations };
}

function makeNode(id: string, label: string, shape: ShapeType): IRNode {
  return {
    id,
    label,
    shape,
    position: { x: 0, y: 0 },
    size: sizeForShape(label, String(shape), 14, 100, 50),
    style: {},
    ports: [],
    classList: [],
    collapsed: false,
    data: {},
  };
}

function makeGroup(id: string, label: string): IRGroup {
  return {
    id,
    label,
    position: { x: 0, y: 0 },
    size: { width: 0, height: 0 },
    style: {},
    childNodeIds: [],
    childGroupIds: [],
    collapsible: false,
    collapsed: false,
    classList: [],
    data: {},
  };
}

// -----------------------------------------------------------------------------
// Arrow parsing
// -----------------------------------------------------------------------------

/** The head/tail decorations PlantUML hangs off an arrow: `<|`, `*`, `o`, `>`,
 *  crow's-foot `{`/`}` and the sequence-only `x`/`\`/`/` variants. */
const ARROW_DECOR = '<>|*o+#x^}{';

interface ArrowMatch {
  /** The whole arrow token as written, e.g. `<|--`, `-down->`, `||--o{`. */
  token: string;
  index: number;
  length: number;
  /** Decorations before the line run, e.g. `<|` of `<|--`. */
  head: string;
  /** Decorations after the line run, e.g. `o{` of `||--o{`. */
  tail: string;
  /** The dash/dot run itself (`-`, `--`, `..`), with any inline spec removed.
   *  Families disagree about what "dashed" means — `-->` is a dotted reply in
   *  a sequence diagram but a solid association in a class diagram — so the
   *  raw run is exposed and each importer draws its own conclusion. */
  lineRun: string;
  /** Contents of an inline `[...]`: a style spec (`[#red]`, `[hidden]`) or,
   *  in legacy activity syntax, the edge label (`-->[condition]`). */
  spec?: string;
  dashed: boolean;
}

/**
 * Find the connector in a relation statement.
 *
 * PlantUML arrows are far more varied than Mermaid's fixed table: decorations
 * on both ends, an optional direction hint *inside* the line (`-down->`), an
 * optional inline style spec (`-[#red,dashed]->`), and one-to-two-character
 * line runs of either dashes or dots. Rather than enumerate the cross product,
 * this walks the string for a dash/dot run and expands outward over the
 * legal neighbours — the same shape of scan `indexOfUnquoted` does, so quoted
 * multiplicities like `"0..*"` can never be mistaken for a dotted connector.
 */
function findArrow(s: string): ArrowMatch | null {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"') { quote = ch; continue; }
    if (ch !== '-' && ch !== '.') continue;

    // Expand left over decoration characters.
    let start = i;
    while (start > 0 && ARROW_DECOR.includes(s[start - 1])) start--;

    // Line run, optional `[...]` style spec, optional direction word, second
    // line run — PlantUML allows any subset of these in either order around
    // the hint, e.g. `-->`, `-[#red]->`, `-down->`, `.left.>`.
    let j = i;
    const runChar = ch;
    while (j < s.length && s[j] === runChar) j++;
    const bracket = s.slice(j).match(/^\[([^\]]*)\]/);
    if (bracket) j += bracket[0].length;
    const hint = s.slice(j).match(/^(?:left|right|up|down|l|r|u|d)/i);
    if (hint) {
      const after = s[j + hint[0].length];
      if (after === '-' || after === '.') {
        j += hint[0].length;
        while (j < s.length && (s[j] === '-' || s[j] === '.')) j++;
      }
    } else {
      while (j < s.length && (s[j] === '-' || s[j] === '.')) j++;
    }

    // Expand right over decoration characters.
    let end = j;
    while (end < s.length && ARROW_DECOR.includes(s[end])) end++;

    // Legacy activity hangs its label off the *end* of the arrow with no
    // space (`-->[yes]`). Absorbing it here is what keeps the bracket out of
    // the target reference, where it would otherwise invent a node called
    // `[yes] "Process"`. The no-space rule is load-bearing: `[A] --> [B]` in a
    // component diagram must keep `[B]` as the target.
    let trailingSpec: string | undefined;
    const trailing = s.slice(end).match(/^\[([^\]]*)\]/);
    if (trailing) { trailingSpec = trailing[1]; end += trailing[0].length; }

    const token = s.slice(start, end);
    const head = s.slice(start, i);
    const tail = s.slice(j, trailingSpec === undefined ? end : end - trailingSpec.length - 2);
    const lineRun = s.slice(i, j).replace(/\[[^\]]*\]/g, '').replace(/[a-z]/gi, '');
    // A lone `-` with no decoration is a hyphen inside a word (`e-mail`), not
    // a connector. Require either a two-character run or a real decoration.
    if (lineRun.length < 2 && !head && !tail) continue;
    // `--` used as a class-body compartment divider has nothing either side;
    // callers that can see a divider filter it out before getting here.
    return {
      token, index: start, length: end - start, head, tail, lineRun,
      spec: bracket ? bracket[1] : trailingSpec,
      dashed: lineRun.includes('.'),
    };
  }
  return null;
}

export type RelationKind =
  | 'inheritance' | 'realization' | 'composition' | 'aggregation'
  | 'association' | 'dependency';

/**
 * Read UML semantics off an arrow token.
 *
 * `flip` says the statement is written target-first: PlantUML points
 * generalization at the parent (`Parent <|-- Child`), while the IR stores it
 * child→parent so the hollow triangle lands on the parent. Same for `<--`,
 * `--*` and `--o`, whose decorated end is the one that carries the meaning.
 */
function relationKindOf(arrow: ArrowMatch): { kind: RelationKind; flip: boolean } {
  const { head, tail, dashed } = arrow;
  if (head.includes('|')) return { kind: dashed ? 'realization' : 'inheritance', flip: true };
  if (tail.includes('|')) return { kind: dashed ? 'realization' : 'inheritance', flip: false };
  if (head.includes('*')) return { kind: 'composition', flip: true };
  if (tail.includes('*')) return { kind: 'composition', flip: false };
  if (head.includes('o')) return { kind: 'aggregation', flip: true };
  if (tail.includes('o')) return { kind: 'aggregation', flip: false };
  if (dashed) return { kind: 'dependency', flip: head.includes('<') && !tail.includes('>') };
  return { kind: 'association', flip: head.includes('<') && !tail.includes('>') };
}

interface RelationStatement {
  source: string;
  target: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  label?: string;
  arrow: ArrowMatch;
}

/**
 * Parse `Animal "1" *-- "many" Leg : has` into its parts.
 * Multiplicities are quoted strings adjacent to the arrow on either side, and
 * they are split out here so they never end up glued to the element name.
 */
function parseRelation(line: string): RelationStatement | null {
  const { head: body, label } = splitTrailingLabel(line);
  const arrow = findArrow(body);
  if (!arrow) return null;

  let left = body.slice(0, arrow.index).trim();
  let right = body.slice(arrow.index + arrow.length).trim();
  if (!left || !right) return null;

  let sourceMultiplicity: string | undefined;
  let targetMultiplicity: string | undefined;
  const leftMult = left.match(/\s"([^"]*)"$/);
  if (leftMult) { sourceMultiplicity = leftMult[1]; left = left.slice(0, leftMult.index).trim(); }
  const rightMult = right.match(/^"([^"]*)"\s/);
  if (rightMult) { targetMultiplicity = rightMult[1]; right = right.slice(rightMult[0].length).trim(); }

  // Trailing stereotypes/colors on the target (`B <<uses>>`, `B #red`).
  right = right.replace(/\s*<<[^>]*>>\s*$/, '').replace(/\s*#[\w[\]]+\s*$/, '').trim();
  if (!left || !right) return null;

  // Legacy activity syntax puts the edge label inside the arrow
  // (`"A" -->[yes] "B"`). Anything that names a colour or a line style is a
  // rendering hint instead and stays out of the label.
  const specIsStyle = !arrow.spec
    || /^(#|hidden|bold|dashed|dotted|plain|norank|thickness=|bold,|dotted,)/i.test(arrow.spec.trim());
  return {
    source: left,
    target: right,
    sourceMultiplicity,
    targetMultiplicity,
    label: label || (specIsStyle ? undefined : cleanLabel(arrow.spec!)),
    arrow,
  };
}

// -----------------------------------------------------------------------------
// Element declarations
// -----------------------------------------------------------------------------

interface ElementDecl {
  /** Normalised declaration keyword (`component`, `actor`, `class`, …). */
  keyword: string;
  id: string;
  label: string;
  stereotype?: string;
  /** True when the declaration opens a `{ … }` container. */
  open: boolean;
  /** True for `abstract class Foo` / bare `abstract Foo`. */
  isAbstract: boolean;
  /** Superclasses/interfaces named inline via `extends` / `implements`. */
  supers?: Array<{ ref: string; kind: 'inheritance' | 'realization' }>;
}

/** Peel a quoted / bracketed / parenthesised / colon-wrapped element name. */
function unwrapName(raw: string): string {
  let s = raw.trim();
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) return cleanLabel(s);
  if (s.length > 2 && s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  else if (s.length > 2 && s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
  else if (s.length > 2 && s.startsWith(':') && s.endsWith(':')) s = s.slice(1, -1);
  return cleanLabel(s);
}

/**
 * Parse any element declaration PlantUML accepts, in either the keyword form
 * (`component "Web" as web <<svc>> #blue {`) or one of the four shorthand
 * bracket forms (`[Web]`, `(Use case)`, `:Actor:`, `() Interface`).
 */
function parseElementDecl(line: string): ElementDecl | null {
  let s = line.trim();
  if (!s) return null;

  // Shorthands carry their kind in the delimiter, not a keyword.
  const shorthand: Array<[RegExp, string]> = [
    [/^\(\)\s*(.+)$/, 'interface'],
    [/^\[([^\]]+)\]\s*(.*)$/, 'component'],
    [/^\(([^)]+)\)\s*(.*)$/, 'usecase'],
    [/^:([^:]+):\s*(.*)$/, 'actor'],
  ];
  for (const [re, keyword] of shorthand) {
    const m = s.match(re);
    if (!m) continue;
    if (keyword === 'interface') {
      const rest = parseNameAndAlias(m[1]);
      return { keyword, id: slugId(rest.alias || rest.name), label: rest.name, stereotype: rest.stereotype, open: rest.open, isAbstract: false };
    }
    // The tail after the delimiter carries the same optional `as alias`,
    // `<<stereotype>>`, `#color` and `{` decorations a keyword decl may have
    // (`[Gateway] <<service>>`), so it goes through the shared parser. Anything
    // else there means this was not a declaration at all.
    const tail = parseShorthandTail(m[2]);
    if (!tail) continue;
    const label = cleanLabel(m[1]);
    return { keyword, id: slugId(tail.alias || label), label, stereotype: tail.stereotype, open: tail.open, isAbstract: false };
  }

  const kw = s.match(/^(\w+)\b\s*(.*)$/);
  if (!kw) return null;
  let keyword = kw[1].toLowerCase();
  let rest = kw[2];
  if (!ELEMENT_KEYWORDS.has(keyword)) return null;

  // `abstract class Foo` and bare `abstract Foo` are both abstract classes.
  let isAbstract = false;
  if (keyword === 'abstract') {
    isAbstract = true;
    const inner = rest.match(/^class\b\s*(.*)$/i);
    keyword = 'class';
    if (inner) rest = inner[1];
  }
  if (!rest.trim()) return null;

  // `class Foo extends Bar implements Baz, Qux {` — PlantUML spells these
  // inline as well as with arrows. Peel them off before the name is parsed,
  // or the whole tail is read as one absurd class name.
  const supers: Array<{ ref: string; kind: 'inheritance' | 'realization' }> = [];
  rest = rest.replace(
    /\s+(extends|implements)\s+([^{]+)/gi,
    (_m, word: string, list: string) => {
      const kind = word.toLowerCase() === 'extends' ? 'inheritance' : 'realization';
      for (const ref of list.split(',')) {
        const t = ref.trim();
        if (t) supers.push({ ref: t, kind });
      }
      return ' ';
    },
  );

  const parsed = parseNameAndAlias(rest);
  if (!parsed.name) return null;
  return {
    keyword,
    id: slugId(parsed.alias || parsed.name),
    label: parsed.name,
    stereotype: parsed.stereotype,
    open: parsed.open,
    isAbstract,
    ...(supers.length ? { supers } : {}),
  };
}

/** Parse the decoration tail of a bracket shorthand (`[Web] as w <<svc>> #blue {`).
 *  Returns null when the tail holds anything else, which means the line was a
 *  relation or statement that merely began with a bracketed element. */
function parseShorthandTail(
  raw: string,
): { alias?: string; stereotype?: string; open: boolean } | null {
  let s = (raw || '').trim();
  if (!s) return { open: false };

  const open = /\{$/.test(s);
  if (open) s = s.slice(0, -1).trim();

  let stereotype: string | undefined;
  const stereo = s.match(/<<([^>]*)>>/);
  if (stereo) {
    stereotype = stereo[1].trim();
    s = (s.slice(0, stereo.index) + s.slice(stereo.index! + stereo[0].length)).trim();
  }

  s = s.replace(/\s*#[\w|/\\]+\s*$/, '').trim();

  let alias: string | undefined;
  const as = s.match(/^as\s+(\S+)$/i);
  if (as) { alias = unwrapName(as[1]); s = ''; }

  if (s) return null;
  return { alias, stereotype, open };
}

/** Split `"Web App" as web <<service>> #blue {` into its pieces. Both orders
 *  of name/alias are accepted, since PlantUML allows `X as "Long name"` too. */
function parseNameAndAlias(rest: string): { name: string; alias?: string; stereotype?: string; open: boolean } {
  let s = rest.trim();
  const open = /\{$/.test(s);
  if (open) s = s.slice(0, -1).trim();

  let stereotype: string | undefined;
  const stereo = s.match(/<<([^>]*)>>/);
  if (stereo) { stereotype = stereo[1].trim(); s = (s.slice(0, stereo.index) + s.slice(stereo.index! + stereo[0].length)).trim(); }

  // Colors (`#blue`, `#AliceBlue`, `#88FF88`) and sequence `order 10`.
  s = s.replace(/\s*#[\w|/\\]+\s*$/, '').replace(/\s+order\s+\d+\s*$/i, '').trim();

  const asIdx = indexOfUnquoted(s, ' as ');
  if (asIdx > 0) {
    const left = unwrapName(s.slice(0, asIdx));
    const right = unwrapName(s.slice(asIdx + 4));
    // Whichever side needs quoting is the human label; the other is the alias.
    const rightIsLabel = /\s/.test(right) && !/\s/.test(left);
    return rightIsLabel
      ? { name: right, alias: left, stereotype, open }
      : { name: left, alias: right, stereotype, open };
  }
  return { name: unwrapName(s), stereotype, open };
}

// -----------------------------------------------------------------------------
// Preprocessing
// -----------------------------------------------------------------------------

const BLOCK_OPEN_RE = /^@start(\w+)\b/i;

/**
 * Strip everything that decorates a PlantUML file without contributing
 * structure: `@start`/`@end` wrappers, `'` and `/' … '/` comments, `!`
 * preprocessor lines, skinparam/style blocks, notes, legends and captions.
 * Directives that *do* carry information (`title`, layout direction) are
 * lifted out rather than dropped.
 */
function preprocess(source: string): Preprocessed {
  const lines: PLine[] = [];
  let block = 'uml';
  let sawBlock = false;
  let title: string | undefined;
  let direction = 'TB';
  let inComment = false;
  let skipUntil: RegExp | null = null;

  const raws = source.split('\n');
  for (let i = 0; i < raws.length; i++) {
    const n = i + 1;
    const t = raws[i].trim();

    if (inComment) { if (t.includes("'/")) inComment = false; continue; }
    if (t.startsWith("/'")) { if (!t.slice(2).includes("'/")) inComment = true; continue; }
    if (skipUntil) { if (skipUntil.test(t)) skipUntil = null; continue; }
    if (!t) continue;
    if (t.startsWith("'")) continue;

    const open = t.match(BLOCK_OPEN_RE);
    if (open) { if (!sawBlock) { block = open[1].toLowerCase(); sawBlock = true; } continue; }
    if (/^@end/i.test(t)) continue;
    if (t.startsWith('!')) continue;

    if (/^skinparam\b/i.test(t) || /^style\b/i.test(t)) {
      if (t.endsWith('{')) skipUntil = /^\}$/;
      continue;
    }
    if (/^legend\b/i.test(t)) { skipUntil = /^end\s*legend$/i; continue; }
    if (/^(header|footer)\b/i.test(t)) {
      if (!/\S/.test(t.replace(/^(header|footer)/i, ''))) skipUntil = /^end\s*(header|footer)$/i;
      continue;
    }
    if (/^title\b/i.test(t)) {
      const rest = t.replace(/^title\b/i, '').trim();
      if (rest) title = cleanLabel(rest); else skipUntil = /^end\s*title$/i;
      continue;
    }
    // Notes attach to elements but add no nodes/edges to the IR. A note is a
    // one-liner when it carries its text inline (`… : text`, `note "x" as N`);
    // otherwise its body runs to `end note`.
    if (/^([hr]?note|nwdiag)\b/i.test(t)) {
      const oneLiner = /:/.test(t) || /\bas\b/i.test(t);
      if (!oneLiner) skipUntil = /^end\s*[hr]?note$/i;
      continue;
    }
    if (/^(hide|show|scale|caption|autonumber|allow_mixing|allowmixing|mainframe|sprite|top\s+to\s+bottom\s+direction|remove|restore)\b/i.test(t)) {
      if (/^top\s+to\s+bottom\s+direction$/i.test(t)) direction = 'TB';
      continue;
    }
    if (/^left\s+to\s+right\s+direction$/i.test(t)) { direction = 'LR'; continue; }
    // Visual-only separators: `...`, `|||`, `==Phase==`, `--Phase--`.
    if (/^(\.{3,}|\|{3,})$/.test(t)) continue;

    lines.push({ text: t, n });
  }

  return { lines, block, title, direction };
}

// -----------------------------------------------------------------------------
// Diagram-kind detection
// -----------------------------------------------------------------------------

/** Blocks that are not node/edge diagrams at all — there is no IR to build. */
const NON_DIAGRAM_BLOCKS = new Set([
  'json', 'yaml', 'salt', 'ditaa', 'dot', 'creole', 'math', 'latex', 'regex',
  'ebnf', 'board', 'chen', 'chronology', 'nwdiag', 'files',
]);

const SEQUENCE_DECLS = /^(participant|boundary|control|collections|create)\b/i;
const SEQ_MESSAGE_RE = /^.+?\s*(?:<{1,2}|[ox\\/])?-{1,2}(?:>{1,2}|[ox\\/])?\s*.+?\s*:\s*.*$/;

/**
 * Score the body against each diagram family's signature and take the winner.
 *
 * PlantUML's `@startuml` says nothing about the kind of diagram inside, and
 * the families genuinely overlap: `actor` appears in both sequence and use
 * case, `database` in sequence, component and deployment. Scoring (rather
 * than first-match) is what keeps one shared keyword from hijacking the
 * routing — the type with the most *distinctive* evidence wins, and ties fall
 * back to a fixed priority order.
 */
export function detectPlantUmlType(lines: PLine[], block: string): DiagramType | null {
  if (block === 'mindmap' || block === 'wbs') return DiagramType.MINDMAP;
  if (block === 'gantt') return DiagramType.GANTT;
  if (NON_DIAGRAM_BLOCKS.has(block)) return null;

  const score: Partial<Record<DiagramType, number>> = {};
  const bump = (t: DiagramType, by = 1) => { score[t] = (score[t] || 0) + by; };

  for (const { text } of lines) {
    // ── Activity: statement-shaped, not relation-shaped.
    if (/^(start|stop|end|kill|detach|endif|endwhile|end\s?fork|end\s?split|repeat|fork\s?again|fork|split\s?again|split|backward\s*:)/i.test(text)) bump(DiagramType.ACTIVITY, 2);
    if (/^:.*[;<>/\]}|]$/.test(text)) bump(DiagramType.ACTIVITY, 2);
    if (/^(if|elseif|while|switch|case)\s*\(/i.test(text)) bump(DiagramType.ACTIVITY, 2);
    if (/\(\*\)/.test(text)) bump(DiagramType.ACTIVITY, 2);

    // ── Sequence.
    if (SEQUENCE_DECLS.test(text)) bump(DiagramType.SEQUENCE, 2);
    if (/^(activate|deactivate|destroy|ref\s+over|alt|opt|par|critical|break|group)\b/i.test(text)) bump(DiagramType.SEQUENCE, 2);
    if (SEQ_MESSAGE_RE.test(text) && !/^\w+\s*:/.test(text) && findArrow(splitTrailingLabel(text).head)) bump(DiagramType.SEQUENCE, 1);

    // ── Class / object.
    if (/^(abstract|class|interface|enum|annotation|object|protocol|struct|metaclass)\b/i.test(text)) bump(DiagramType.CLASS, 2);
    if (/(<\|-{1,2}|-{1,2}\|>|<\|\.{1,2}|\.{1,2}\|>|\*-{1,2}|-{1,2}\*|o-{1,2}|-{1,2}o)/.test(text)) bump(DiagramType.CLASS, 1);

    // ── ER (IE notation): `entity` blocks plus crow's-foot cardinalities.
    if (/^entity\b/i.test(text)) bump(DiagramType.ER, 2);
    if (/(\|\||\|o|\}o|\}\||o\{|\|\{)\s*-{2,}|-{2,}\s*(o\{|\|\{|\|\||o\|)/.test(text)) bump(DiagramType.ER, 3);

    // ── Use case.
    if (/^usecase\b/i.test(text)) bump(DiagramType.USECASE, 3);
    if (/^\([^)]+\)/.test(text) || /\([A-Z][^)]*\)\s*$/.test(text)) bump(DiagramType.USECASE, 1);
    if (/^:[^:]+:/.test(text)) bump(DiagramType.USECASE, 1);

    // ── Component.
    if (/^component\b/i.test(text) || /^\(\)\s/.test(text)) bump(DiagramType.COMPONENT, 3);
    if (/\[[^\]]+\]/.test(text)) bump(DiagramType.COMPONENT, 1);

    // ── Deployment.
    if (/^(node|device|artifact|storage)\b/i.test(text)) bump(DiagramType.DEPLOYMENT, 3);
    if (/^(cloud|folder|frame|rectangle)\b/i.test(text)) bump(DiagramType.DEPLOYMENT, 1);

    // ── State.
    if (/\[\*\]/.test(text)) bump(DiagramType.STATE, 3);
    if (/^state\b/i.test(text)) bump(DiagramType.STATE, 2);
  }

  // A crow's-foot cardinality is the only unambiguous ER marker; without one,
  // `entity` is just a sequence-diagram participant shape.
  if (!/(\}o|o\{|\|\{|\}\|)/.test(lines.map((l) => l.text).join('\n'))) delete score[DiagramType.ER];

  // `[*]` is to state what a crow's-foot is to ER: it has no meaning in any
  // other family. It must veto SEQUENCE explicitly, because a labelled
  // transition (`Idle --> Sending : write()`) is shaped exactly like a
  // sequence message, so a state machine with more transitions than
  // pseudostates would otherwise out-score state and be read as a sequence
  // diagram — silently dropping its composite states.
  if (lines.some((l) => /\[\*\]/.test(l.text))) delete score[DiagramType.SEQUENCE];

  const priority: DiagramType[] = [
    DiagramType.ACTIVITY, DiagramType.ER, DiagramType.SEQUENCE, DiagramType.CLASS,
    DiagramType.STATE, DiagramType.USECASE, DiagramType.DEPLOYMENT, DiagramType.COMPONENT,
  ];
  let best: DiagramType | null = null;
  let bestScore = 0;
  for (const t of priority) {
    const v = score[t] || 0;
    if (v > bestScore) { best = t; bestScore = v; }
  }
  if (best) return best;
  // Nothing distinctive, but there are arrows: plain boxes and edges is what
  // a component diagram already is, so that is the safest generic landing.
  return lines.some((l) => findArrow(l.text)) ? DiagramType.COMPONENT : null;
}

/**
 * Reconcile relations that point at a *container* rather than a leaf element.
 *
 * `node "App Server" as app { … }` becomes an IRGroup, but `phone --> app` is
 * still legal PlantUML — and an IR edge can only land on a node. Left alone,
 * the reference silently manufactures a second, empty box beside the group it
 * meant. Each such endpoint is redirected onto the container's first child
 * (its representative), and the phantom node is dropped; a childless container
 * keeps a real node instead, since there is nothing to represent it.
 */
function resolveContainerRefs(
  nodes: Map<string, IRNode>,
  edges: IREdge[],
  groups: Map<string, IRGroup>,
  containers: Map<string, string>,
): void {
  if (!containers.size) return;

  const representative = (groupId: string, guard = 0): string | null => {
    const g = groups.get(groupId);
    if (!g || guard > groups.size) return null;
    // A composite state's first child is usually its `[*]` entry pseudostate,
    // which would export back as `[*]` and silently rewrite the transition.
    // Prefer a real child; fall back to the pseudostate only if that is all
    // the container holds.
    const real = g.childNodeIds.find((cid) => !cid.startsWith('__'));
    if (real) return real;
    if (g.childNodeIds.length) return g.childNodeIds[0];
    for (const child of g.childGroupIds) {
      const rep = representative(child, guard + 1);
      if (rep) return rep;
    }
    return null;
  };

  const remapped = new Set<string>();
  for (const edge of edges) {
    for (const end of ['sourceId', 'targetId'] as const) {
      const gid = containers.get(edge[end]);
      if (!gid) continue;
      const rep = representative(gid);
      if (!rep) continue;
      remapped.add(edge[end]);
      edge.data = { ...edge.data, [end === 'sourceId' ? 'sourceContainer' : 'targetContainer']: gid };
      edge[end] = rep;
    }
  }
  // Only drop a phantom once every reference to it has been redirected —
  // otherwise a childless container would lose the node holding its edges.
  for (const alias of remapped) {
    if (edges.some((e) => e.sourceId === alias || e.targetId === alias)) continue;
    nodes.delete(alias);
  }
}

// -----------------------------------------------------------------------------
// Sequence
// -----------------------------------------------------------------------------

/** Sequence participant keyword → the lifeline head shape to draw. */
const SEQ_PARTICIPANT_SHAPES: Record<string, ShapeType> = {
  actor: ShapeType.ACTOR,
  participant: ShapeType.RECTANGLE,
  boundary: ShapeType.RECTANGLE,
  control: ShapeType.CIRCLE,
  entity: ShapeType.CIRCLE,
  database: ShapeType.CYLINDER,
  collections: ShapeType.SUBROUTINE,
  queue: ShapeType.QUEUE,
};

/** Fragment openers PlantUML shares with UML's combined fragments. `group` is
 *  the free-form one and carries its whole tail as the label. */
const SEQ_FRAGMENT_OPEN = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/i;

interface FragBuild {
  id: string; keyword: string; label?: string;
  firstEdge: number; lastEdge: number;
  sections: { label?: string; firstEdge: number }[];
}

function importSequence(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const edges: IREdge[] = [];
  const fragStack: FragBuild[] = [];
  const fragments: FragBuild[] = [];
  let fragSeq = 0;

  const ensure = (ref: string, shape?: ShapeType, label?: string): string => {
    const name = unwrapName(ref);
    const id = slugId(name);
    const existing = nodes.get(id);
    if (existing) {
      if (label && label !== existing.label) {
        existing.label = label;
        existing.size = sizeForShape(label, String(existing.shape), 14, 100, 50);
      }
      if (shape && existing.shape === ShapeType.RECTANGLE) existing.shape = shape;
      return id;
    }
    nodes.set(id, makeNode(id, label || name, shape || ShapeType.RECTANGLE));
    return id;
  };

  for (const { text, n } of lines) {
    // `create participant X` declares and creates in one statement.
    const line = text.replace(/^create\s+/i, '');

    const decl = parseElementDecl(line);
    if (decl && SEQ_PARTICIPANT_SHAPES[decl.keyword]) {
      const id = slugId(decl.id);
      const existing = nodes.get(id);
      if (existing) {
        existing.label = decl.label;
        existing.size = sizeForLabel(decl.label, 14, 100, 50);
        existing.shape = SEQ_PARTICIPANT_SHAPES[decl.keyword];
      } else {
        nodes.set(id, makeNode(id, decl.label, SEQ_PARTICIPANT_SHAPES[decl.keyword]));
      }
      continue;
    }

    // Control fragments bracket a span of messages. The sequence layout reads
    // these off `metadata.sequenceFragments` (see diagrams/sequence.ts), so
    // unlike the Mermaid importer they are modelled rather than skipped.
    const fragOpen = line.match(SEQ_FRAGMENT_OPEN);
    if (fragOpen) {
      const frag: FragBuild = {
        id: `puml-frag-${++fragSeq}`,
        keyword: fragOpen[1].toLowerCase(),
        label: cleanLabel(fragOpen[2]) || undefined,
        firstEdge: edges.length,
        lastEdge: edges.length,
        sections: [{ label: cleanLabel(fragOpen[2]) || undefined, firstEdge: edges.length }],
      };
      fragStack.push(frag);
      continue;
    }
    const elseMarker = line.match(/^(else|and)\b\s*(.*)$/i);
    if (elseMarker) {
      const top = fragStack[fragStack.length - 1];
      if (top) top.sections.push({ label: cleanLabel(elseMarker[2]) || undefined, firstEdge: edges.length });
      continue;
    }
    if (/^end\b/i.test(line)) {
      const done = fragStack.pop();
      if (done) { done.lastEdge = edges.length; fragments.push(done); }
      continue;
    }
    if (/^(activate|deactivate|destroy|return|ref\s+over|box|end\s?box|==.*==|--.*--)/i.test(line)) continue;

    const rel = parseRelation(line);
    if (!rel) {
      diagnostics.push({ line: n, message: `Unrecognized sequence statement: "${text}"` });
      continue;
    }
    const { arrow } = rel;
    // `<-` / `<<--` point right-to-left: the message runs target→source.
    const reversed = arrow.head.includes('<') && !arrow.tail.includes('>');
    const fromRef = reversed ? rel.target : rel.source;
    const toRef = reversed ? rel.source : rel.target;
    const from = ensure(fromRef);
    const to = ensure(toRef);
    edges.push({
      id: `msg-${from}-${to}-${edges.length}`,
      sourceId: from,
      targetId: to,
      label: rel.label || undefined,
      // In *sequence* diagrams a two-dash run is what PlantUML draws dotted —
      // its reply/return convention, the meaning Mermaid gives `-->>`. (In a
      // class diagram the same `--` is a solid association, which is why this
      // reads `lineRun` rather than the family-neutral `dashed`.)
      style: {
        ...(arrow.lineRun.includes('.') || arrow.lineRun.startsWith('--') ? { strokeStyle: StrokeStyle.DASHED } : {}),
        arrowhead: true,
      },
      routing: EdgeRouting.SPLINE,
      bidirectional: arrow.head.includes('<') && arrow.tail.includes('>'),
      classList: [],
      data: { messageOrder: edges.length, fragmentIds: fragStack.map((f) => f.id) },
    });
  }

  while (fragStack.length) { const f = fragStack.pop()!; f.lastEdge = edges.length; fragments.push(f); }
  const fragmentRecords = fragments
    .map((f) => ({ id: f.id, keyword: f.keyword, label: f.label, firstEdge: f.firstEdge, lastEdge: f.lastEdge, sections: f.sections }))
    .sort((a, b) => a.firstEdge - b.firstEdge);

  return {
    id: 'plantuml-sequence',
    type: DiagramType.SEQUENCE,
    title: title || 'Sequence',
    nodes: [...nodes.values()],
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'plantuml', ...(fragmentRecords.length ? { sequenceFragments: fragmentRecords } : {}) },
  };
}

// -----------------------------------------------------------------------------
// Class
// -----------------------------------------------------------------------------

/** A `<<stereotype>>` renders as a guillemet line above the class name, the
 *  conventional UML spelling — the class renderer takes the label's first line
 *  as the name, so the stereotype is folded into that line rather than added
 *  as a member. */
function classNameWithStereotype(label: string, keyword: string, stereotype?: string, isAbstract = false): string {
  const tag = stereotype
    || (keyword === 'interface' ? 'interface' : keyword === 'enum' ? 'enumeration'
      : keyword === 'annotation' ? 'annotation' : isAbstract ? 'abstract' : undefined);
  return tag ? `«${tag}» ${label}` : label;
}

function importClass(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const names = new Map<string, string>();
  const members = new Map<string, string[]>();
  const edges: IREdge[] = [];
  const groups = new Map<string, IRGroup>();
  const groupStack: string[] = [];
  const containers = new Map<string, string>();

  const addToGroup = (nodeId: string) => {
    const gid = groupStack[groupStack.length - 1];
    if (!gid) return;
    const g = groups.get(gid)!;
    if (!g.childNodeIds.includes(nodeId)) g.childNodeIds.push(nodeId);
  };

  const ensure = (ref: string, name?: string): string => {
    const id = slugId(unwrapName(ref));
    if (!nodes.has(id)) {
      nodes.set(id, makeNode(id, name || unwrapName(ref), ShapeType.RECTANGLE));
      names.set(id, name || unwrapName(ref));
      members.set(id, []);
      addToGroup(id);
    } else if (name) {
      names.set(id, name);
    }
    return id;
  };

  let openClass: string | null = null;

  for (const { text, n } of lines) {
    if (openClass) {
      if (text === '}' || text === '{}') { openClass = null; continue; }
      // `--`, `..`, `__`, `==` and their titled forms (`-- Title --`) are
      // compartment dividers, which the renderer derives itself from member
      // kinds. Two marker characters are required: with one, the pattern also
      // swallows a perfectly ordinary private field (`-int age`).
      if (/^([-.=_])\1+\s*[\w ]*\s*\1*$/.test(text)) continue;
      members.get(openClass)!.push(cleanLabel(text));
      continue;
    }

    if (text === '}') { groupStack.pop(); continue; }

    const decl = parseElementDecl(text);
    if (decl && (decl.keyword === 'package' || decl.keyword === 'namespace' || decl.keyword === 'together') && decl.open) {
      const group = makeGroup(`pkg-${slugId(decl.id)}`, decl.label);
      groups.set(group.id, group);
      containers.set(slugId(decl.id), group.id);
      containers.set(slugId(decl.label), group.id);
      const parent = groupStack[groupStack.length - 1];
      if (parent) groups.get(parent)!.childGroupIds.push(group.id);
      groupStack.push(group.id);
      continue;
    }
    if (decl && /^(class|interface|enum|annotation|object|protocol|struct|entity|metaclass|exception)$/.test(decl.keyword)) {
      const id = ensure(decl.id, classNameWithStereotype(decl.label, decl.keyword, decl.stereotype, decl.isAbstract));
      nodes.get(id)!.data = { kind: 'class', umlKind: decl.keyword, ...(decl.stereotype ? { stereotype: decl.stereotype } : {}) };
      // `class Foo extends Bar` is the same relation as `Bar <|-- Foo`, so it
      // has to produce the same edge — arrowhead at the parent.
      for (const sup of decl.supers ?? []) {
        const parent = ensure(sup.ref);
        edges.push({
          id: `rel-${id}-${parent}-${edges.length}`,
          sourceId: id,
          targetId: parent,
          label: undefined,
          style: sup.kind === 'realization' ? { strokeStyle: StrokeStyle.DASHED } : {},
          routing: EdgeRouting.ORTHOGONAL,
          bidirectional: false,
          classList: [],
          data: { relation: sup.kind, arrowType: 'generalization', relationship: 'generalization' },
        });
      }
      if (decl.open) openClass = id;
      continue;
    }

    const rel = parseRelation(text);
    if (rel) {
      const { kind, flip } = relationKindOf(rel.arrow);
      const source = ensure(rel.source);
      const target = ensure(rel.target);
      const srcMult = flip ? rel.targetMultiplicity : rel.sourceMultiplicity;
      const tgtMult = flip ? rel.sourceMultiplicity : rel.targetMultiplicity;
      edges.push({
        id: `rel-${source}-${target}-${edges.length}`,
        sourceId: flip ? target : source,
        targetId: flip ? source : target,
        label: rel.label,
        style: rel.arrow.dashed ? { strokeStyle: StrokeStyle.DASHED } : {},
        routing: EdgeRouting.ORTHOGONAL,
        bidirectional: false,
        classList: [],
        data: {
          relation: kind,
          // `arrowType` is what engine.ts reads when it draws the head, and
          // the head always sits at the *target* — which is exactly why the
          // decorated end of the PlantUML arrow becomes the target above.
          arrowType: kind === 'inheritance' || kind === 'realization' ? 'generalization' : kind,
          relationship: kind === 'inheritance' ? 'generalization' : kind,
          // Multiplicities are written per side, so flipping the endpoints has
          // to carry them along or `"1" *-- "many"` lands the wrong way round.
          ...(srcMult ? { sourceMultiplicity: srcMult } : {}),
          ...(tgtMult ? { targetMultiplicity: tgtMult } : {}),
        },
      });
      continue;
    }

    // `Foo : +bar()` — the one-line member form.
    const member = text.match(/^([\w."'.-]+(?:\s*"[^"]*")?)\s*:\s*(.+)$/);
    if (member) {
      const id = ensure(member[1]);
      members.get(id)!.push(cleanLabel(member[2]));
      continue;
    }
    // A bare element mention (`Foo`) is a legal declaration too.
    if (/^[\w."'-]+$/.test(text)) { ensure(text); continue; }
    diagnostics.push({ line: n, message: `Unrecognized class statement: "${text}"` });
  }

  resolveContainerRefs(nodes, edges, groups, containers);

  // The class renderer splits compartments out of the newline-joined *label*
  // (name first, then members) rather than reading a data bag, so members must
  // be folded in here or they are silently dropped at render time.
  for (const [id, node] of nodes) {
    const list = members.get(id) || [];
    const name = names.get(id) || id;
    node.label = list.length ? [name, ...list].join('\n') : name;
    const { attributes, operations } = splitMembers(list);
    node.size = sizeForLabel(name, 16, 160, 56, 28, 14, [...attributes, ...operations]);
    node.size.height += (attributes.length > 0 ? 14 : 0) + (operations.length > 0 ? 14 : 0);
    node.data = { ...node.data, kind: 'class', compartments: { name, attributes, operations } };
  }

  return {
    id: 'plantuml-class',
    type: DiagramType.CLASS,
    title: title || 'Class Diagram',
    nodes: [...nodes.values()],
    edges,
    groups: [...groups.values()],
    layers: [],
    metadata: { importedFrom: 'plantuml' },
  };
}

// -----------------------------------------------------------------------------
// ER (Information Engineering notation)
// -----------------------------------------------------------------------------

/** Normalise one `entity { ... }` member line into the flat attribute text the
 *  ER renderer and the SQL-DDL exporter both read. PlantUML marks keys with a
 *  `<<PK>>` / `<<FK>>` stereotype, which cleanLabel() would strip as an HTML
 *  tag; both downstream consumers look for a bare `PK`/`FK` token instead, so
 *  the stereotype is unwrapped rather than preserved or dropped. The leading
 *  `*` mandatory marker is likewise noise once the key markers survive. */
function erAttributeLine(text: string): string {
  const markers: string[] = [];
  let s = text.replace(/<<\s*([^>]*?)\s*>>/g, (_m, inner: string) => {
    markers.push(String(inner).trim());
    return ' ';
  });
  s = cleanLabel(s).replace(/^\*\s*/, '').replace(/\s+/g, ' ').trim();
  return [s, ...markers.filter(Boolean)].join(' ').trim();
}

function importEr(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const names = new Map<string, string>();
  const attributes = new Map<string, string[]>();
  const edges: IREdge[] = [];

  const ensure = (ref: string, name?: string): string => {
    const id = slugId(unwrapName(ref));
    if (!nodes.has(id)) {
      nodes.set(id, makeNode(id, name || unwrapName(ref), ShapeType.RECTANGLE));
      attributes.set(id, []);
    }
    if (name || !names.has(id)) names.set(id, name || unwrapName(ref));
    return id;
  };

  let openEntity: string | null = null;

  for (const { text, n } of lines) {
    if (openEntity) {
      if (text === '}') { openEntity = null; continue; }
      // `--` splits the key block from the rest; keep the attributes, drop the
      // rule, and strip PlantUML's `*` mandatory marker into a plain `*`.
      if (/^([-.=_])\1*$/.test(text)) continue;
      attributes.get(openEntity)!.push(erAttributeLine(text));
      continue;
    }

    const decl = parseElementDecl(text);
    if (decl && (decl.keyword === 'entity' || decl.keyword === 'class' || decl.keyword === 'object')) {
      const id = ensure(decl.id, decl.label);
      if (decl.open) openEntity = id;
      continue;
    }

    const rel = parseRelation(text);
    if (rel) {
      const source = ensure(rel.source);
      const target = ensure(rel.target);
      edges.push({
        id: `er-${source}-${target}-${edges.length}`,
        sourceId: source,
        targetId: target,
        label: rel.label,
        style: {},
        routing: EdgeRouting.ORTHOGONAL,
        bidirectional: false,
        classList: [],
        // PlantUML's IE cardinalities are spelled exactly like Mermaid's, so
        // the same `sourceCardinality`/`targetCardinality` pair the ER
        // renderer already reads carries straight through.
        data: { sourceCardinality: rel.arrow.head || '||', targetCardinality: rel.arrow.tail || '||' },
      });
      continue;
    }
    diagnostics.push({ line: n, message: `Unrecognized ER statement: "${text}"` });
  }

  // renderErEntity() parses the entity table out of the `\n`-joined label and
  // sizes it with erEntitySize() — matching that here is what makes an
  // imported entity draw as a real table instead of a one-row box.
  for (const [id, node] of nodes) {
    const attrs = attributes.get(id) || [];
    const name = names.get(id) || id;
    node.label = attrs.length ? [name, ...attrs].join('\n') : name;
    node.size = erEntitySize(node.label);
    node.data = { attributes: attrs };
  }

  return {
    id: 'plantuml-er',
    type: DiagramType.ER,
    title: title || 'ER Diagram',
    nodes: [...nodes.values()],
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'plantuml' },
  };
}

// -----------------------------------------------------------------------------
// Use case
// -----------------------------------------------------------------------------

function importUsecase(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string, direction = 'LR'): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const edges: IREdge[] = [];
  const groups = new Map<string, IRGroup>();
  const groupStack: string[] = [];
  const containers = new Map<string, string>();

  const addToGroup = (nodeId: string) => {
    const gid = groupStack[groupStack.length - 1];
    if (!gid) return;
    const g = groups.get(gid)!;
    if (!g.childNodeIds.includes(nodeId)) g.childNodeIds.push(nodeId);
  };

  const put = (id: string, label: string, isActor: boolean) => {
    const node = makeNode(id, label, isActor ? ShapeType.ACTOR : ShapeType.ROUNDED_RECTANGLE);
    node.size = isActor ? { width: 70, height: 100 } : sizeForLabel(label, 14, 160, 64);
    node.data = { usecaseKind: isActor ? 'actor' : 'usecase' };
    nodes.set(id, node);
    addToGroup(id);
  };

  /** A reference's own delimiters classify it: `:Name:` is an actor, `(Text)`
   *  a use case. A bare identifier keeps whatever it was declared as, and
   *  defaults to a use case when it was never declared. */
  const ensure = (ref: string): string => {
    const s = ref.trim();
    const isActorRef = /^:[^:]+:$/.test(s);
    const label = unwrapName(s);
    const id = slugId(label);
    if (!nodes.has(id)) put(id, label, isActorRef);
    return id;
  };

  for (const { text, n } of lines) {
    if (text === '}') { groupStack.pop(); continue; }

    const decl = parseElementDecl(text);
    if (decl && decl.open && CONTAINER_KEYWORDS.has(decl.keyword)) {
      const group = makeGroup(`grp-${slugId(decl.id)}`, decl.label);
      groups.set(group.id, group);
      containers.set(slugId(decl.id), group.id);
      containers.set(slugId(decl.label), group.id);
      const parent = groupStack[groupStack.length - 1];
      if (parent) groups.get(parent)!.childGroupIds.push(group.id);
      groupStack.push(group.id);
      continue;
    }
    if (decl && (decl.keyword === 'actor' || decl.keyword === 'usecase' || decl.keyword === 'person')) {
      const id = slugId(decl.id);
      if (!nodes.has(id)) put(id, decl.label, decl.keyword !== 'usecase');
      continue;
    }

    const rel = parseRelation(text);
    if (rel) {
      const { flip } = relationKindOf(rel.arrow);
      const source = ensure(rel.source);
      const target = ensure(rel.target);
      edges.push({
        id: `uc-${source}-${target}-${edges.length}`,
        sourceId: flip ? target : source,
        targetId: flip ? source : target,
        // `<<include>>` / `<<extend>>` ride in as the edge label when no other
        // label was given — that stereotype *is* the relationship's name.
        label: rel.label || undefined,
        style: rel.arrow.dashed ? { strokeStyle: StrokeStyle.DASHED } : {},
        routing: EdgeRouting.ORTHOGONAL,
        bidirectional: false,
        classList: [],
        data: {},
      });
      continue;
    }
    if (decl) { const id = slugId(decl.id); if (!nodes.has(id)) put(id, decl.label, false); continue; }
    diagnostics.push({ line: n, message: `Unrecognized use case statement: "${text}"` });
  }

  resolveContainerRefs(nodes, edges, groups, containers);

  return {
    id: 'plantuml-usecase',
    type: DiagramType.USECASE,
    title: title || 'Use Case Diagram',
    nodes: [...nodes.values()],
    edges,
    groups: [...groups.values()],
    layers: [],
    metadata: { importedFrom: 'plantuml', direction },
  };
}

// -----------------------------------------------------------------------------
// Component / deployment
// -----------------------------------------------------------------------------

type ComponentKind = 'component' | 'datastore' | 'interface' | 'service';
type DeploymentKind = 'datastore' | 'node' | 'device' | 'artifact' | 'executionEnvironment';

/** PlantUML names the element kind outright, so unlike the DSL plugins (which
 *  guess from shape + wording) the mapping here is a lookup. The keyword-free
 *  `[Box]` shorthand falls back to the plugins' own keyword probe. */
function componentKindOf(keyword: string, label: string, id: string, stereotype?: string): ComponentKind {
  // An explicit `<<service>>` / `<<database>>` outranks every guess below: the
  // author said what the thing is.
  const st = (stereotype || '').trim().toLowerCase();
  if (st) {
    if (/^(service|microservice|api|gateway|worker)$/.test(st)) return 'service';
    if (/^(db|database|datastore|store|cache|queue|storage|table)$/.test(st)) return 'datastore';
    if (/^interfaces?$/.test(st)) return 'interface';
  }
  if (keyword === 'interface') return 'interface';
  if (/^(database|queue|storage|stack|file)$/.test(keyword)) return 'datastore';
  const probe = `${id} ${label}`.toLowerCase();
  if (/\b(db|database|cache|redis|store|queue|repository)\b/.test(probe)) return 'datastore';
  if (/\binterfaces?\b/.test(probe)) return 'interface';
  if (/\b(service|microservice|gateway|worker)\b/.test(probe)) return 'service';
  return 'component';
}

function deploymentKindOf(keyword: string, label: string, id: string, stereotype?: string): DeploymentKind {
  const st = (stereotype || '').trim().toLowerCase();
  if (st) {
    if (/^(db|database|datastore|store|cache|queue|storage)$/.test(st)) return 'datastore';
    if (/^(artifact|binary|package)$/.test(st)) return 'artifact';
    if (/^(device|phone|mobile|tablet|iot|sensor)$/.test(st)) return 'device';
    if (/^(container|docker|runtime|jvm|environment|env|sandbox)$/.test(st)) return 'executionEnvironment';
    if (/^nodes?$/.test(st)) return 'node';
  }
  if (keyword === 'database' || keyword === 'storage' || keyword === 'queue') return 'datastore';
  if (keyword === 'artifact' || keyword === 'file') return 'artifact';
  if (keyword === 'device') return 'device';
  const probe = `${id} ${label}`.toLowerCase();
  if (/\b(db|database|cache|redis|store|queue)\b/.test(probe)) return 'datastore';
  if (/\b(artifact|\.jar|\.war|\.dll|\.exe|binary|package)\b/.test(probe)) return 'artifact';
  if (/\b(device|phone|mobile|tablet|iot|sensor)\b/.test(probe)) return 'device';
  if (/\b(container|docker|runtime|jvm|environment|env|sandbox)\b/.test(probe)) return 'executionEnvironment';
  return 'node';
}

/**
 * Component and deployment diagrams share PlantUML's whole container/element
 * grammar — they differ only in which kind vocabulary the renderer wants — so
 * one walker serves both and the `type` argument picks the data bag.
 */
function importBoxes(
  lines: PLine[],
  diagnostics: PlantUmlImportDiagnostic[],
  type: DiagramType.COMPONENT | DiagramType.DEPLOYMENT,
  title?: string,
): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const edges: IREdge[] = [];
  const groups = new Map<string, IRGroup>();
  const groupStack: string[] = [];
  const containers = new Map<string, string>();
  const isComponent = type === DiagramType.COMPONENT;

  const addToGroup = (nodeId: string) => {
    const gid = groupStack[groupStack.length - 1];
    if (!gid) return;
    const g = groups.get(gid)!;
    if (!g.childNodeIds.includes(nodeId)) g.childNodeIds.push(nodeId);
  };

  const put = (id: string, label: string, keyword: string, stereotype?: string): string => {
    if (nodes.has(id)) return id;
    let node: IRNode;
    if (isComponent) {
      const kind = componentKindOf(keyword, label, id, stereotype);
      node = makeNode(id, label, kind === 'datastore' ? ShapeType.CYLINDER : kind === 'interface' ? ShapeType.CIRCLE : ShapeType.RECTANGLE);
      node.size = kind === 'interface' ? { width: 90, height: 90 } : { width: 170, height: 74 };
      node.data = { componentKind: kind, ...(stereotype ? { stereotype } : {}) };
    } else {
      const kind = deploymentKindOf(keyword, label, id, stereotype);
      node = makeNode(id, label, kind === 'datastore' ? ShapeType.CYLINDER : ShapeType.RECTANGLE);
      node.size = kind === 'artifact' ? { width: 150, height: 90 } : { width: 180, height: 84 };
      node.data = { deploymentKind: kind, ...(stereotype ? { stereotype } : {}) };
    }
    nodes.set(id, node);
    addToGroup(id);
    return id;
  };

  const ensure = (ref: string): string => {
    const label = unwrapName(ref);
    const id = slugId(label);
    if (!nodes.has(id)) put(id, label, 'component');
    return id;
  };

  for (const { text, n } of lines) {
    if (text === '}') { groupStack.pop(); continue; }

    const decl = parseElementDecl(text);
    if (decl && decl.open && CONTAINER_KEYWORDS.has(decl.keyword)) {
      const group = makeGroup(`grp-${slugId(decl.id)}`, decl.label);
      group.data = { containerKind: decl.keyword };
      groups.set(group.id, group);
      containers.set(slugId(decl.id), group.id);
      containers.set(slugId(decl.label), group.id);
      const parent = groupStack[groupStack.length - 1];
      if (parent) groups.get(parent)!.childGroupIds.push(group.id);
      groupStack.push(group.id);
      continue;
    }
    if (decl && !decl.open) { put(slugId(decl.id), decl.label, decl.keyword, decl.stereotype); continue; }

    const rel = parseRelation(text);
    if (rel) {
      const { flip } = relationKindOf(rel.arrow);
      const source = ensure(rel.source);
      const target = ensure(rel.target);
      edges.push({
        id: `${isComponent ? 'comp' : 'dep'}-${source}-${target}-${edges.length}`,
        sourceId: flip ? target : source,
        targetId: flip ? source : target,
        label: rel.label,
        style: rel.arrow.dashed ? { strokeStyle: StrokeStyle.DASHED } : {},
        routing: EdgeRouting.ORTHOGONAL,
        bidirectional: false,
        classList: [],
        data: {},
      });
      continue;
    }
    diagnostics.push({ line: n, message: `Unrecognized statement: "${text}"` });
  }

  resolveContainerRefs(nodes, edges, groups, containers);

  return {
    id: isComponent ? 'plantuml-component' : 'plantuml-deployment',
    type,
    title: title || (isComponent ? 'Component Diagram' : 'Deployment Diagram'),
    nodes: [...nodes.values()],
    edges,
    groups: [...groups.values()],
    layers: [],
    metadata: { importedFrom: 'plantuml' },
  };
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

function importState(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const edges: IREdge[] = [];
  const groups = new Map<string, IRGroup>();
  const groupStack: string[] = [];
  const containers = new Map<string, string>();
  let startCounter = 0;
  let endCounter = 0;

  const addToGroup = (nodeId: string) => {
    const gid = groupStack[groupStack.length - 1];
    if (!gid) return;
    const g = groups.get(gid)!;
    if (!g.childNodeIds.includes(nodeId)) g.childNodeIds.push(nodeId);
  };

  // `[*]` is a shared start/end token: every occurrence on a transition's
  // source side is a distinct start pseudostate, every one on the target side
  // a distinct end pseudostate. Collapsing them onto one node would wire
  // together transitions that were never connected.
  const ensure = (ref: string, isSource: boolean): string => {
    const s = ref.trim();
    if (s === '[*]') {
      const id = isSource ? `__start_${startCounter++}` : `__end_${endCounter++}`;
      const node = makeNode(id, '[*]', ShapeType.CIRCLE);
      node.size = { width: 40, height: 40 };
      nodes.set(id, node);
      addToGroup(id);
      return id;
    }
    const label = unwrapName(s);
    const id = slugId(label);
    if (!nodes.has(id)) {
      nodes.set(id, makeNode(id, label, ShapeType.ROUNDED_RECTANGLE));
      addToGroup(id);
    }
    return id;
  };

  for (const { text, n } of lines) {
    if (text === '}') { groupStack.pop(); continue; }

    const decl = parseElementDecl(text);
    if (decl && decl.keyword === 'state') {
      if (decl.open) {
        // A composite state is a container: the IR models it as a group so its
        // substates nest visually instead of floating beside it.
        const group = makeGroup(`state-${slugId(decl.id)}`, decl.label);
        groups.set(group.id, group);
        containers.set(slugId(decl.id), group.id);
        containers.set(slugId(decl.label), group.id);
        const parent = groupStack[groupStack.length - 1];
        if (parent) groups.get(parent)!.childGroupIds.push(group.id);
        groupStack.push(group.id);
      } else {
        const id = slugId(decl.id);
        if (!nodes.has(id)) {
          nodes.set(id, makeNode(id, decl.label, ShapeType.ROUNDED_RECTANGLE));
          addToGroup(id);
        } else {
          nodes.get(id)!.label = decl.label;
        }
      }
      continue;
    }

    const rel = parseRelation(text);
    if (rel) {
      const { flip } = relationKindOf(rel.arrow);
      const source = ensure(flip ? rel.target : rel.source, true);
      const target = ensure(flip ? rel.source : rel.target, false);
      edges.push({
        id: `st-${source}-${target}-${edges.length}`,
        sourceId: source,
        targetId: target,
        label: rel.label,
        style: rel.arrow.dashed ? { strokeStyle: StrokeStyle.DASHED } : {},
        routing: EdgeRouting.ORTHOGONAL,
        bidirectional: false,
        classList: [],
        data: {},
      });
      continue;
    }
    // `Idle : entry / start timer` — an internal action on a state.
    const action = text.match(/^([\w."'-]+)\s*:\s*(.+)$/);
    if (action) {
      const id = ensure(action[1], true);
      const node = nodes.get(id)!;
      node.label = `${node.label}\n${cleanLabel(action[2])}`;
      node.size = sizeForLabel(node.label, 14, 100, 50);
      continue;
    }
    diagnostics.push({ line: n, message: `Unrecognized state statement: "${text}"` });
  }

  resolveContainerRefs(nodes, edges, groups, containers);

  return {
    id: 'plantuml-state',
    type: DiagramType.STATE,
    title: title || 'State Diagram',
    nodes: [...nodes.values()],
    edges,
    groups: [...groups.values()],
    layers: [],
    metadata: { importedFrom: 'plantuml' },
  };
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

type ActivityKind = 'start' | 'end' | 'decision' | 'action';

/** Frames on the activity control stack. Each remembers what has to be wired
 *  up when its closing keyword arrives: the branch ends waiting to merge, the
 *  loop head to jump back to, and so on. */
interface ActivityFrame {
  kind: 'if' | 'while' | 'repeat' | 'fork';
  headId: string;
  /** Ends of finished branches, waiting for the merge point. */
  pending: string[];
  /** Label for the edge leaving the head into the branch being built now. */
  branchLabel?: string;
  /** For `if`: whether an explicit `else` branch was seen. */
  sawElse: boolean;
  /** Predecessors at the moment the frame opened, for fork/split fan-out. */
  entry: string[];
}

/**
 * Read `if (cond) then (label)` / `while (cond) is (label)` / `repeat while
 * (cond)` after their keyword.
 *
 * The trailing `then (…)`/`is (…)` clause is peeled off *before* the condition
 * is read, because a condition legitimately contains parentheses of its own
 * (`if (a) or (b) then (yes)`) and a single regex has to choose between being
 * greedy — which swallows the clause into the condition — and being lazy,
 * which truncates the condition at its first inner `)`.
 */
function parseCondition(text: string, keyword: RegExp): { condition: string; branch?: string } | null {
  if (!keyword.test(text)) return null;
  let rest = text.replace(keyword, '').trim();
  let branch: string | undefined;
  const clause = rest.match(/\)\s*(?:then|is)\s*\((.*)\)\s*$/i);
  if (clause) {
    branch = cleanLabel(clause[1]) || undefined;
    rest = rest.slice(0, clause.index! + 1).trim();
  }
  const cond = rest.match(/^\((.*)\)$/s);
  if (!cond) return null;
  return { condition: cleanLabel(cond[1]), branch };
}

function importActivity(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string): DiagramIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  const groups = new Map<string, IRGroup>();
  const groupStack: string[] = [];
  const stack: ActivityFrame[] = [];
  let counter = 0;
  /** Node ids the next statement should be connected *from*. A list, because
   *  a merge point has several incoming branches. */
  let prev: string[] = [];
  let pendingLabel: string | undefined;

  const add = (label: string, kind: ActivityKind): string => {
    const id = `act-${counter++}`;
    const node = makeNode(id, kind === 'start' || kind === 'end' ? '' : label,
      kind === 'start' || kind === 'end' ? ShapeType.CIRCLE : kind === 'decision' ? ShapeType.DIAMOND : ShapeType.ROUNDED_RECTANGLE);
    node.size = kind === 'start' || kind === 'end' ? { width: 48, height: 48 }
      : kind === 'decision' ? sizeForShape(label, 'diamond', 14, 130, 90)
        : sizeForLabel(label, 14, 160, 60);
    node.data = { activityKind: kind, activityLabel: label };
    nodes.push(node);
    const gid = groupStack[groupStack.length - 1];
    if (gid) groups.get(gid)!.childNodeIds.push(id);
    return id;
  };

  const connect = (from: string, to: string, label?: string) => {
    edges.push({
      id: `acte-${from}-${to}-${edges.length}`,
      sourceId: from,
      targetId: to,
      label: label || undefined,
      style: {},
      routing: EdgeRouting.ORTHOGONAL,
      bidirectional: false,
      classList: [],
      data: {},
    });
  };

  /** Wire every pending predecessor into `id` and make it the new tip. */
  const flowTo = (id: string) => {
    for (const p of prev) connect(p, id, pendingLabel);
    pendingLabel = undefined;
    prev = [id];
  };

  // A `:action;` may span several source lines; join them before dispatch.
  const joined: PLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    let { text, n } = lines[i];
    if (text.startsWith(':') && !/[;<>/\]}|]$/.test(text)) {
      while (i + 1 < lines.length && !/[;<>/\]}|]$/.test(text)) {
        i++;
        text += `\n${lines[i].text}`;
      }
    }
    joined.push({ text, n });
  }

  for (const { text, n } of joined) {
    // ── Legacy syntax: `(*) --> "Do the thing"`.
    if (text.includes('(*)') || /^"[^"]+"\s*-/.test(text)) {
      const rel = parseRelation(text);
      if (rel) {
        const ref = (r: string, isSource: boolean): string => {
          const s = r.trim();
          if (/^\(\*\)$/.test(s)) return add('', isSource ? 'start' : 'end');
          const label = unwrapName(s);
          const existing = nodes.find((x) => x.data.activityLabel === label);
          return existing ? existing.id : add(label, /\?$/.test(label) ? 'decision' : 'action');
        };
        const source = ref(rel.source, true);
        const target = ref(rel.target, false);
        connect(source, target, rel.label);
        prev = [target];
        continue;
      }
    }

    if (/^start$/i.test(text)) { const id = add('', 'start'); if (prev.length) flowTo(id); else prev = [id]; continue; }
    if (/^(stop|end)$/i.test(text)) { const id = add('', 'end'); flowTo(id); prev = []; continue; }
    if (/^(kill|detach)$/i.test(text)) { prev = []; continue; }

    // `-> edge label;` annotates the *next* connection.
    const arrowLabel = text.match(/^->\s*(.+?);?$/);
    if (arrowLabel) { pendingLabel = cleanLabel(arrowLabel[1]); continue; }

    // `partition Name {` / `group Name {` — a swimlane-ish container.
    const partition = text.match(/^(partition|group|package)\s+(.+?)\s*\{$/i);
    if (partition) {
      const group = makeGroup(`part-${slugId(partition[2])}`, cleanLabel(partition[2]));
      groups.set(group.id, group);
      const parent = groupStack[groupStack.length - 1];
      if (parent) groups.get(parent)!.childGroupIds.push(group.id);
      groupStack.push(group.id);
      continue;
    }

    const ifOpen = parseCondition(text, /^if\s*/i);
    if (ifOpen) {
      const id = add(ifOpen.condition || '?', 'decision');
      flowTo(id);
      const yes = ifOpen.branch || 'yes';
      stack.push({ kind: 'if', headId: id, pending: [], branchLabel: yes, sawElse: false, entry: [] });
      pendingLabel = yes;
      prev = [id];
      continue;
    }
    const elseIf = parseCondition(text, /^else\s?if\s*/i);
    if (elseIf) {
      const frame = stack[stack.length - 1];
      if (frame && frame.kind === 'if') {
        frame.pending.push(...prev);
        // The chained condition hangs off the previous decision's "no" edge.
        const id = add(elseIf.condition || '?', 'decision');
        connect(frame.headId, id, frame.branchLabel === 'yes' ? 'no' : undefined);
        frame.headId = id;
        frame.branchLabel = elseIf.branch || 'yes';
        pendingLabel = frame.branchLabel;
        prev = [id];
      }
      continue;
    }
    const elseOpen = text.match(/^else\s*(?:\((.*)\))?\s*$/i);
    if (elseOpen) {
      const frame = stack[stack.length - 1];
      if (frame && frame.kind === 'if') {
        frame.pending.push(...prev);
        frame.sawElse = true;
        pendingLabel = elseOpen[1] ? cleanLabel(elseOpen[1]) : 'no';
        prev = [frame.headId];
      }
      continue;
    }
    if (/^endif$/i.test(text)) {
      const frame = stack.pop();
      if (frame) {
        // Without an explicit `else`, the decision's other exit is itself a
        // pending branch end — otherwise the "no" path would vanish.
        const ends = [...frame.pending, ...prev];
        if (!frame.sawElse) ends.push(frame.headId);
        prev = [...new Set(ends)];
        pendingLabel = undefined;
      }
      continue;
    }

    const whileOpen = parseCondition(text, /^while\s*/i);
    if (whileOpen) {
      const id = add(whileOpen.condition || '?', 'decision');
      flowTo(id);
      const yes = whileOpen.branch || 'yes';
      stack.push({ kind: 'while', headId: id, pending: [], branchLabel: yes, sawElse: false, entry: [] });
      pendingLabel = yes;
      prev = [id];
      continue;
    }
    const whileClose = text.match(/^endwhile\s*(?:\((.*)\))?\s*$/i);
    if (whileClose) {
      const frame = stack.pop();
      if (frame) {
        // The loop body flows back into the condition; the condition's other
        // exit is what continues after the loop.
        for (const p of prev) if (p !== frame.headId) connect(p, frame.headId);
        prev = [frame.headId];
        pendingLabel = whileClose[1] ? cleanLabel(whileClose[1]) : 'no';
      }
      continue;
    }

    if (/^repeat$/i.test(text)) {
      const id = add('repeat', 'action');
      flowTo(id);
      stack.push({ kind: 'repeat', headId: id, pending: [], sawElse: false, entry: [] });
      prev = [id];
      continue;
    }
    const repeatWhile = parseCondition(text, /^repeat\s+while\s*/i);
    if (repeatWhile) {
      const frame = stack.pop();
      const id = add(repeatWhile.condition || '?', 'decision');
      flowTo(id);
      if (frame) connect(id, frame.headId, repeatWhile.branch || 'yes');
      prev = [id];
      pendingLabel = 'no';
      continue;
    }

    if (/^(fork|split)$/i.test(text)) {
      stack.push({ kind: 'fork', headId: '', pending: [], sawElse: false, entry: [...prev] });
      continue;
    }
    if (/^(fork\s?again|split\s?again)$/i.test(text)) {
      const frame = stack[stack.length - 1];
      if (frame && frame.kind === 'fork') { frame.pending.push(...prev); prev = [...frame.entry]; }
      continue;
    }
    if (/^end\s?(fork|split|merge)$/i.test(text)) {
      const frame = stack.pop();
      if (frame) { prev = [...new Set([...frame.pending, ...prev])]; }
      continue;
    }
    if (text === '}') { groupStack.pop(); continue; }

    // ── The ordinary action: `:Do the thing;`
    const action = text.match(/^:([\s\S]*?)\s*[;<>/\]}|]$/);
    if (action) {
      const label = cleanLabel(action[1].replace(/\n/g, ' '));
      const id = add(label, /\?$/.test(label) ? 'decision' : 'action');
      flowTo(id);
      continue;
    }

    diagnostics.push({ line: n, message: `Unrecognized activity statement: "${text}"` });
  }

  return {
    id: 'plantuml-activity',
    type: DiagramType.ACTIVITY,
    title: title || 'Activity Diagram',
    nodes,
    edges,
    groups: [...groups.values()],
    layers: [],
    metadata: { importedFrom: 'plantuml' },
  };
}

// -----------------------------------------------------------------------------
// Mindmap / WBS
// -----------------------------------------------------------------------------

/**
 * `@startmindmap` and `@startwbs` share one outline grammar: repetition of a
 * marker character sets the depth. `*` is the neutral marker, while `+` and
 * `-` additionally pick the side of the root the branch hangs on — a layout
 * concern SelDiA's radial mindmap decides for itself, so the side is recorded
 * on `data` and not otherwise acted on.
 */
function importMindmap(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string): DiagramIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  const stack: Array<{ depth: number; id: string }> = [];
  let counter = 0;
  let pending: { depth: number; side: string; boxless: boolean; parts: string[] } | null = null;

  const emit = (depth: number, side: string, boxless: boolean, label: string, lineNo: number) => {
    const id = `mm-${counter++}`;
    const node = makeNode(id, label, boxless ? ShapeType.NONE : ShapeType.ROUNDED_RECTANGLE);
    node.data = { side };
    nodes.push(node);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      edges.push({
        id: `mm-edge-${parent.id}-${id}`, sourceId: parent.id, targetId: id, style: {},
        routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {},
      });
    } else if (nodes.length > 1) {
      diagnostics.push({ line: lineNo, message: `Mindmap node "${label}" has no parent (marker depth may be inconsistent)` });
    }
    stack.push({ depth, id });
  };

  for (const { text, n } of lines) {
    // Multi-line node: `**:first line\nsecond line;`
    if (pending) {
      if (/;$/.test(text)) {
        pending.parts.push(text.slice(0, -1));
        emit(pending.depth, pending.side, pending.boxless, cleanLabel(pending.parts.join('\n')), n);
        pending = null;
      } else {
        pending.parts.push(text);
      }
      continue;
    }
    // `--- separator` / `@startmindmap` leftovers.
    if (/^-{3,}$/.test(text)) continue;

    const m = text.match(/^([*+-]+)(_?)\s*(.*)$/);
    if (!m) {
      diagnostics.push({ line: n, message: `Unrecognized mindmap statement: "${text}"` });
      continue;
    }
    const markers = m[1];
    const depth = markers.length;
    const side = markers[0] === '-' ? 'left' : 'right';
    const boxless = m[2] === '_';
    let rest = m[3];

    // `[#color]` boxes and `<style>` prefixes are decoration only.
    rest = rest.replace(/^\[#[^\]]*\]\s*/, '').replace(/^<[^>]*>\s*/, '');

    if (rest.startsWith(':')) {
      const body = rest.slice(1);
      if (/;$/.test(body)) emit(depth, side, boxless, cleanLabel(body.slice(0, -1)), n);
      else pending = { depth, side, boxless, parts: [body] };
      continue;
    }
    emit(depth, side, boxless, cleanLabel(rest), n);
  }

  return {
    id: 'plantuml-mindmap',
    type: DiagramType.MINDMAP,
    title: title || 'Mindmap',
    nodes,
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'plantuml' },
  };
}

// -----------------------------------------------------------------------------
// Gantt
// -----------------------------------------------------------------------------

const GANTT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoToLabel(iso: string): string {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${GANTT_MONTHS[Math.max(0, Math.min(11, parseInt(m[1], 10) - 1))]} ${parseInt(m[2], 10)}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Durations are written in days/weeks/months; everything is normalised to
 *  days because the Gantt layout's calendar is day-granular. */
function durationDays(count: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('week')) return count * 7;
  if (u.startsWith('month')) return count * 30;
  return count;
}

interface GanttTask {
  id: string;
  title: string;
  start?: string;
  days: number;
  milestone: boolean;
  /** Task this one is scheduled relative to, resolved in a second pass. */
  afterId?: string;
  atStartOf?: string;
}

/**
 * PlantUML's Gantt is relational where Mermaid's is absolute: tasks say
 * `starts at [Other]'s end` as often as they give a date. So tasks are
 * collected first and scheduled second, walking the dependency chain — a
 * single pass could not resolve a task that refers to one declared later.
 */
function importGantt(lines: PLine[], diagnostics: PlantUmlImportDiagnostic[], title?: string): DiagramIR {
  const tasks: GanttTask[] = [];
  const byTitle = new Map<string, GanttTask>();
  let projectStart: string | null = null;

  const taskFor = (name: string): GanttTask => {
    const key = cleanLabel(name);
    let t = byTitle.get(key);
    if (!t) {
      t = { id: `task-${tasks.length}`, title: key, days: 1, milestone: false };
      tasks.push(t);
      byTitle.set(key, t);
    }
    return t;
  };

  for (const { text, n } of lines) {
    const project = text.match(/^project\s+starts?\s+(?:on\s+)?(\d{4}[-/]\d{2}[-/]\d{2})/i);
    if (project) { projectStart = project[1].replace(/\//g, '-'); continue; }
    if (/^(printscale|language|weeks?tarts|saturday|sunday|today|hide\b|<style>)/i.test(text)) continue;
    // `[Task] is colored in ...`, `[Task] displays on same row as ...`
    if (/\b(is\s+colored|displays\s+on|links\s+to|is\s+deleted)\b/i.test(text)) continue;

    const named = text.match(/^\[([^\]]+)\]\s*(.*)$/);
    const milestone = text.match(/^\[([^\]]+)\]\s+happens\s+(.*)$/i);
    if (milestone) {
      const t = taskFor(milestone[1]);
      t.milestone = true;
      t.days = 0;
      const on = milestone[2].match(/(\d{4}[-/]\d{2}[-/]\d{2})/);
      if (on) t.start = on[1].replace(/\//g, '-');
      const after = milestone[2].match(/\[([^\]]+)\]'?s?\s+end/i);
      if (after) t.afterId = taskFor(after[1]).id;
      continue;
    }
    if (named) {
      const t = taskFor(named[1]);
      const rest = named[2];
      const lasts = rest.match(/lasts?\s+(\d+)\s*(day|week|month)s?/i);
      if (lasts) t.days = durationDays(parseInt(lasts[1], 10), lasts[2]);
      const startsOn = rest.match(/starts?\s+(?:on\s+)?(\d{4}[-/]\d{2}[-/]\d{2})/i);
      if (startsOn) t.start = startsOn[1].replace(/\//g, '-');
      const endsOn = rest.match(/ends?\s+(?:on\s+)?(\d{4}[-/]\d{2}[-/]\d{2})/i);
      if (endsOn && t.start) t.days = Math.max(1, daysBetween(t.start, endsOn[1].replace(/\//g, '-')));
      const afterEnd = rest.match(/starts?\s+at\s+\[([^\]]+)\]'?s?\s+end/i);
      if (afterEnd) t.afterId = taskFor(afterEnd[1]).id;
      const atStart = rest.match(/starts?\s+at\s+\[([^\]]+)\]'?s?\s+start/i);
      if (atStart) t.atStartOf = taskFor(atStart[1]).id;
      if (!lasts && !startsOn && !endsOn && !afterEnd && !atStart && rest.trim()) {
        diagnostics.push({ line: n, message: `Unrecognized gantt clause: "${text}"` });
      }
      continue;
    }
    diagnostics.push({ line: n, message: `Unrecognized gantt statement: "${text}"` });
  }

  // Schedule: absolute dates win, then relative anchors, then "after the
  // previous task" — the same fallback PlantUML itself applies.
  const base = projectStart || new Date().toISOString().slice(0, 10);
  const startOf = new Map<string, string>();
  const endOf = new Map<string, string>();
  const resolve = (t: GanttTask, guard = 0): string => {
    const known = startOf.get(t.id);
    if (known) return known;
    if (guard > tasks.length) return base;
    let start: string;
    if (t.start) start = t.start;
    else if (t.afterId) {
      const dep = tasks.find((x) => x.id === t.afterId)!;
      resolve(dep, guard + 1);
      start = endOf.get(dep.id) || base;
    } else if (t.atStartOf) {
      const dep = tasks.find((x) => x.id === t.atStartOf)!;
      start = resolve(dep, guard + 1);
    } else {
      const idx = tasks.indexOf(t);
      const prevTask = idx > 0 ? tasks[idx - 1] : null;
      if (prevTask) { resolve(prevTask, guard + 1); start = endOf.get(prevTask.id) || base; }
      else start = base;
    }
    startOf.set(t.id, start);
    endOf.set(t.id, addDays(start, t.days));
    return start;
  };
  for (const t of tasks) resolve(t);

  const nodes = tasks.map((t) => {
    const start = startOf.get(t.id) || base;
    const end = endOf.get(t.id) || start;
    // custom-layout.ts's parseGanttLabel only speaks "Mon D" / "Mon D-D2", so
    // ISO dates are converted into that vocabulary rather than passed raw.
    // parseGanttLabel understands "Mon D", "Mon D-D2" and the cross-month
    // "Mon D - Mon2 D2"; a range that spans months has to use the third form
    // or the end day is read against the start month.
    const sameMonth = start.slice(0, 7) === end.slice(0, 7);
    const label = t.milestone || start === end
      ? `${t.title}: ${isoToLabel(start)}`
      : sameMonth
        ? `${t.title}: ${isoToLabel(start)}-${parseInt(end.slice(8, 10), 10)}`
        : `${t.title}: ${isoToLabel(start)} - ${isoToLabel(end)}`;
    const node = makeNode(t.id, label, ShapeType.RECTANGLE);
    node.data = { startDate: start, endDate: end, milestone: t.milestone };
    return node;
  });

  return {
    id: 'plantuml-gantt',
    type: DiagramType.GANTT,
    title: title || 'Gantt Chart',
    nodes,
    edges: [],
    groups: [],
    layers: [],
    metadata: { importedFrom: 'plantuml' },
  };
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/** Does this source look like PlantUML? Used to auto-route mixed fenced
 *  blocks and files whose extension does not say. The `@start…` wrapper is the
 *  unambiguous marker; a bare body is only claimed when it opens with a
 *  keyword Mermaid has no use for. */
export function isPlantUmlSource(source: string): boolean {
  if (/^\s*@start\w+/im.test(source)) return true;
  const first = source
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("'"));
  if (!first) return false;
  return /^(participant|actor|usecase|component|abstract\s+class|class|interface|entity|node|artifact|skinparam)\b/i.test(first)
    && !/^(classDiagram|erDiagram|sequenceDiagram|stateDiagram)/i.test(first);
}

/**
 * Parse PlantUML source into SelDiA IR.
 *
 * Never throws on malformed input: unparseable statements become diagnostics
 * so a partially-broken diagram still renders what it can. A block that has no
 * IR mapping at all (`@startjson`, `@startsalt`, …) yields no IR, which
 * callers should treat as "leave this block to PlantUML".
 */
export function importPlantUml(source: string): PlantUmlImportResult {
  const diagnostics: PlantUmlImportDiagnostic[] = [];
  const { lines, block, title, direction } = preprocess(source);

  if (!lines.length) {
    diagnostics.push({ line: 1, message: 'Empty PlantUML source' });
    return { diagnostics };
  }

  if (NON_DIAGRAM_BLOCKS.has(block)) {
    diagnostics.push({
      line: 1,
      message: `Unsupported PlantUML block: "@start${block}". Supported: sequence, class, ER, use case, activity, component, deployment, state, mindmap, wbs, gantt.`,
    });
    return { diagnostics };
  }

  const type = detectPlantUmlType(lines, block);
  if (!type) {
    diagnostics.push({ line: 1, message: 'Could not determine the PlantUML diagram type from its statements.' });
    return { diagnostics };
  }

  switch (type) {
    case DiagramType.SEQUENCE:
      return { ir: importSequence(lines, diagnostics, title), diagnostics };
    case DiagramType.CLASS:
      return { ir: importClass(lines, diagnostics, title), diagnostics };
    case DiagramType.ER:
      return { ir: importEr(lines, diagnostics, title), diagnostics };
    case DiagramType.USECASE:
      return { ir: importUsecase(lines, diagnostics, title, direction), diagnostics };
    case DiagramType.ACTIVITY:
      return { ir: importActivity(lines, diagnostics, title), diagnostics };
    case DiagramType.COMPONENT:
      return { ir: importBoxes(lines, diagnostics, DiagramType.COMPONENT, title), diagnostics };
    case DiagramType.DEPLOYMENT:
      return { ir: importBoxes(lines, diagnostics, DiagramType.DEPLOYMENT, title), diagnostics };
    case DiagramType.STATE:
      return { ir: importState(lines, diagnostics, title), diagnostics };
    case DiagramType.MINDMAP:
      return { ir: importMindmap(lines, diagnostics, title), diagnostics };
    case DiagramType.GANTT:
      return { ir: importGantt(lines, diagnostics, title), diagnostics };
    default:
      return { diagnostics };
  }
}
