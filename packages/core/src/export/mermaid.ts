// =============================================================================
// SelDiA — Mermaid Exporter
// =============================================================================
// The return leg of the Mermaid bridge: IR -> Mermaid source text. This only
// covers the diagram types the importer covers (flowchart, sequence, class,
// ER, state, gantt, pie, gitGraph, mindmap) — an IR built by hand or by a
// different frontend may use IR features (arbitrary shapes, styles, edge
// routing) that have no Mermaid equivalent; those are best-effort mapped or
// dropped, never thrown on, so export always produces *some* valid Mermaid.
// =============================================================================

import type { DiagramIR, IRNode, IREdge, IRGroup } from '../ir/types.js';
import { DiagramType } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { StrokeStyle, type NodeStyle, type EdgeStyle } from '../types/style.js';

/** Inverse of the importer's SHAPE_PATTERNS — one canonical delimiter pair
 *  per shape (Mermaid supports two spellings for PARALLELOGRAM; export picks
 *  one, since round-tripping the exact spelling isn't observable from the IR). */
const SHAPE_DELIMITERS: Partial<Record<ShapeType, { open: string; close: string }>> = {
  [ShapeType.STADIUM]: { open: '([', close: '])' },
  [ShapeType.SUBROUTINE]: { open: '[[', close: ']]' },
  [ShapeType.CYLINDER]: { open: '[(', close: ')]' },
  [ShapeType.CIRCLE]: { open: '((', close: '))' },
  [ShapeType.HEXAGON]: { open: '{{', close: '}}' },
  [ShapeType.PARALLELOGRAM]: { open: '[/', close: '/]' },
  [ShapeType.NOTE]: { open: '>', close: ']' },
  [ShapeType.ROUNDED_RECTANGLE]: { open: '(', close: ')' },
  [ShapeType.DIAMOND]: { open: '{', close: '}' },
  // RECTANGLE and anything unmapped uses the default `[...]` fallback below.
};

/** Mermaid node/edge ids must be identifier-safe; anything else needs a
 *  generated stand-in so the label (which carries the real text) stays free
 *  to hold arbitrary characters. */
function safeId(id: string, seen: Map<string, string>, counter: { n: number }): string {
  if (seen.has(id)) return seen.get(id)!;
  const safe = /^[A-Za-z_][\w-]*$/.test(id) ? id : `n${counter.n++}`;
  seen.set(id, safe);
  return safe;
}

/** Mermaid labels containing shape delimiters or newlines must be quoted or
 *  they'd be misread as closing a shape early or ending the statement. */
function quoteLabel(label: string): string {
  const needsQuote = /[[\](){}|<>"#;:]/.test(label) || label.includes('\n');
  const escaped = label.replace(/\n/g, '<br/>');
  return needsQuote ? `"${escaped.replace(/"/g, '#quot;')}"` : escaped;
}

function nodeDecl(node: IRNode, id: string): string {
  const delim = SHAPE_DELIMITERS[node.shape];
  if (!delim) return `${id}[${quoteLabel(node.label)}]`;
  return `${id}${delim.open}${quoteLabel(node.label)}${delim.close}`;
}

/** Inverse of parseStyleDecl in the importer: only the properties Mermaid's
 *  `style`/`classDef`/`linkStyle` syntax actually understands. */
function styleToDecl(style: Partial<NodeStyle> | Partial<EdgeStyle>): string {
  const parts: string[] = [];
  if ('fill' in style && style.fill) parts.push(`fill:${style.fill}`);
  if (style.stroke) parts.push(`stroke:${style.stroke}`);
  if (style.strokeWidth != null) parts.push(`stroke-width:${style.strokeWidth}px`);
  if (style.strokeDasharray) parts.push(`stroke-dasharray:${style.strokeDasharray}`);
  if (style.textColor) parts.push(`color:${style.textColor}`);
  if (style.opacity != null) parts.push(`opacity:${style.opacity}`);
  return parts.join(',');
}

// -----------------------------------------------------------------------------
// Flowchart
// -----------------------------------------------------------------------------

function exportFlowchart(ir: DiagramIR): string {
  const lines: string[] = [`flowchart ${(ir.metadata?.direction as string) || 'TD'}`];
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);

  const groupsById = new Map<string, IRGroup>();
  for (const g of ir.groups) groupsById.set(g.id, g);
  const nodesById = new Map<string, IRNode>();
  for (const n of ir.nodes) nodesById.set(n.id, n);

  const emitGroup = (group: IRGroup, indent: string) => {
    lines.push(`${indent}subgraph ${id(group.id)}${group.label ? ` [${quoteLabel(group.label)}]` : ''}`);
    for (const childId of group.childGroupIds) {
      const child = groupsById.get(childId);
      if (child) emitGroup(child, indent + '  ');
    }
    for (const nodeId of group.childNodeIds) {
      const node = nodesById.get(nodeId);
      if (node) lines.push(`${indent}  ${nodeDecl(node, id(node.id))}`);
    }
    lines.push(`${indent}end`);
  };

  const grouped = new Set<string>();
  for (const g of ir.groups) for (const nid of g.childNodeIds) grouped.add(nid);
  const topGroups = ir.groups.filter((g) => !ir.groups.some((other) => other.childGroupIds.includes(g.id)));
  for (const g of topGroups) emitGroup(g, '  ');

  for (const node of ir.nodes) {
    if (grouped.has(node.id)) continue;
    lines.push(`  ${nodeDecl(node, id(node.id))}`);
  }

  for (const edge of ir.edges) {
    const dashed = edge.style.strokeStyle === StrokeStyle.DASHED;
    const arrow = edge.style.arrowhead === false ? '---' : dashed ? '-.->' : '-->';
    const label = edge.label ? `|${quoteLabel(edge.label)}|` : '';
    lines.push(`  ${id(edge.sourceId)} ${arrow}${label} ${id(edge.targetId)}`);
  }

  for (const node of ir.nodes) {
    const decl = styleToDecl(node.style);
    if (decl) lines.push(`  style ${id(node.id)} ${decl}`);
  }

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Sequence
// -----------------------------------------------------------------------------

function exportSequence(ir: DiagramIR): string {
  const lines: string[] = ['sequenceDiagram'];
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);

  for (const node of ir.nodes) {
    const kw = node.shape === ShapeType.ACTOR ? 'actor' : 'participant';
    lines.push(`  ${kw} ${id(node.id)}${node.label !== node.id ? ` as ${node.label}` : ''}`);
  }
  for (const edge of ir.edges) {
    const arrow = edge.style.strokeStyle === StrokeStyle.DASHED ? '-->>' : '->>';
    lines.push(`  ${id(edge.sourceId)}${arrow}${id(edge.targetId)}: ${edge.label || ''}`);
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Class
// -----------------------------------------------------------------------------

const CLASS_RELATION_TOKENS: Record<string, string> = {
  inheritance: '<|--',
  composition: '*--',
  aggregation: 'o--',
  association: '-->',
  dependency: '..>',
  realization: '..|>',
};

function exportClass(ir: DiagramIR): string {
  const lines: string[] = ['classDiagram'];
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);

  for (const node of ir.nodes) {
    // The class importer folds `Name\nmember1\nmember2` into the label; split
    // it back apart so members render as class-body lines, not one giant name.
    const [name, ...members] = node.label.split('\n');
    const nodeId = id(node.id);
    if (members.length === 0) {
      lines.push(`  class ${nodeId}`);
      continue;
    }
    lines.push(`  class ${nodeId} {`);
    for (const m of members) lines.push(`    ${m}`);
    lines.push('  }');
    if (name !== node.id && name !== nodeId) lines.push(`  class ${nodeId}["${name}"]`);
  }
  for (const edge of ir.edges) {
    const kind = (edge.data?.relation as string) || 'association';
    const token = CLASS_RELATION_TOKENS[kind] || '-->';
    // Import flips inheritance/association-with-flip to store child->parent;
    // undo that here so Mermaid sees parent-first again.
    const flipped = token === '<|--';
    const source = flipped ? edge.targetId : edge.sourceId;
    const target = flipped ? edge.sourceId : edge.targetId;
    const label = edge.label ? ` : ${edge.label}` : '';
    lines.push(`  ${id(source)} ${token} ${id(target)}${label}`);
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// ER
// -----------------------------------------------------------------------------

function exportEr(ir: DiagramIR): string {
  const lines: string[] = ['erDiagram'];
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);

  for (const node of ir.nodes) {
    const attrs = (node.data?.attributes as string[]) || [];
    if (attrs.length === 0) continue;
    lines.push(`  ${id(node.id)} {`);
    for (const a of attrs) lines.push(`    ${a}`);
    lines.push('  }');
  }
  for (const edge of ir.edges) {
    const left = (edge.data?.sourceCardinality as string) || '||';
    const right = (edge.data?.targetCardinality as string) || 'o{';
    const label = edge.label || 'relates to';
    lines.push(`  ${id(edge.sourceId)} ${left}--${right} ${id(edge.targetId)} : ${label}`);
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

function exportState(ir: DiagramIR): string {
  const lines: string[] = ['stateDiagram-v2'];
  const seen = new Map<string, string>();
  const counter = { n: 0 };
  const id = (nid: string) => safeId(nid, seen, counter);

  const pseudo = (nid: string) => (nid.startsWith('__start_') || nid.startsWith('__end_') ? '[*]' : id(nid));

  for (const edge of ir.edges) {
    const label = edge.label ? `: ${edge.label}` : '';
    lines.push(`  ${pseudo(edge.sourceId)} --> ${pseudo(edge.targetId)}${label}`);
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Gantt
// -----------------------------------------------------------------------------

const GANTT_MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Inverse of ganttDateToLabel + the importer's label assembly: recover
 *  `"Mon D"` / `"Mon D-D2"` back into a start date + duration/end. There's no
 *  year in the label vocabulary, so the current year is used — round-tripping
 *  loses the year, which is an accepted lossy edge (same tradeoff the
 *  importer already made when it discarded the year going the other way). */
function parseGanttTitleLabel(label: string): { title: string; startIso: string; endIso: string } | null {
  const m = label.match(/^(.*):\s*([A-Za-z]{3,})\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*$/);
  if (!m) return null;
  const [, title, mon, startDay, endDay] = m;
  const month = GANTT_MONTHS[mon.slice(0, 3)];
  if (!month) return null;
  const year = new Date().getFullYear();
  const pad = (n: string) => n.padStart(2, '0');
  const startIso = `${year}-${month}-${pad(startDay)}`;
  const endIso = endDay ? `${year}-${month}-${pad(endDay)}` : startIso;
  return { title: title.trim(), startIso, endIso };
}

function exportGantt(ir: DiagramIR): string {
  const lines: string[] = ['gantt', '  title Gantt Chart', '  dateFormat YYYY-MM-DD'];
  for (const node of ir.nodes) {
    const parsed = parseGanttTitleLabel(node.label);
    if (!parsed) continue;
    const { title, startIso, endIso } = parsed;
    if (startIso === endIso) {
      lines.push(`  ${title} : milestone, ${startIso}, 0d`);
    } else {
      lines.push(`  ${title} : ${startIso}, ${endIso}`);
    }
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Pie
// -----------------------------------------------------------------------------

function exportPie(ir: DiagramIR): string {
  const lines: string[] = ['pie'];
  for (const node of ir.nodes) {
    const [category, valueLine] = node.label.split('\n');
    const valueMatch = (valueLine || '').match(/:\s*(-?\d+(?:\.\d+)?)/);
    const value = valueMatch ? valueMatch[1] : '1';
    lines.push(`  "${category}" : ${value}`);
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// GitGraph
// -----------------------------------------------------------------------------

function exportGitgraph(ir: DiagramIR): string {
  const lines: string[] = ['gitGraph'];
  const branchesSeen = new Set<string>(['main']);
  let currentBranch = 'main';

  for (const node of ir.nodes) {
    const m = node.label.match(/^([\w.\-/]+):\s*(.*)$/);
    if (!m) continue;
    const [, branch, message] = m;
    if (!branchesSeen.has(branch)) {
      lines.push(`  branch ${branch}`);
      branchesSeen.add(branch);
      currentBranch = branch;
    } else if (branch !== currentBranch) {
      lines.push(`  checkout ${branch}`);
      currentBranch = branch;
    }
    if (message.startsWith('merge ')) {
      lines.push(`  merge ${message.slice('merge '.length)}`);
    } else {
      lines.push(`  commit id: "${message}"`);
    }
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Mindmap
// -----------------------------------------------------------------------------

function exportMindmap(ir: DiagramIR): string {
  const lines: string[] = ['mindmap'];
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of ir.edges) {
    if (!childrenOf.has(edge.sourceId)) childrenOf.set(edge.sourceId, []);
    childrenOf.get(edge.sourceId)!.push(edge.targetId);
    hasParent.add(edge.targetId);
  }
  const nodesById = new Map(ir.nodes.map((n) => [n.id, n]));
  const root = ir.nodes.find((n) => !hasParent.has(n.id)) || ir.nodes[0];
  if (!root) return lines.join('\n');

  const walk = (nodeId: string, depth: number) => {
    const node = nodesById.get(nodeId);
    if (!node) return;
    const indent = '  '.repeat(depth + 1);
    const delim = SHAPE_DELIMITERS[node.shape];
    lines.push(delim ? `${indent}${delim.open}${node.label}${delim.close}` : `${indent}${node.label}`);
    for (const childId of childrenOf.get(nodeId) || []) walk(childId, depth + 1);
  };
  walk(root.id, 0);
  return lines.join('\n');
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
  [DiagramType.GANTT]: exportGantt,
  [DiagramType.CHART_PIE]: exportPie,
  [DiagramType.GITGRAPH]: exportGitgraph,
  [DiagramType.MINDMAP]: exportMindmap,
};

/** Does this IR's type have a Mermaid export mapping? */
export function isMermaidExportable(type: DiagramType): boolean {
  return type in EXPORTERS;
}

/**
 * Emit Mermaid source from IR. Only covers the types the importer covers —
 * the same set that has a native Mermaid grammar to target. Returns `null`
 * for any other type rather than emitting invalid or misleading Mermaid.
 */
export function exportMermaid(ir: DiagramIR): string | null {
  const exporter = EXPORTERS[ir.type];
  return exporter ? exporter(ir) : null;
}
