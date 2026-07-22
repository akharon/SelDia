// =============================================================================
// SelDiA — Class Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { sizeForLabel } from '../layout/text-measure.js';
import { renderClassNote, renderClassCompartments } from '../render/custom-renderers.js';

/** Split a class node's `\n`-joined label into (name, attributes, operations)
 *  compartments. First line is the class name; subsequent lines are members,
 *  classified as an operation if they contain `(` (a method signature),
 *  otherwise an attribute. Leading `+`/`-`/`#` visibility markers are kept
 *  verbatim (see docs/improvement_request.md item 3 / reference image B). */
function splitCompartments(label: string): { name: string; attributes: string[]; operations: string[] } {
  const lines = label.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const name = lines[0] || '';
  const attributes: string[] = [];
  const operations: string[] = [];
  for (const line of lines.slice(1)) {
    if (line.includes('(')) operations.push(line);
    else attributes.push(line);
  }
  return { name, attributes, operations };
}

/** A note is a class-diagram node whose declared shape is the "note" shape
 *  (`[/.../]`-style is diagram-specific; plugins signal it via `nd.data.note`
 *  or a label starting with "note:"/"Note:") — rendered as a distinct yellow
 *  annotation box, not a compartmented class box (reference image B). */
function isNoteNode(nd: ASTNodeDecl): boolean {
  return nd.data?.note === true || /^note\s*:/i.test(nd.label.trim());
}

export const classPlugin: DiagramPlugin = {
  id: 'seldia-class',
  name: 'Class Diagram',
  version: '1.0.0',
  diagramType: DiagramType.CLASS,
  description: 'UML class diagrams for object-oriented design',

  transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = [];
    const edges: IREdge[] = [];

    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const fontSize = (nd.style?.fontSize as number) || 14;
        const note = isNoteNode(nd);
        if (note) {
          const text = nd.label.replace(/^note\s*:\s*/i, '');
          nodes.push({
            id: nd.id,
            label: text,
            description: nd.description || undefined,
            shape: ShapeType.RECTANGLE,
            position: { x: 0, y: 0 },
            size: sizeForLabel(text, fontSize, 140, 60),
            style: { ...(nd.style || {}) },
            ports: [],
            classList: [...(nd.classList || []), 'seldia-note'],
            collapsed: false,
            data: { ...(nd.data || {}), kind: 'note' },
          });
          continue;
        }
        const { name, attributes, operations } = splitCompartments(nd.label);
        const size = sizeForLabel(name, fontSize + 2, 160, 56, 28, 14, [...attributes, ...operations]);
        // Extra height for the two divider lines / compartment breathing room.
        size.height += (attributes.length > 0 ? 14 : 0) + (operations.length > 0 ? 14 : 0);
        nodes.push({
          id: nd.id,
          label: nd.label,
          description: nd.description || undefined,
          shape: nd.shape || ShapeType.RECTANGLE,
          position: { x: 0, y: 0 },
          size,
          style: { ...(nd.style || {}) },
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: { ...(nd.data || {}), kind: 'class', compartments: { name, attributes, operations } },
        });
      }

      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        // Relationship-kind inference from the DSL's arrow style, where
        // available; defaults to generalization (the common UML case for
        // this plugin — inheritance arrows use a hollow triangle, reference
        // image B).
        const relKind = (ed.data?.relationship as string) || ((ed.style as any)?.strokeStyle === 'dashed' ? 'dependency' : 'generalization');
        edges.push({
          id: `class-edge-${ed.sourceId}-${ed.targetId}`,
          sourceId: ed.sourceId,
          targetId: ed.targetId,
          label: ed.label || undefined,
          label2: ed.label2 || undefined,
          style: { ...(ed.style || {}), arrowhead: true },
          routing: EdgeRouting.ORTHOGONAL,
          bidirectional: ed.direction === 'both',
          classList: ed.classList || [],
          data: { ...(ed.data || {}), arrowType: relKind },
        });
      }
    }

    return {
      id: ast.metadata?.id || 'class-1',
      type: DiagramType.CLASS,
      title: ast.title || 'Class Diagram',
      nodes,
      edges,
      groups: [],
      layers: [],
      metadata: {},
    };
  },

  renderNode(node, ctx) {
    const kind = (node.data as any)?.kind as string | undefined;
    if (kind === 'note') return renderClassNote(node, ctx.pad, ctx.sketchy);
    if (kind === 'class' && (node.data as any)?.compartments) {
      return renderClassCompartments(node, ctx.pad, ctx.sketchy, ctx.swatch);
    }
    return undefined; // fall through to the generic shape renderer
  },

  getDefaultLayoutOptions() {
    return {
      direction: 'TB',
      nodeSpacing: [100, 80],
      rankSpacing: 100,
    };
  },
};
