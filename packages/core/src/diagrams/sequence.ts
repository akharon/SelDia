// =============================================================================
// SelDiA — Sequence Diagram Plugin
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
const ROUTING_MAP: Record<string, EdgeRouting> = {
  straight: EdgeRouting.STRAIGHT, spline: EdgeRouting.SPLINE,
  orthogonal: EdgeRouting.ORTHOGONAL, curved: EdgeRouting.CURVED,
};
import { ShapeType } from '../types/shapes.js';
import type { NodeRenderContext } from '../plugin/types.js';
import { renderSequenceParticipant } from '../render/custom-renderers.js';

export const sequencePlugin: DiagramPlugin = {
  id: 'seldia-sequence',
  name: 'Sequence Diagram',
  version: '1.0.0',
  diagramType: DiagramType.SEQUENCE,
  description: 'Sequence diagrams for interaction flows',

  transform(ast: DiagramAST, config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = [];
    const edges: IREdge[] = [];
    let edgeIndex = 0;

    // Control fragments (alt/opt/loop/…) bracket a range of messages. We pair
    // each opener with its `end`, and while a fragment is open every message
    // inside it records the fragment id on its `data`. `else`/`critical`
    // continuation markers split an open fragment into labelled sections at the
    // index where they appear. Layout turns those ranges into boxes; nothing
    // here needs geometry, only which edges fall inside which fragment.
    interface FragBuild {
      id: string; keyword: string; label?: string;
      firstEdge: number; lastEdge: number; sections: { label?: string; firstEdge: number }[];
    }
    const fragStack: FragBuild[] = [];
    const fragments: FragBuild[] = [];
    let fragSeq = 0;

    for (const stmt of ast.body) {
      if (stmt.kind === 'FragmentMarker') {
        const fm = stmt as any;
        const kw = fm.keyword as string;
        if (kw === 'end') {
          const done = fragStack.pop();
          if (done) { done.lastEdge = edgeIndex; fragments.push(done); }
        } else if (kw === 'else' || kw === 'critical') {
          // Continuation of the innermost open fragment.
          const top = fragStack[fragStack.length - 1];
          if (top) top.sections.push({ label: fm.label, firstEdge: edgeIndex });
        } else {
          const frag: FragBuild = {
            id: `seq-frag-${++fragSeq}`, keyword: kw, label: fm.label,
            firstEdge: edgeIndex, lastEdge: edgeIndex,
            sections: [{ label: fm.label, firstEdge: edgeIndex }],
          };
          fragStack.push(frag);
        }
        continue;
      }
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        nodes.push({
          id: nd.id,
          label: nd.label,
          shape: nd.shape,
          position: { x: 0, y: 0 },
          size: { width: 120, height: 40 },
          style: nd.style ? { ...nd.style } : {},
          ports: [],
          classList: nd.classList || [],
          collapsed: false,
          data: nd.data || {},
        });
      }

      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        // Message index within the diagram — used by layout to map a fragment's
        // [firstEdge, lastEdge] range onto the Y band of those messages.
        const messageOrder = edgeIndex;
        edgeIndex++;
        edges.push({
          id: `seq-edge-${edgeIndex}`,
          sourceId: ed.sourceId,
          targetId: ed.targetId,
          label: ed.label || undefined,
          style: { ...(ed.style || {}), arrowhead: ed.direction !== 'none' },
          routing: (ed.routing && ROUTING_MAP[ed.routing]) || EdgeRouting.SPLINE,
          bidirectional: ed.direction === 'both',
          classList: ed.classList || [],
          data: { ...(ed.data || {}), messageOrder, fragmentIds: fragStack.map((f) => f.id) },
        });
      }
    }

    // Any fragment left open (missing `end`) still closes at end of diagram.
    while (fragStack.length) { const f = fragStack.pop()!; f.lastEdge = edgeIndex; fragments.push(f); }

    // Emit as plain records on metadata: id, keyword, label, the [first,last)
    // message-index span, and section split points. Layout resolves these to
    // pixel boxes once message Ys are known; edges outside any range are
    // untouched. Sorted so outer fragments (smaller span start) draw first.
    const fragmentRecords = fragments
      .map((f) => ({
        id: f.id, keyword: f.keyword, label: f.label,
        firstEdge: f.firstEdge, lastEdge: f.lastEdge,
        sections: f.sections,
      }))
      .sort((a, b) => a.firstEdge - b.firstEdge);

    return {
      id: ast.metadata?.id || 'seq-1',
      type: DiagramType.SEQUENCE,
      title: ast.title || 'Sequence Diagram',
      nodes,
      edges,
      groups: [],
      layers: [],
      metadata: fragmentRecords.length ? { sequenceFragments: fragmentRecords } : {},
    };
  },

  renderNode(node: IRNode, ctx: NodeRenderContext): string {
    return renderSequenceParticipant(node, ctx.pad, ctx.sketchy, ctx.swatch);
  },

  getDefaultLayoutOptions() {
    return {
      direction: 'TB',
      nodeSpacing: [120, 80],
      rankSpacing: 40,
    };
  },
};
