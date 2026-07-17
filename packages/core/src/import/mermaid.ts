// =============================================================================
// SelDiA — Mermaid Importer
// =============================================================================
// Parses Mermaid source directly into SelDiA's IR. This is a *frontend*, not a
// translator: it does not emit SelDiA DSL text and then re-parse it. Mermaid is
// a peer input format, so it gets its own source→IR path, exactly like the DSL
// has its own source→AST→IR path. Going through the DSL as an intermediate
// would make every Mermaid construct hostage to whatever the DSL can express,
// which is the leak that would re-open the format war.
//
// Scope: flowchart, sequence, class, ER, state, gantt, pie, gitGraph, and
// mindmap. Journey is deliberately not covered — there is no IR/renderer for
// it anywhere in the engine yet (not a Mermaid-import gap, an engine gap).
// Unsupported diagram types report a diagnostic rather than throwing, so a
// document containing one bad block still renders its other blocks.
//
// Flowchart also imports styling directives (`style`, `classDef`+`class`,
// `linkStyle`), mapped onto IRNode.style / IREdge.style.
// =============================================================================

import type { DiagramIR, IRNode, IREdge, IRGroup } from '../ir/types.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle, type NodeStyle, type EdgeStyle } from '../types/style.js';
import { sizeForLabel } from '../layout/text-measure.js';
import { erEntitySize } from '../render/custom-renderers.js';

export interface MermaidImportDiagnostic {
  line: number;
  message: string;
}

export interface MermaidImportResult {
  ir?: DiagramIR;
  diagnostics: MermaidImportDiagnostic[];
}

/** Mermaid's header keyword → the SelDiA IR type it maps onto. */
const HEADER_TYPES: Array<[RegExp, DiagramType]> = [
  [/^(?:flowchart|graph)\b/i, DiagramType.FLOWCHART],
  [/^sequenceDiagram\b/i, DiagramType.SEQUENCE],
  [/^classDiagram\b/i, DiagramType.CLASS],
  [/^erDiagram\b/i, DiagramType.ER],
  [/^stateDiagram(-v2)?\b/i, DiagramType.STATE],
  [/^gantt\b/i, DiagramType.GANTT],
  [/^pie\b/i, DiagramType.CHART_PIE],
  [/^gitGraph\b/i, DiagramType.GITGRAPH],
  [/^mindmap\b/i, DiagramType.MINDMAP],
];

/** Mermaid direction token → SelDiA layout direction. */
const DIRECTIONS: Record<string, string> = {
  TB: 'TB',
  TD: 'TB',
  BT: 'BT',
  RL: 'RL',
  LR: 'LR',
};

/**
 * Mermaid node bracket syntax → SelDiA shape. Order matters: the longest
 * delimiters must be tested first, or `[[Subroutine]]` matches the `[Rect]`
 * pattern and silently loses its shape.
 */
const SHAPE_PATTERNS: Array<{ open: string; close: string; shape: ShapeType }> = [
  { open: '([', close: '])', shape: ShapeType.STADIUM },
  { open: '[[', close: ']]', shape: ShapeType.SUBROUTINE },
  { open: '[(', close: ')]', shape: ShapeType.CYLINDER },
  { open: '((', close: '))', shape: ShapeType.CIRCLE },
  { open: '{{', close: '}}', shape: ShapeType.HEXAGON },
  { open: '[/', close: '/]', shape: ShapeType.PARALLELOGRAM },
  { open: '[\\', close: '\\]', shape: ShapeType.PARALLELOGRAM },
  { open: '>', close: ']', shape: ShapeType.NOTE },
  { open: '[', close: ']', shape: ShapeType.RECTANGLE },
  { open: '(', close: ')', shape: ShapeType.ROUNDED_RECTANGLE },
  { open: '{', close: '}', shape: ShapeType.DIAMOND },
];

/** Strip Mermaid's optional quoting and unescape its `#nn;` entities. */
function cleanLabel(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
      (s.startsWith("'") && s.endsWith("'") && s.length > 1)) {
    s = s.slice(1, -1);
  }
  // Mermaid uses <br/> for line breaks; the IR carries them as real newlines.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
  return s.trim();
}

/**
 * Index of `token` in `s`, skipping any occurrence inside a quoted run.
 * Mermaid labels are quoted precisely so they can contain delimiter
 * characters, so quote-awareness is what keeps `a["x<br/>y"]` from being read
 * as a `>`-shaped node.
 */
function indexOfUnquoted(s: string, token: string): number {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (s.startsWith(token, i)) return i;
  }
  return -1;
}

/** Classify class members exactly as `diagrams/class.ts` does: a line holding
 *  `(` is a method signature, anything else is an attribute. Mirrored here (not
 *  imported — it's private to that plugin) so the size this importer reserves
 *  matches the compartments the renderer actually draws. */
function splitMembers(lines: string[]): { attributes: string[]; operations: string[] } {
  const attributes: string[] = [];
  const operations: string[] = [];
  for (const line of lines) {
    if (line.includes('(')) operations.push(line);
    else attributes.push(line);
  }
  return { attributes, operations };
}

/**
 * Split one side of a link on Mermaid's `&` shorthand (`a & b --> c`).
 * Only a top-level `&` separates: one inside quotes or inside a node's bracket
 * label is part of the label (`[R&D]`, `["Sales & Ops"]`) and must not split.
 */
function splitAmpersand(side: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < side.length; i++) {
    const ch = side[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[' || ch === '(' || ch === '{') depth++;
    else if (ch === ']' || ch === ')' || ch === '}') depth--;
    else if (ch === '&' && depth === 0) {
      parts.push(side.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(side.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Parse Mermaid's inline CSS-like style string (`fill:#f9f,stroke:#333,
 * stroke-width:2px`) into a `Partial<NodeStyle>` / `Partial<EdgeStyle>`.
 * Both node and edge styling directives share this same property syntax, so
 * one parser serves `style`, `classDef`, and `linkStyle`.
 */
function parseStyleDecl(decl: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const pair of decl.split(',')) {
    const idx = pair.indexOf(':');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim().toLowerCase();
    const value = pair.slice(idx + 1).trim();
    switch (key) {
      case 'fill':
        out.fill = value;
        break;
      case 'stroke':
        out.stroke = value;
        break;
      case 'stroke-width': {
        const w = parseFloat(value);
        if (!Number.isNaN(w)) out.strokeWidth = w;
        break;
      }
      case 'stroke-dasharray':
        out.strokeDasharray = value;
        break;
      case 'color':
        out.textColor = value;
        break;
      case 'opacity': {
        const o = parseFloat(value);
        if (!Number.isNaN(o)) out.opacity = o;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function makeNode(id: string, label: string, shape: ShapeType): IRNode {
  return {
    id,
    label,
    shape,
    position: { x: 0, y: 0 },
    size: sizeForLabel(label, 14, 100, 50),
    style: {},
    ports: [],
    classList: [],
    collapsed: false,
    data: {},
  };
}

/**
 * Split a flowchart statement into [sourceRef, connector, targetRef] chunks.
 * Mermaid allows chains (`a --> b --> c`), so this returns every link found.
 * Returns null when the line holds no connector at all.
 */
const EDGE_RE = /\s*(<?-{2,3}>|<?={2,3}>|-{2,3}|\.{2,3}->|-\.->|-{2,3}[ox]|<?-{1,2}\.{1,2}-{1,2}>?)\s*/;

interface RawLink {
  connector: string;
  label?: string;
}

/**
 * Parse `A -->|yes| B` / `A -- text --> B` / `A --> B`, tolerating chains.
 * Mermaid puts edge labels either in pipes after the connector or inline
 * between two connector halves; both forms appear constantly in real repos.
 */
function splitFlowLine(line: string): { refs: string[]; links: RawLink[] } | null {
  const refs: string[] = [];
  const links: RawLink[] = [];
  let rest = line;
  let guard = 0;

  while (guard++ < 50) {
    // Inline-label form: `-- text -->` or `-. text .->`
    const inline = rest.match(/^(.*?)\s(-{2,3}|-\.|={2,3})\s+([^->|]+?)\s+(-{2,3}>|\.->|={2,3}>|-{2,3}|>)\s*(.*)$/);
    const piped = rest.match(EDGE_RE);

    if (inline && (!piped || inline.index === 0)) {
      refs.push(inline[1].trim());
      links.push({ connector: inline[4], label: cleanLabel(inline[3]) });
      rest = inline[5];
      continue;
    }
    if (!piped || piped.index === undefined) break;

    refs.push(rest.slice(0, piped.index).trim());
    const connector = piped[1];
    rest = rest.slice(piped.index + piped[0].length);

    // Piped-label form: the label immediately follows the connector.
    let label: string | undefined;
    const pipeMatch = rest.match(/^\|([^|]*)\|\s*(.*)$/);
    if (pipeMatch) {
      label = cleanLabel(pipeMatch[1]);
      rest = pipeMatch[2];
    }
    links.push({ connector, label });
  }

  if (links.length === 0) return null;
  refs.push(rest.trim());
  return { refs, links };
}

/**
 * Pull an id + optional shaped label out of a node reference like
 * `login[Log In]`. A bare `login` is a node too — Mermaid auto-creates nodes on
 * first mention, and the label defaults to the id.
 */
function parseNodeRef(ref: string): { id: string; label: string; shape: ShapeType } | null {
  const s = ref.trim();
  if (!s) return null;

  for (const { open, close, shape } of SHAPE_PATTERNS) {
    // Only consider a delimiter that sits outside quotes: a quoted label may
    // legitimately contain `>` (from `<br/>`), `(`, `{` and friends, and those
    // must not be read as shape delimiters.
    const oi = indexOfUnquoted(s, open);
    if (oi > 0 && s.endsWith(close)) {
      const id = s.slice(0, oi).trim();
      const label = cleanLabel(s.slice(oi + open.length, s.length - close.length));
      if (id) return { id, label: label || id, shape };
    }
  }
  // Bare reference: id doubles as the label.
  if (/^[\w.-]+$/.test(s)) return { id: s, label: s, shape: ShapeType.RECTANGLE };
  return null;
}

/** A connector ending in `>`/`x`/`o` draws an arrowhead; `---` is a plain line. */
function edgeStyleFor(connector: string): { dashed: boolean; arrowhead: boolean; bidirectional: boolean } {
  return {
    dashed: connector.includes('.') || connector.includes('='),
    arrowhead: /[>xo]$/.test(connector),
    bidirectional: connector.startsWith('<'),
  };
}

// -----------------------------------------------------------------------------
// Flowchart
// -----------------------------------------------------------------------------

/** `subgraph id [Title]` / `subgraph Title` / `subgraph id` — the id is
 *  optional in Mermaid; when omitted, the title itself doubles as the id
 *  (matching Mermaid's own behavior of using the raw subgraph line as key). */
function parseSubgraphHeader(line: string): { id: string; label: string } | null {
  const m = line.match(/^subgraph\s+(.*)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  const bracketed = rest.match(/^([\w.-]+)\s*\[(.*)\]$/);
  if (bracketed) return { id: bracketed[1], label: cleanLabel(bracketed[2]) };
  if (!rest) return { id: `subgraph-${Math.random().toString(36).slice(2, 8)}`, label: '' };
  return { id: rest, label: rest };
}

function importFlowchart(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const edges: IREdge[] = [];
  const groups = new Map<string, IRGroup>();
  const classDefs = new Map<string, Partial<NodeStyle>>();
  // classDef/class can be declared in either order relative to the node
  // mention, and class can name several nodes at once, so class assignments
  // are collected and resolved against classDefs after the whole source is
  // walked rather than applied inline.
  const classAssignments: Array<{ nodeIds: string[]; className: string }> = [];
  const linkStyles = new Map<number, Partial<EdgeStyle>>();
  let defaultLinkStyle: Partial<EdgeStyle> | undefined;
  // Stack of currently-open subgraphs, innermost last — a node/edge mentioned
  // while nested inside N subgraphs belongs directly to the innermost one;
  // the outer ones get it transitively via childGroupIds.
  const groupStack: string[] = [];
  let direction = 'TB';

  const currentGroup = () => groupStack[groupStack.length - 1];

  const addToCurrentGroup = (nodeId: string) => {
    const gid = currentGroup();
    if (!gid) return;
    const g = groups.get(gid)!;
    if (!g.childNodeIds.includes(nodeId)) g.childNodeIds.push(nodeId);
  };

  const ensure = (ref: string, lineNo: number): string | null => {
    const parsed = parseNodeRef(ref);
    if (!parsed) {
      diagnostics.push({ line: lineNo, message: `Could not parse node reference: "${ref}"` });
      return null;
    }
    const existing = nodes.get(parsed.id);
    if (existing) {
      // A later mention carrying a real label/shape wins over a bare first
      // mention — Mermaid lets you declare `a --> b` before `b[Real Label]`.
      if (parsed.label !== parsed.id) {
        existing.label = parsed.label;
        existing.size = sizeForLabel(parsed.label, 14, 100, 50);
      }
      if (parsed.shape !== ShapeType.RECTANGLE) existing.shape = parsed.shape;
    } else {
      nodes.set(parsed.id, makeNode(parsed.id, parsed.label, parsed.shape));
    }
    addToCurrentGroup(parsed.id);
    return parsed.id;
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%')) return;

    // Header carries the direction: `flowchart LR`
    const header = line.match(/^(?:flowchart|graph)\s+(\w+)/i);
    if (header) {
      direction = DIRECTIONS[header[1].toUpperCase()] || 'TB';
      return;
    }
    const subgraphOpen = parseSubgraphHeader(line);
    if (subgraphOpen) {
      const parentId = currentGroup();
      const group: IRGroup = {
        id: subgraphOpen.id,
        label: subgraphOpen.label,
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
      groups.set(group.id, group);
      if (parentId) groups.get(parentId)!.childGroupIds.push(group.id);
      groupStack.push(group.id);
      return;
    }
    if (/^end$/i.test(line)) {
      groupStack.pop();
      return;
    }
    // `style nodeId fill:#f9f,stroke:#333`
    const styleDecl = line.match(/^style\s+([\w.-]+)\s+(.+)$/i);
    if (styleDecl) {
      const id = ensure(styleDecl[1], lineNo);
      if (id) Object.assign(nodes.get(id)!.style, parseStyleDecl(styleDecl[2]));
      return;
    }
    // `classDef className fill:#f9f,stroke:#333`
    const classDefDecl = line.match(/^classDef\s+([\w-]+)\s+(.+)$/i);
    if (classDefDecl) {
      classDefs.set(classDefDecl[1], parseStyleDecl(classDefDecl[2]));
      return;
    }
    // `class nodeId1,nodeId2 className`
    const classDecl = line.match(/^class\s+([\w.,\s-]+?)\s+([\w-]+)$/i);
    if (classDecl) {
      const nodeIds = classDecl[1].split(',').map((s) => s.trim()).filter(Boolean).map((r) => ensure(r, lineNo)).filter((id): id is string => !!id);
      classAssignments.push({ nodeIds, className: classDecl[2] });
      return;
    }
    // `linkStyle 0,2 stroke:#ff3,stroke-width:2px` (or `linkStyle default ...`)
    const linkStyleDecl = line.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/i);
    if (linkStyleDecl) {
      const parsed = parseStyleDecl(linkStyleDecl[2]) as Partial<EdgeStyle>;
      if (/^default$/i.test(linkStyleDecl[1].trim())) {
        defaultLinkStyle = parsed;
      } else {
        for (const tok of linkStyleDecl[1].split(',')) {
          const idx = parseInt(tok.trim(), 10);
          if (!Number.isNaN(idx)) linkStyles.set(idx, parsed);
        }
      }
      return;
    }
    // Constructs we deliberately don't model yet — skip quietly rather than
    // corrupting the diagram with a half-understood interpretation.
    if (/^click\b/i.test(line)) {
      return;
    }

    const split = splitFlowLine(line);
    if (!split) {
      // A standalone declaration: `login[Log In]`
      if (parseNodeRef(line)) ensure(line, lineNo);
      return;
    }

    for (let k = 0; k < split.links.length; k++) {
      // `a & b --> c & d` is Mermaid shorthand for the full cross product of
      // links. Each side expands to a list, so one statement can yield several
      // edges — common enough in real diagrams that dropping it loses real
      // structure.
      const sources = splitAmpersand(split.refs[k]).map((r) => ensure(r, lineNo));
      const targets = splitAmpersand(split.refs[k + 1]).map((r) => ensure(r, lineNo));
      const { dashed, arrowhead, bidirectional } = edgeStyleFor(split.links[k].connector);

      for (const sourceId of sources) {
        for (const targetId of targets) {
          if (!sourceId || !targetId) continue;
          edges.push({
            id: `edge-${sourceId}-${targetId}-${edges.length}`,
            sourceId,
            targetId,
            label: split.links[k].label || undefined,
            style: { ...(dashed ? { strokeStyle: StrokeStyle.DASHED } : {}), arrowhead },
            routing: EdgeRouting.ORTHOGONAL,
            bidirectional,
            classList: [],
            data: {},
          });
        }
      }
    }
  });

  // classDef styles apply after direct `style` lines, matching Mermaid's own
  // cascade (a class assigns a look, an explicit `style` line overrides it) —
  // so class-derived properties are merged in first, then anything already on
  // the node's style from a `style` line is layered back on top.
  for (const { nodeIds, className } of classAssignments) {
    const classStyle = classDefs.get(className);
    for (const id of nodeIds) {
      const node = nodes.get(id);
      if (!node) continue;
      node.classList.push(className);
      if (classStyle) node.style = { ...classStyle, ...node.style };
    }
  }

  // `linkStyle` applies by declaration order of edges in source, which is
  // also array-push order here — resolved as a post-pass (not inline at push
  // time) because Mermaid convention puts style directives after the edges
  // they target.
  if (defaultLinkStyle || linkStyles.size) {
    edges.forEach((edge, i) => {
      Object.assign(edge.style, defaultLinkStyle, linkStyles.get(i));
    });
  }

  return {
    id: 'mermaid-flowchart',
    type: DiagramType.FLOWCHART,
    title: 'Flowchart',
    nodes: [...nodes.values()],
    edges,
    groups: [...groups.values()],
    layers: [],
    metadata: { direction, importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// Sequence
// -----------------------------------------------------------------------------

// Participant ids must not swallow the connector's leading `-`, or `B-->>A`
// parses as participant "B-" sending ">>A". Ids may contain `-` internally but
// never end with one, hence the trailing [\w.] requirement.
const SEQ_ID = String.raw`[\w.](?:[\w.-]*[\w.])?`;
const SEQ_MSG_RE = new RegExp(
  `^(${SEQ_ID})\\s*(-{1,2}>>|-{1,2}>|-{1,2}x|-{1,2}\\))\\s*(${SEQ_ID})\\s*:\\s*(.*)$`
);

function importSequence(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const edges: IREdge[] = [];

  const ensure = (id: string, label?: string, isActor = false) => {
    const existing = nodes.get(id);
    if (existing) {
      if (label) {
        existing.label = label;
        existing.size = sizeForLabel(label, 14, 100, 50);
      }
      return;
    }
    const text = label || id;
    const node = makeNode(id, text, isActor ? ShapeType.ACTOR : ShapeType.RECTANGLE);
    nodes.set(id, node);
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^sequenceDiagram\b/i.test(line)) return;

    // `participant A as Alice` / `actor B as Bob`
    const decl = line.match(/^(participant|actor)\s+([\w.-]+)(?:\s+as\s+(.+))?$/i);
    if (decl) {
      ensure(decl[2], decl[3] ? cleanLabel(decl[3]) : undefined, /^actor$/i.test(decl[1]));
      return;
    }
    // Block constructs carry meaning we don't model yet; participants inside
    // them still register through the message lines, so skipping is safe.
    if (/^(loop|alt|else|opt|par|and|rect|activate|deactivate|note|end|autonumber)\b/i.test(line)) {
      return;
    }

    const msg = line.match(SEQ_MSG_RE);
    if (!msg) {
      diagnostics.push({ line: lineNo, message: `Unrecognized sequence statement: "${line}"` });
      return;
    }
    const [, from, connector, to, text] = msg;
    ensure(from);
    ensure(to);
    edges.push({
      id: `msg-${from}-${to}-${edges.length}`,
      sourceId: from,
      targetId: to,
      label: cleanLabel(text) || undefined,
      // Two dashes = dashed line, Mermaid's reply/return convention (`-->>`);
      // one dash is a solid call (`->>`).
      style: { ...(connector.startsWith('--') ? { strokeStyle: StrokeStyle.DASHED } : {}), arrowhead: true },
      routing: EdgeRouting.STRAIGHT,
      bidirectional: false,
      classList: [],
      data: { order: edges.length },
    });
  });

  return {
    id: 'mermaid-sequence',
    type: DiagramType.SEQUENCE,
    title: 'Sequence',
    nodes: [...nodes.values()],
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// Class
// -----------------------------------------------------------------------------

/** Mermaid class relations, longest-first so `<|--` beats `--`. */
const CLASS_RELATIONS: Array<[string, string]> = [
  ['<|--', 'inheritance'],
  ['--|>', 'inheritance'],
  ['*--', 'composition'],
  ['o--', 'aggregation'],
  ['-->', 'association'],
  ['<--', 'association'],
  ['..>', 'dependency'],
  ['..|>', 'realization'],
  ['--', 'association'],
  ['..', 'dependency'],
];

function importClass(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const members = new Map<string, string[]>();
  const edges: IREdge[] = [];

  const ensure = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id, id, ShapeType.RECTANGLE));
    if (!members.has(id)) members.set(id, []);
  };

  let openClass: string | null = null;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^classDiagram(-v2)?\b/i.test(line)) return;

    // Block form: `class Foo {` … `}`
    if (openClass) {
      if (line === '}') { openClass = null; return; }
      members.get(openClass)!.push(cleanLabel(line));
      return;
    }
    const blockOpen = line.match(/^class\s+([\w.~-]+)\s*\{$/);
    if (blockOpen) {
      ensure(blockOpen[1]);
      openClass = blockOpen[1];
      return;
    }
    const bare = line.match(/^class\s+([\w.~-]+)$/);
    if (bare) { ensure(bare[1]); return; }

    // Relation form: `Animal <|-- Dog : label`
    const relation = CLASS_RELATIONS.find(([token]) => line.includes(token));
    if (relation) {
      const [token, kind] = relation;
      const idx = line.indexOf(token);
      const left = line.slice(0, idx).trim();
      let right = line.slice(idx + token.length).trim();
      let label: string | undefined;
      const colon = right.indexOf(':');
      if (colon >= 0) {
        label = cleanLabel(right.slice(colon + 1));
        right = right.slice(0, colon).trim();
      }
      // Strip Mermaid's quoted multiplicities (`"1"`, `"0..*"`).
      const source = left.replace(/"[^"]*"/g, '').trim();
      const target = right.replace(/"[^"]*"/g, '').trim();
      if (!source || !target) {
        diagnostics.push({ line: lineNo, message: `Could not parse class relation: "${line}"` });
        return;
      }
      ensure(source);
      ensure(target);
      // Mermaid points inheritance parent-first (`Parent <|-- Child`); the IR
      // stores it child→parent so the arrowhead lands on the parent.
      const flipped = token === '<|--' || token === '<--';
      edges.push({
        id: `rel-${source}-${target}-${edges.length}`,
        sourceId: flipped ? target : source,
        targetId: flipped ? source : target,
        label,
        style: {},
        routing: EdgeRouting.ORTHOGONAL,
        bidirectional: false,
        classList: [],
        data: { relation: kind },
      });
      return;
    }

    // Member form: `Foo : +bar()`
    const member = line.match(/^([\w.~-]+)\s*:\s*(.+)$/);
    if (member) {
      ensure(member[1]);
      members.get(member[1])!.push(cleanLabel(member[2]));
      return;
    }
    if (!/^(<<|note|direction|click|style|cssClass)/i.test(line)) {
      diagnostics.push({ line: lineNo, message: `Unrecognized class statement: "${line}"` });
    }
  });

  // The class renderer derives its compartments by splitting the node *label*
  // on newlines (name first, then members) — it does not read a `data` bag. So
  // members must be folded into the label, exactly as the DSL path produces
  // them, or they render as a bare class box with the members silently dropped.
  for (const [id, node] of nodes) {
    const list = members.get(id) || [];
    if (list.length) node.label = [id, ...list].join('\n');
    const { attributes, operations } = splitMembers(list);
    node.size = sizeForLabel(id, 16, 160, 56, 28, 14, [...attributes, ...operations]);
    node.size.height += (attributes.length > 0 ? 14 : 0) + (operations.length > 0 ? 14 : 0);
    node.data = { kind: 'class', compartments: { name: id, attributes, operations } };
  }

  return {
    id: 'mermaid-class',
    type: DiagramType.CLASS,
    title: 'Class Diagram',
    nodes: [...nodes.values()],
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// ER
// -----------------------------------------------------------------------------

/** `CUSTOMER ||--o{ ORDER : places` — cardinality is encoded on both sides. */
const ER_RE = /^([\w.-]+)\s+([|}o][|o{}-]*)-{2}([|{o][|o{}-]*)\s+([\w.-]+)\s*:\s*(.*)$/;

function importEr(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const attributes = new Map<string, string[]>();
  const edges: IREdge[] = [];

  const ensure = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id, id, ShapeType.RECTANGLE));
    if (!attributes.has(id)) attributes.set(id, []);
  };

  let openEntity: string | null = null;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^erDiagram\b/i.test(line)) return;

    if (openEntity) {
      if (line === '}') { openEntity = null; return; }
      attributes.get(openEntity)!.push(cleanLabel(line));
      return;
    }
    const blockOpen = line.match(/^([\w.-]+)\s*\{$/);
    if (blockOpen) {
      ensure(blockOpen[1]);
      openEntity = blockOpen[1];
      return;
    }

    const rel = line.match(ER_RE);
    if (!rel) {
      diagnostics.push({ line: lineNo, message: `Unrecognized ER statement: "${line}"` });
      return;
    }
    const [, left, leftCard, rightCard, right, label] = rel;
    ensure(left);
    ensure(right);
    edges.push({
      id: `er-${left}-${right}-${edges.length}`,
      sourceId: left,
      targetId: right,
      label: cleanLabel(label) || undefined,
      style: {},
      routing: EdgeRouting.ORTHOGONAL,
      bidirectional: false,
      classList: [],
      data: { sourceCardinality: leftCard, targetCardinality: rightCard },
    });
  });

  // Like the class renderer, renderErEntity() parses the entity's table out of
  // the `\n`-joined label (name first, then one line per attribute) and sizes
  // it with erEntitySize(). Matching that here is what makes an imported entity
  // draw as a real table instead of a one-row box labeled "id".
  for (const [id, node] of nodes) {
    const attrs = attributes.get(id) || [];
    if (attrs.length) node.label = [id, ...attrs].join('\n');
    node.size = erEntitySize(node.label);
    node.data = { attributes: attrs };
  }

  return {
    id: 'mermaid-er',
    type: DiagramType.ER,
    title: 'ER Diagram',
    nodes: [...nodes.values()],
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

function importState(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const edges: IREdge[] = [];
  let startCounter = 0, endCounter = 0;

  // `[*]` is Mermaid's shared start/end pseudostate token; every occurrence on
  // the source side of a transition is really a distinct start node, and every
  // occurrence on the target side a distinct end node, or two unrelated
  // transitions collapse onto the same pseudostate and render as one node with
  // edges crossing between transitions that were never connected.
  const ensure = (ref: string, isSource: boolean): string => {
    if (ref !== '[*]') {
      if (!nodes.has(ref)) nodes.set(ref, makeNode(ref, ref, ShapeType.ROUNDED_RECTANGLE));
      return ref;
    }
    const id = isSource ? `__start_${startCounter++}` : `__end_${endCounter++}`;
    nodes.set(id, makeNode(id, '[*]', ShapeType.CIRCLE));
    return id;
  };

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^stateDiagram(-v2)?\b/i.test(line)) return;
    if (/^(state|note|end|direction)\b/i.test(line)) return;

    const m = line.match(/^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)\s*(?::\s*(.*))?$/);
    if (!m) {
      diagnostics.push({ line: lineNo, message: `Unrecognized state statement: "${line}"` });
      return;
    }
    const source = ensure(m[1], true);
    const target = ensure(m[2], false);
    edges.push({
      id: `st-${source}-${target}-${edges.length}`,
      sourceId: source,
      targetId: target,
      label: m[3] ? cleanLabel(m[3]) : undefined,
      style: {},
      routing: EdgeRouting.ORTHOGONAL,
      bidirectional: false,
      classList: [],
      data: {},
    });
  });

  return {
    id: 'mermaid-state',
    type: DiagramType.STATE,
    title: 'State Diagram',
    nodes: [...nodes.values()],
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// Gantt
// -----------------------------------------------------------------------------

const GANTT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Mermaid dates a task with `YYYY-MM-DD` and a duration/end like `5d` or
 *  another `YYYY-MM-DD`; the SelDiA layout's own label parser
 *  (`parseGanttLabel` in `custom-layout.ts`) only understands `"Mon D"` /
 *  `"Mon D-D2"` text, so dates are converted to that vocabulary here rather
 *  than passed through raw. */
function ganttDateToLabel(iso: string): string {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const month = GANTT_MONTHS[Math.max(0, Math.min(11, parseInt(m[1], 10) - 1))];
  return `${month} ${parseInt(m[2], 10)}`;
}

function addDaysToIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function importGantt(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes: IRNode[] = [];
  let lastEndIso: string | null = null;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^gantt\b/i.test(line)) return;
    if (/^(title|dateFormat|axisFormat|excludes|todayMarker|section)\b/i.test(line)) return;

    // `Task name : [tag,] [id,] start, duration|end`
    const parts = line.split(':');
    if (parts.length < 2) {
      diagnostics.push({ line: lineNo, message: `Unrecognized gantt statement: "${line}"` });
      return;
    }
    const title = parts[0].trim();
    const fields = parts.slice(1).join(':').split(',').map((f) => f.trim()).filter(Boolean);
    // Drop Mermaid's optional status/tag tokens (active, done, crit, milestone)
    // and an optional task id — only date-shaped fields carry the schedule.
    const dateFields = fields.filter((f) => /^\d{4}-\d{2}-\d{2}$|^\d+[dwmh]$/i.test(f));
    const isMilestone = /\bmilestone\b/i.test(line);

    let startIso: string | null = null;
    let endIso: string | null = null;
    for (const f of dateFields) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        if (!startIso) startIso = f; else endIso = f;
      } else {
        const dur = f.match(/^(\d+)d$/i);
        const days = dur ? parseInt(dur[1], 10) : 1;
        const base = startIso || lastEndIso;
        if (base) endIso = addDaysToIso(base, days);
      }
    }
    if (!startIso) startIso = lastEndIso || new Date().toISOString().slice(0, 10);
    if (!endIso) endIso = isMilestone ? startIso : addDaysToIso(startIso, 1);
    lastEndIso = endIso;

    const id = `task-${nodes.length}`;
    const label = isMilestone || startIso === endIso
      ? `${title}: ${ganttDateToLabel(startIso)}`
      : `${title}: ${ganttDateToLabel(startIso)}-${parseInt(endIso.slice(8, 10), 10)}`;
    nodes.push(makeNode(id, label, ShapeType.RECTANGLE));
  });

  return {
    id: 'mermaid-gantt',
    type: DiagramType.GANTT,
    title: 'Gantt Chart',
    nodes,
    edges: [],
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// Pie
// -----------------------------------------------------------------------------

function importPie(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes: IRNode[] = [];

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^pie\b/i.test(line) || /^title\b/i.test(line)) return;

    // `"Category" : 42.5`
    const m = line.match(/^"([^"]*)"\s*:\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      diagnostics.push({ line: lineNo, message: `Unrecognized pie statement: "${line}"` });
      return;
    }
    const [, category, value] = m;
    // parseChartCategory (custom-renderers.ts) reads the label's first line as
    // the category name and scans subsequent lines for "Name: number" — this
    // two-line shape is what makes the slice carry its real value instead of
    // defaulting to 1.
    const label = `${category}\n${category}: ${value}`;
    nodes.push(makeNode(`slice-${nodes.length}`, label, ShapeType.RECTANGLE));
  });

  return {
    id: 'mermaid-pie',
    type: DiagramType.CHART_PIE,
    title: 'Pie Chart',
    nodes,
    edges: [],
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// GitGraph
// -----------------------------------------------------------------------------

function importGitgraph(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  let branch = 'main';
  // Last commit id on each branch, for linear chaining and for `checkout`
  // switching back to resume a branch's own history rather than main's.
  const lastCommitOnBranch = new Map<string, string>();
  let commitCounter = 0;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^gitGraph\b/i.test(line)) return;

    const branchDecl = line.match(/^branch\s+([\w.\-/]+)/i);
    if (branchDecl) {
      branch = branchDecl[1];
      if (!lastCommitOnBranch.has(branch)) {
        // A new branch starts from wherever its parent branch currently is.
        const parentTip = [...lastCommitOnBranch.values()].pop();
        if (parentTip) lastCommitOnBranch.set(branch, parentTip);
      }
      return;
    }
    const checkout = line.match(/^checkout\s+([\w.\-/]+)/i);
    if (checkout) { branch = checkout[1]; return; }

    const commit = line.match(/^commit(?:\s+id:\s*"([^"]*)")?(?:\s+tag:\s*"([^"]*)")?/i);
    if (commit) {
      const message = commit[1] || `commit ${++commitCounter}`;
      const id = `c${commitCounter}`;
      nodes.push(makeNode(id, `${branch}: ${message}`, ShapeType.CIRCLE));
      const parent = lastCommitOnBranch.get(branch);
      if (parent) {
        edges.push({
          id: `git-${parent}-${id}`, sourceId: parent, targetId: id, style: {},
          routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {},
        });
      }
      lastCommitOnBranch.set(branch, id);
      return;
    }

    const merge = line.match(/^merge\s+([\w.\-/]+)/i);
    if (merge) {
      const fromTip = lastCommitOnBranch.get(merge[1]);
      const intoTip = lastCommitOnBranch.get(branch);
      const id = `c${++commitCounter}`;
      nodes.push(makeNode(id, `${branch}: merge ${merge[1]}`, ShapeType.CIRCLE));
      if (intoTip) edges.push({ id: `git-${intoTip}-${id}`, sourceId: intoTip, targetId: id, style: {}, routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {} });
      if (fromTip && fromTip !== intoTip) edges.push({ id: `git-${fromTip}-${id}`, sourceId: fromTip, targetId: id, style: {}, routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {} });
      lastCommitOnBranch.set(branch, id);
      return;
    }

    diagnostics.push({ line: lineNo, message: `Unrecognized gitGraph statement: "${line}"` });
  });

  return {
    id: 'mermaid-gitgraph',
    type: DiagramType.GITGRAPH,
    title: 'Git Graph',
    nodes,
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// Mindmap
// -----------------------------------------------------------------------------

/** Mermaid mindmap nesting is indentation-based, not bracket-delimited — each
 *  line's leading whitespace depth determines its parent (the nearest
 *  preceding line with strictly less indentation). */
function importMindmap(lines: string[], diagnostics: MermaidImportDiagnostic[]): DiagramIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  // Stack of {indent, id} for ancestors currently in scope.
  const stack: Array<{ indent: number; id: string }> = [];
  let counter = 0;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    if (!raw.trim() || raw.trim().startsWith('%%') || /^mindmap\b/i.test(raw.trim())) return;

    const indent = raw.length - raw.trimStart().length;
    let text = raw.trim();
    // Strip Mermaid's optional shape delimiters around the node text, e.g.
    // `root((Root))`, `id[Rect]`, `id(Rounded)` — reuse the flowchart shape
    // table so a mindmap node's chosen shape carries through too.
    const parsed = parseNodeRef(text) || { id: `mm-${counter}`, label: text, shape: ShapeType.RECTANGLE };
    const id = `mm-${counter++}`;
    nodes.push(makeNode(id, parsed.label || text, parsed.shape));

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      edges.push({
        id: `mm-edge-${parent.id}-${id}`, sourceId: parent.id, targetId: id, style: {},
        routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {},
      });
    } else if (nodes.length > 1) {
      diagnostics.push({ line: lineNo, message: `Mindmap node "${text}" has no parent (indentation may be inconsistent)` });
    }
    stack.push({ indent, id });
  });

  return {
    id: 'mermaid-mindmap',
    type: DiagramType.MINDMAP,
    title: 'Mindmap',
    nodes,
    edges,
    groups: [],
    layers: [],
    metadata: { importedFrom: 'mermaid' },
  };
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/** Does this source look like Mermaid? Used to auto-route mixed fenced blocks. */
export function isMermaidSource(source: string): boolean {
  const first = source
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('%%') && !l.startsWith('---'));
  if (!first) return false;
  return HEADER_TYPES.some(([re]) => re.test(first)) ||
    /^(journey|timeline|quadrantChart|requirementDiagram)\b/i.test(first);
}

/**
 * Parse Mermaid source into SelDiA IR.
 *
 * Never throws on malformed input: unparseable statements become diagnostics so
 * a partially-broken diagram still renders what it can. An unsupported *type*
 * yields no IR, which callers should treat as "leave this block to Mermaid".
 */
export function importMermaid(source: string): MermaidImportResult {
  const diagnostics: MermaidImportDiagnostic[] = [];
  // Strip YAML frontmatter (`--- config ---`) — it configures Mermaid's own
  // renderer and has no bearing on structure.
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
  const lines = body.split('\n');
  const first = lines.map((l) => l.trim()).find((l) => l && !l.startsWith('%%'));

  if (!first) {
    diagnostics.push({ line: 1, message: 'Empty Mermaid source' });
    return { diagnostics };
  }

  const match = HEADER_TYPES.find(([re]) => re.test(first));
  if (!match) {
    diagnostics.push({
      line: 1,
      message: `Unsupported Mermaid diagram type: "${first.split(/\s+/)[0]}". Supported: flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram, gantt, pie, gitGraph, mindmap.`,
    });
    return { diagnostics };
  }

  switch (match[1]) {
    case DiagramType.FLOWCHART:
      return { ir: importFlowchart(lines, diagnostics), diagnostics };
    case DiagramType.SEQUENCE:
      return { ir: importSequence(lines, diagnostics), diagnostics };
    case DiagramType.CLASS:
      return { ir: importClass(lines, diagnostics), diagnostics };
    case DiagramType.ER:
      return { ir: importEr(lines, diagnostics), diagnostics };
    case DiagramType.STATE:
      return { ir: importState(lines, diagnostics), diagnostics };
    case DiagramType.GANTT:
      return { ir: importGantt(lines, diagnostics), diagnostics };
    case DiagramType.CHART_PIE:
      return { ir: importPie(lines, diagnostics), diagnostics };
    case DiagramType.GITGRAPH:
      return { ir: importGitgraph(lines, diagnostics), diagnostics };
    case DiagramType.MINDMAP:
      return { ir: importMindmap(lines, diagnostics), diagnostics };
    default:
      return { diagnostics };
  }
}
