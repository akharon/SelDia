// =============================================================================
// SelDiA — PlantUML Exporter
// =============================================================================
// The return leg of the PlantUML bridge: IR -> PlantUML source text. Mirrors
// export/mermaid.ts in contract — best-effort mapping, never a throw, `null`
// for a diagram type with no sensible PlantUML spelling — and covers the same
// set of types the importer covers, plus flowchart (which has no PlantUML
// family of its own but lands cleanly on `rectangle` + arrows).
//
// An IR built by hand or by another frontend may use features PlantUML has no
// word for (arbitrary shapes, per-node styling, edge routing); those are
// approximated or dropped rather than emitted as invalid source.
// =============================================================================

import type { DiagramIR, IRNode, IREdge, IRGroup } from '../ir/types.js';
import { DiagramType } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle } from '../types/style.js';

/** PlantUML aliases are identifiers; anything else needs a generated stand-in
 *  so the label (which carries the real text) can hold arbitrary characters. */
function safeId(id: string, seen: Map<string, string>, counter: { n: number }): string {
  if (seen.has(id)) return seen.get(id)!;
  const safe = /^[A-Za-z_]\w*$/.test(id) ? id : `n${counter.n++}`;
  seen.set(id, safe);
  return safe;
}

/** PlantUML takes `\n` inside a quoted label as a line break. */
function quote(label: string): string {
  return `"${label.replace(/"/g, "'").replace(/\n/g, '\\n')}"`;
}

/** Declare an element as `<keyword> "Label" as alias`, collapsing to the bare
 *  form when the label adds nothing over the alias. */
function decl(keyword: string, label: string, alias: string): string {
  return label && label !== alias ? `${keyword} ${quote(label)} as ${alias}` : `${keyword} ${alias}`;
}

/** `-->` vs `..>` — a dashed IR edge is PlantUML's dotted connector. */
function connector(edge: IREdge, solid = '-->', dashed = '..>'): string {
  return edge.style.strokeStyle === StrokeStyle.DASHED ? dashed : solid;
}

function edgeLabel(edge: IREdge): string {
  return edge.label ? ` : ${edge.label.replace(/\n/g, '\\n')}` : '';
}

/** Wrap a body in the `@startuml … @enduml` envelope every PlantUML tool
 *  expects, with an optional `title` line lifted from the IR. */
function wrap(body: string[], ir: DiagramIR, kind = 'uml'): string {
  const lines = [`@start${kind}`];
  if (ir.title) lines.push(`title ${ir.title.replace(/\n/g, ' ')}`);
  lines.push(...body, `@end${kind}`);
  return lines.join('\n');
}

/** Emit nested containers depth-first. Shared by every family that has
 *  groups, since PlantUML spells them all the same way: `keyword "Label" {`. */
function emitGroups(
  ir: DiagramIR,
  head: (g: IRGroup) => string,
  emitNode: (n: IRNode, indent: string) => string,
  indent: string,
): { lines: string[]; grouped: Set<string> } {
  const lines: string[] = [];
  const grouped = new Set<string>();
  const groupsById = new Map(ir.groups.map((g) => [g.id, g]));
  const nodesById = new Map(ir.nodes.map((n) => [n.id, n]));

  const walk = (group: IRGroup, pad: string) => {
    lines.push(`${pad}${head(group)} {`);
    for (const childId of group.childGroupIds) {
      const child = groupsById.get(childId);
      if (child) walk(child, pad + '  ');
    }
    for (const nodeId of group.childNodeIds) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      grouped.add(nodeId);
      lines.push(emitNode(node, pad + '  '));
    }
    lines.push(`${pad}}`);
  };

  const nested = new Set(ir.groups.flatMap((g) => g.childGroupIds));
  for (const g of ir.groups) if (!nested.has(g.id)) walk(g, indent);
  return { lines, grouped };
}

// -----------------------------------------------------------------------------
// Flowchart
// -----------------------------------------------------------------------------

/** IR shape → the closest PlantUML container keyword. PlantUML's box
 *  vocabulary is semantic (`database`, `queue`, `cloud`) rather than
 *  geometric, so this is a best-fit rather than a bijection. */
const FLOW_KEYWORDS: Partial<Record<ShapeType, string>> = {
  [ShapeType.CYLINDER]: 'database',
  [ShapeType.QUEUE]: 'queue',
  [ShapeType.CLOUD]: 'cloud',
  [ShapeType.ACTOR]: 'actor',
  [ShapeType.CIRCLE]: 'circle',
  [ShapeType.HEXAGON]: 'hexagon',
  [ShapeType.NOTE]: 'card',
  [ShapeType.STADIUM]: 'rectangle',
  [ShapeType.SUBROUTINE]: 'component',
  [ShapeType.DIAMOND]: 'usecase',
};

function exportFlowchart(ir: DiagramIR): string {
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);
  const node = (n: IRNode, indent: string) => `${indent}${decl(FLOW_KEYWORDS[n.shape] || 'rectangle', n.label, id(n.id))}`;

  const body: string[] = [];
  if (ir.metadata?.direction === 'LR' || ir.metadata?.direction === 'RL') body.push('left to right direction');
  const { lines, grouped } = emitGroups(ir, (g) => `package ${quote(g.label || g.id)}`, node, '');
  body.push(...lines);
  for (const n of ir.nodes) if (!grouped.has(n.id)) body.push(node(n, ''));
  for (const e of ir.edges) body.push(`${id(e.sourceId)} ${connector(e)} ${id(e.targetId)}${edgeLabel(e)}`);
  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// Sequence
// -----------------------------------------------------------------------------

const SEQ_KEYWORDS: Partial<Record<ShapeType, string>> = {
  [ShapeType.ACTOR]: 'actor',
  [ShapeType.CYLINDER]: 'database',
  [ShapeType.CIRCLE]: 'control',
  [ShapeType.QUEUE]: 'queue',
  [ShapeType.SUBROUTINE]: 'collections',
};

function exportSequence(ir: DiagramIR): string {
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);
  const body: string[] = [];

  for (const n of ir.nodes) body.push(decl(SEQ_KEYWORDS[n.shape] || 'participant', n.label, id(n.id)));

  // Control fragments live on metadata as message-index spans (see
  // diagrams/sequence.ts). Replaying them means walking messages in order and
  // opening/closing fragments at their boundaries, innermost last so the
  // `end`s nest correctly.
  const frags = ((ir.metadata?.sequenceFragments as any[]) || [])
    .slice()
    .sort((a, b) => a.firstEdge - b.firstEdge || b.lastEdge - a.lastEdge);
  const ordered = ir.edges
    .map((e, i) => ({ e, i: (e.data?.messageOrder as number) ?? i }))
    .sort((a, b) => a.i - b.i);

  const openStack: any[] = [];
  const closeAt = (index: number) => {
    while (openStack.length && openStack[openStack.length - 1].lastEdge <= index) {
      openStack.pop();
      body.push('end');
    }
  };

  for (const { e, i } of ordered) {
    closeAt(i);
    for (const f of frags) {
      if (f.firstEdge !== i || openStack.includes(f)) continue;
      body.push(`${f.keyword}${f.label ? ` ${f.label}` : ''}`);
      openStack.push(f);
    }
    for (const f of openStack) {
      const section = (f.sections || []).find((s: any) => s.firstEdge === i);
      if (section && (f.sections || [])[0] !== section) body.push(`else${section.label ? ` ${section.label}` : ''}`);
    }
    body.push(`${id(e.sourceId)} ${connector(e, '->', '-->')} ${id(e.targetId)}${edgeLabel(e)}`);
  }
  closeAt(Number.MAX_SAFE_INTEGER);

  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// Class
// -----------------------------------------------------------------------------

/** Inverse of relationKindOf in the importer. The IR always points the edge at
 *  the end that carries the decoration (that is where the arrowhead is drawn),
 *  so every decorated form is written target-first here. */
interface ClassRelationForm { token: string; targetFirst: boolean }
const CLASS_RELATIONS: Record<string, ClassRelationForm> = {
  inheritance: { token: '<|--', targetFirst: true },
  generalization: { token: '<|--', targetFirst: true },
  realization: { token: '<|..', targetFirst: true },
  composition: { token: '*--', targetFirst: true },
  aggregation: { token: 'o--', targetFirst: true },
  association: { token: '-->', targetFirst: false },
  dependency: { token: '..>', targetFirst: false },
};

/** A `«stereotype» Name` first line came from a PlantUML keyword on import —
 *  recover both halves so the export names the right element kind. */
function splitStereotype(name: string): { keyword: string; name: string } {
  const m = name.match(/^«([^»]*)»\s*(.*)$/);
  if (!m) return { keyword: 'class', name };
  const tag = m[1].toLowerCase();
  if (tag === 'interface') return { keyword: 'interface', name: m[2] };
  if (tag === 'enumeration' || tag === 'enum') return { keyword: 'enum', name: m[2] };
  if (tag === 'annotation') return { keyword: 'annotation', name: m[2] };
  if (tag === 'abstract') return { keyword: 'abstract class', name: m[2] };
  return { keyword: 'class', name: m[2] };
}

function exportClass(ir: DiagramIR): string {
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);

  const emit = (n: IRNode, indent: string): string => {
    const compartments = n.data?.compartments as { name: string; attributes: string[]; operations: string[] } | undefined;
    const [labelName, ...labelMembers] = n.label.split('\n');
    const rawName = compartments?.name ?? labelName;
    const members = compartments ? [...compartments.attributes, ...compartments.operations] : labelMembers;
    const { keyword, name } = splitStereotype(rawName);
    const alias = id(n.id);
    const head = `${indent}${decl(keyword, name, alias)}`;
    if (!members.length) return head;
    return [`${head} {`, ...members.map((m) => `${indent}  ${m}`), `${indent}}`].join('\n');
  };

  const { lines, grouped } = emitGroups(ir, (g) => `package ${quote(g.label || g.id)}`, emit, '');
  const body = [...lines];
  for (const n of ir.nodes) if (!grouped.has(n.id)) body.push(emit(n, ''));

  for (const e of ir.edges) {
    const kind = (e.data?.relation as string) || (e.data?.relationship as string) || 'association';
    const form = CLASS_RELATIONS[kind] || CLASS_RELATIONS.association;
    // A multiplicity is written between its element and the arrow, so which
    // side it lands on depends on whether this relation is written
    // target-first (`Whole *-- Part`) or source-first (`A --> B`).
    const ends = form.targetFirst
      ? [{ nid: e.targetId, mult: e.data?.targetMultiplicity }, { nid: e.sourceId, mult: e.data?.sourceMultiplicity }]
      : [{ nid: e.sourceId, mult: e.data?.sourceMultiplicity }, { nid: e.targetId, mult: e.data?.targetMultiplicity }];
    const left = `${id(ends[0].nid)}${ends[0].mult ? ` "${ends[0].mult}"` : ''}`;
    const right = `${ends[1].mult ? `"${ends[1].mult}" ` : ''}${id(ends[1].nid)}`;
    body.push(`${left} ${form.token} ${right}${edgeLabel(e)}`);
  }
  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// ER
// -----------------------------------------------------------------------------

function exportEr(ir: DiagramIR): string {
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);
  const body: string[] = [];

  for (const n of ir.nodes) {
    const attrs = (n.data?.attributes as string[]) || n.label.split('\n').slice(1);
    const name = n.label.split('\n')[0];
    const alias = id(n.id);
    const head = decl('entity', name, alias);
    if (!attrs.length) { body.push(head); continue; }
    body.push(`${head} {`, ...attrs.map((a) => `  ${a}`), '}');
  }
  for (const e of ir.edges) {
    // PlantUML's IE cardinalities are spelled exactly like Mermaid's, which is
    // the same pair the importer stored.
    const left = (e.data?.sourceCardinality as string) || '||';
    const right = (e.data?.targetCardinality as string) || 'o{';
    body.push(`${id(e.sourceId)} ${left}--${right} ${id(e.targetId)}${edgeLabel(e)}`);
  }
  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

function exportState(ir: DiagramIR): string {
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);
  // Start/end pseudostates are per-transition nodes in the IR; they all
  // collapse back onto PlantUML's single `[*]` token.
  const ref = (nid: string) => (nid.startsWith('__start_') || nid.startsWith('__end_') ? '[*]' : id(nid));

  const emit = (n: IRNode, indent: string) =>
    n.id.startsWith('__start_') || n.id.startsWith('__end_') ? '' : `${indent}${decl('state', n.label, id(n.id))}`;

  // A composite state must be declared `state "Name" as alias {` — unlike
  // `package`/`node`, PlantUML will not take a quoted name with a body.
  const { lines, grouped } = emitGroups(ir, (g) => `state ${quote(g.label || g.id)} as ${id(g.id)}`, emit, '');
  const body = lines.filter(Boolean);
  for (const n of ir.nodes) {
    if (grouped.has(n.id)) continue;
    const line = emit(n, '');
    if (line) body.push(line);
  }
  for (const e of ir.edges) body.push(`${ref(e.sourceId)} ${connector(e, '-->', '-->')} ${ref(e.targetId)}${edgeLabel(e)}`);
  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// Use case
// -----------------------------------------------------------------------------

function exportUsecase(ir: DiagramIR): string {
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);
  const emit = (n: IRNode, indent: string) =>
    `${indent}${decl((n.data?.usecaseKind as string) === 'actor' || n.shape === ShapeType.ACTOR ? 'actor' : 'usecase', n.label, id(n.id))}`;

  const body: string[] = ['left to right direction'];
  const { lines, grouped } = emitGroups(ir, (g) => `rectangle ${quote(g.label || g.id)}`, emit, '');
  body.push(...lines);
  for (const n of ir.nodes) if (!grouped.has(n.id)) body.push(emit(n, ''));
  for (const e of ir.edges) body.push(`${id(e.sourceId)} ${connector(e, '-->')} ${id(e.targetId)}${edgeLabel(e)}`);
  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// Component / deployment
// -----------------------------------------------------------------------------

const COMPONENT_KEYWORDS: Record<string, string> = {
  component: 'component', service: 'component', interface: 'interface', datastore: 'database',
};
const DEPLOYMENT_KEYWORDS: Record<string, string> = {
  node: 'node', device: 'node', artifact: 'artifact', datastore: 'database', executionEnvironment: 'node',
};

function exportBoxes(ir: DiagramIR, kinds: Record<string, string>, kindKey: string, fallback: string): string {
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);
  const emit = (n: IRNode, indent: string) =>
    `${indent}${decl(kinds[(n.data?.[kindKey] as string) || ''] || fallback, n.label, id(n.id))}`;

  const { lines, grouped } = emitGroups(ir, (g) => `${(g.data?.containerKind as string) || 'package'} ${quote(g.label || g.id)}`, emit, '');
  const body = [...lines];
  for (const n of ir.nodes) if (!grouped.has(n.id)) body.push(emit(n, ''));
  for (const e of ir.edges) body.push(`${id(e.sourceId)} ${connector(e)} ${id(e.targetId)}${edgeLabel(e)}`);
  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

/**
 * Activity IR is a graph; PlantUML's modern activity syntax is a structured
 * program (`if/then/else/endif`). Rather than attempt to re-infer control
 * structure — which is not recoverable in general, and would silently reorder
 * a diagram whose branches do not nest — this emits PlantUML's *legacy*
 * activity form, which is graph-shaped and therefore lossless here.
 */
function exportActivity(ir: DiagramIR): string {
  const nodesById = new Map(ir.nodes.map((n) => [n.id, n]));
  const ref = (nid: string): string => {
    const n = nodesById.get(nid);
    if (!n) return quote(nid);
    const kind = (n.data?.activityKind as string) || 'action';
    if (kind === 'start' || kind === 'end') return '(*)';
    return quote((n.data?.activityLabel as string) || n.label || nid);
  };
  // Legacy activity carries an edge label inside the arrow: `-->[condition]`.
  const body = ir.edges.map((e) => `${ref(e.sourceId)} -->${e.label ? `[${e.label}]` : ''} ${ref(e.targetId)}`);
  return wrap(body, ir);
}

// -----------------------------------------------------------------------------
// Mindmap
// -----------------------------------------------------------------------------

function exportMindmap(ir: DiagramIR): string {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of ir.edges) {
    if (!childrenOf.has(e.sourceId)) childrenOf.set(e.sourceId, []);
    childrenOf.get(e.sourceId)!.push(e.targetId);
    hasParent.add(e.targetId);
  }
  const nodesById = new Map(ir.nodes.map((n) => [n.id, n]));
  const root = ir.nodes.find((n) => !hasParent.has(n.id)) || ir.nodes[0];
  const body: string[] = [];
  if (root) {
    const walk = (nodeId: string, depth: number) => {
      const node = nodesById.get(nodeId);
      if (!node) return;
      // `-` markers put a branch on the root's left; the side is only recorded
      // by the importer, so anything without one goes right (`*`).
      const marker = (node.data?.side as string) === 'left' ? '-' : '*';
      body.push(`${marker.repeat(depth + 1)} ${node.label.replace(/\n/g, ' ')}`);
      for (const childId of childrenOf.get(nodeId) || []) walk(childId, depth + 1);
    };
    walk(root.id, 0);
  }
  return wrap(body, ir, 'mindmap');
}

// -----------------------------------------------------------------------------
// Gantt
// -----------------------------------------------------------------------------

const GANTT_MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Recover `Title: Mon D[-D2 | - Mon2 D2]` into a title plus ISO dates. The
 *  label vocabulary carries no year, so an IR that did not come from this
 *  importer (which stores real dates on `data`) round-trips to the current
 *  year — the same lossy edge the Mermaid exporter accepts. */
function parseGanttLabel(label: string): { title: string; start: string; end: string } | null {
  const m = label.match(/^(.*):\s*([A-Za-z]{3,})\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]{3,})\s+)?(\d{1,2}))?\s*$/);
  if (!m) return null;
  const [, title, mon, startDay, endMon, endDay] = m;
  const month = GANTT_MONTHS[mon.slice(0, 3)];
  if (!month) return null;
  const year = new Date().getFullYear();
  const pad = (n: string) => n.padStart(2, '0');
  const start = `${year}-${month}-${pad(startDay)}`;
  const end = endDay ? `${year}-${GANTT_MONTHS[(endMon || mon).slice(0, 3)] || month}-${pad(endDay)}` : start;
  return { title: title.trim(), start, end };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function exportGantt(ir: DiagramIR): string {
  const body: string[] = [];
  let projectStart: string | null = null;
  const rows: Array<{ title: string; start: string; end: string; milestone: boolean }> = [];

  for (const n of ir.nodes) {
    // Dates the importer stored are authoritative; the label is the fallback
    // for IR that came from the DSL instead.
    const stored = n.data?.startDate as string | undefined;
    const parsed = parseGanttLabel(n.label);
    const title = parsed?.title || n.label.split(':')[0].trim() || n.id;
    const start = stored || parsed?.start;
    const end = (n.data?.endDate as string | undefined) || parsed?.end || start;
    if (!start || !end) continue;
    rows.push({ title, start, end, milestone: Boolean(n.data?.milestone) || start === end });
    if (!projectStart || start < projectStart) projectStart = start;
  }

  if (projectStart) body.push(`project starts ${projectStart}`);
  for (const r of rows) {
    if (r.milestone) {
      body.push(`[${r.title}] happens ${r.start}`);
      continue;
    }
    body.push(`[${r.title}] starts ${r.start}`);
    body.push(`[${r.title}] lasts ${Math.max(1, daysBetween(r.start, r.end))} days`);
  }
  return wrap(body, ir, 'gantt');
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

const EXPORTERS: Partial<Record<DiagramType, (ir: DiagramIR) => string>> = {
  [DiagramType.FLOWCHART]: exportFlowchart,
  [DiagramType.SEQUENCE]: exportSequence,
  [DiagramType.CLASS]: exportClass,
  [DiagramType.ER]: exportEr,
  [DiagramType.STATE]: exportState,
  [DiagramType.USECASE]: exportUsecase,
  [DiagramType.ACTIVITY]: exportActivity,
  [DiagramType.COMPONENT]: (ir) => exportBoxes(ir, COMPONENT_KEYWORDS, 'componentKind', 'component'),
  [DiagramType.DEPLOYMENT]: (ir) => exportBoxes(ir, DEPLOYMENT_KEYWORDS, 'deploymentKind', 'node'),
  [DiagramType.MINDMAP]: exportMindmap,
  [DiagramType.GANTT]: exportGantt,
};

/** Does this IR's type have a PlantUML export mapping? */
export function isPlantUmlExportable(type: DiagramType): boolean {
  return type in EXPORTERS;
}

/**
 * Emit PlantUML source from IR. Returns `null` for a diagram type with no
 * PlantUML spelling (charts, gitgraph, wireframe, …) rather than emitting
 * invalid or misleading source.
 */
export function exportPlantUml(ir: DiagramIR): string | null {
  const exporter = EXPORTERS[ir.type];
  return exporter ? exporter(ir) : null;
}
