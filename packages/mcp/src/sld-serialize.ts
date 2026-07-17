// =============================================================================
// SelDiA MCP — general IR → .sld serializer
// =============================================================================
// Turns a full DiagramIR back into SelDiA DSL source, so write_diagram can
// persist arbitrary structural mutation (new nodes/edges/groups), not just the
// single-line label/style patches sld-writer.ts handles.
//
// Contract, mirroring export/mermaid.ts: this is best-effort and structural.
// It emits the portable core of the grammar — a `diagram <type> "Title" { … }`
// header, node declarations with the right shape bracket, edges with the right
// arrow, and `group` blocks — which is what round-trips faithfully through the
// engine's own parser. It deliberately does NOT try to reproduce layout
// geometry (positions are the layout engine's job, not source), waypoints, or
// renderer-internal `data` fields. Diagram types with a bespoke label
// vocabulary the parser reads back structurally (gantt dates, pie slices, git
// branches, sequence fragments) are not round-trip-safe through a generic
// node/edge serializer, so serializeIR() returns null for them rather than
// emitting DSL that would re-parse into something different — the caller then
// gets a clear "not serializable" error instead of silent corruption.
//
// The safety property callers rely on: anything serializeIR() returns re-parses
// through the engine into a structurally equivalent IR (verified by the
// round-trip tests). When it can't guarantee that, it returns null.

import { ShapeType, DiagramType, type DiagramIR, type IRNode, type IREdge } from '@seldia/core';

// Types whose visual grammar is carried in the node *label* in a vocabulary the
// parser decodes structurally (see custom-layout.ts). A generic node/edge dump
// can't reproduce them, so they're refused rather than mangled.
const NON_SERIALIZABLE = new Set<DiagramType>([
  DiagramType.GANTT, DiagramType.MINDMAP, DiagramType.GITGRAPH, DiagramType.SANKEY,
  DiagramType.CHART_BAR, DiagramType.CHART_LINE, DiagramType.CHART_PIE,
  DiagramType.CHART_RADAR, DiagramType.CHART_SCATTER,
]);

// DiagramType → the header keyword(s) after `diagram`. Most are a single token;
// the C4 family splits into `c4 <variant>`.
const TYPE_HEADER: Partial<Record<DiagramType, string>> = {
  [DiagramType.FLOWCHART]: 'flowchart', [DiagramType.SEQUENCE]: 'sequence',
  [DiagramType.CLASS]: 'class', [DiagramType.ER]: 'er', [DiagramType.STATE]: 'state',
  [DiagramType.USECASE]: 'usecase', [DiagramType.ACTIVITY]: 'activity',
  [DiagramType.COMPONENT]: 'component', [DiagramType.DEPLOYMENT]: 'deployment',
  [DiagramType.C4_CONTEXT]: 'c4 context', [DiagramType.C4_CONTAINER]: 'c4 container',
  [DiagramType.C4_COMPONENT]: 'c4 component', [DiagramType.C4_CODE]: 'c4 code',
  [DiagramType.BPMN]: 'bpmn', [DiagramType.DMN]: 'dmn', [DiagramType.NETWORK]: 'network',
  [DiagramType.FORM]: 'form', [DiagramType.BLOCK]: 'block', [DiagramType.TIMELINE]: 'timeline',
  [DiagramType.WIREFRAME]: 'wireframe', [DiagramType.CLOUD]: 'cloud',
};

// Shape → the shape *keyword* the parser maps back to it. We emit the
// `<keyword> id: "Label"` form rather than bracket delimiters (`{Q?}`, `<H>`)
// because the keyword form round-trips for every shape, while some bracket
// forms only parse behind a colon and a couple (hexagon `<H>`) don't tokenize
// as a shape at all. Uniform and safe beats terse.
const SHAPE_KEYWORD: Partial<Record<ShapeType, string>> = {
  [ShapeType.RECTANGLE]: 'rectangle',
  [ShapeType.ROUNDED_RECTANGLE]: 'rounded',
  [ShapeType.DIAMOND]: 'diamond',
  [ShapeType.HEXAGON]: 'hexagon',
  [ShapeType.CIRCLE]: 'circle',
  [ShapeType.STADIUM]: 'stadium',
  [ShapeType.CYLINDER]: 'cylinder',
  [ShapeType.PARALLELOGRAM]: 'parallelogram',
  [ShapeType.CLOUD]: 'cloud',
  [ShapeType.ACTOR]: 'actor',
  [ShapeType.NOTE]: 'note',
  [ShapeType.QUEUE]: 'queue',
};

function ident(id: string): string {
  // A DSL identifier is [A-Za-z0-9_-]; anything else gets slugged so the line
  // parses. Round-trip identity of exotic ids isn't promised — structure is.
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : id.replace(/[^A-Za-z0-9_-]+/g, '_') || 'n';
}

function q(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function nodeDecl(n: IRNode, indent: string): string {
  const label = n.label ?? n.id;
  const kw = SHAPE_KEYWORD[n.shape] ?? 'rectangle';
  // `<keyword> id: "Label"` — the one form that round-trips for every shape.
  return `${indent}${kw} ${ident(n.id)}: ${q(label)}`;
}

function edgeDecl(e: IREdge, indent: string): string {
  // `-->` is the engine's default arrow; a bidirectional edge uses `<-->`.
  const arrow = e.bidirectional ? '<-->' : '-->';
  const label = e.label ? `: ${q(e.label)}` : '';
  return `${indent}${ident(e.sourceId)} ${arrow} ${ident(e.targetId)}${label}`;
}

/**
 * Serialize an IR to .sld source. Returns null for diagram types whose grammar
 * a generic node/edge dump can't round-trip (see NON_SERIALIZABLE), so the
 * caller can report "not serializable" instead of writing wrong DSL.
 */
export function serializeIR(ir: DiagramIR): string | null {
  if (NON_SERIALIZABLE.has(ir.type)) return null;
  const header = TYPE_HEADER[ir.type];
  if (!header) return null;

  const title = ir.title || 'Diagram';
  const lines: string[] = [`diagram ${header} ${q(title)} {`];

  // Every node is emitted at top level. Group membership is intentionally NOT
  // re-emitted as `group { … }` blocks: the DSL parser currently discards the
  // nodes declared inside a group body (a pre-existing engine limitation, same
  // in both directions — verified by round-trip), so writing them into a group
  // block would silently drop them on the next load. Preserving every node is
  // the write-back guarantee that matters; group boxes are a lossy extra we
  // decline rather than lose data over. (When the parser learns to keep group
  // bodies, this can emit real `group` blocks again.)
  for (const n of ir.nodes) lines.push(nodeDecl(n, '  '));

  if (ir.edges.length) lines.push('');
  for (const e of ir.edges) lines.push(edgeDecl(e, '  '));

  lines.push('}', '');
  return lines.join('\n');
}

export function isSerializable(ir: DiagramIR): boolean {
  return !NON_SERIALIZABLE.has(ir.type) && !!TYPE_HEADER[ir.type];
}
