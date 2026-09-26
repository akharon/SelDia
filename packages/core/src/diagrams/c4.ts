// =============================================================================
// SelDiA — C4 Architecture Diagram Plugin
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
import { StrokeStyle } from '../types/style.js';
import { renderC4Node } from '../render/custom-renderers.js';

/** Classifies a C4 element from the DSL's type keyword (`person customer:
 *  "..."`, `system_Ext mainframe: "..."`, ...) — falls back to 'system' for
 *  plain `id: "label"` nodes (the container-diagram shorthand demo.md uses),
 *  since those are almost always internal containers/systems, not people or
 *  databases. Read from `data.typeKeyword` (see parser.ts) rather than
 *  guessing from the node id, which never actually carried the keyword. */
function c4KindOf(nd: ASTNodeDecl): 'person' | 'system' | 'systemExt' | 'container' | 'containerExt' | 'containerDb' | 'component' {
  const kw = ((nd.data as any)?.typeKeyword as string | undefined)?.toLowerCase();
  switch (kw) {
    case 'person': case 'actor': return 'person';
    case 'system_ext': return 'systemExt';
    case 'container_ext': return 'containerExt';
    case 'containerdb': return 'containerDb';
    case 'database': return 'containerDb';
    case 'container': return 'container';
    case 'component': return 'component';
    case 'system': default: return 'system';
  }
}

function buildC4Ir(ast: DiagramAST, diagramType: DiagramType): DiagramIR {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  for (const stmt of ast.body) {
    if (stmt.kind === 'NodeDecl') {
      const nd = stmt as ASTNodeDecl;
      const c4Kind = c4KindOf(nd);
      const shape = c4Kind === 'person' ? ShapeType.ACTOR
        : c4Kind === 'containerDb' ? ShapeType.CYLINDER
        : nd.shape;
      nodes.push({
        id: nd.id, label: nd.label, shape, description: nd.description || undefined,
        position: { x: 0, y: 0 }, size: { width: c4Kind === 'person' ? 130 : 180, height: c4Kind === 'person' ? 100 : 90 },
        style: { ...(nd.style || {}), borderRadius: c4Kind === 'person' ? 20 : 8 },
        ports: [], classList: [], collapsed: false, data: { ...(nd.data || {}), c4Kind },
      });
    }
    if (stmt.kind === 'EdgeDecl') {
      const ed = stmt as ASTEdgeDecl;
      edges.push({
        id: `c4e-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId,
        label: ed.label || undefined, style: { ...(ed.style || {}), strokeStyle: StrokeStyle.SOLID },
        routing: (ed.routing && ROUTING_MAP[ed.routing]) || EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {},
      });
    }
  }
  return { id: ast.metadata?.id || 'c4-1', type: diagramType, title: ast.title || 'C4 Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
}

export const c4Plugin: DiagramPlugin = {
  id: 'seldia-c4', name: 'C4 Architecture', version: '1.0.0',
  diagramType: DiagramType.C4_CONTEXT,
  description: 'C4 model: Context, Container, Component, Code levels',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR { return buildC4Ir(ast, ast.type); },
  renderNode(node, ctx) { return renderC4Node(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'LR', nodeSpacing: [120, 100], rankSpacing: 120 }; },
};

// The DSL accepts all three C4 levels (`diagram c4 context`, `diagram c4
// container`, `diagram c4 component`); the plugin registry keys handlers by
// a single DiagramType, so register one handler instance per level — they
// all share the same transform logic (buildC4Ir uses ast.type for the IR).
export const c4ContainerPlugin: DiagramPlugin = {
  ...c4Plugin, id: 'seldia-c4-container', diagramType: DiagramType.C4_CONTAINER,
};
export const c4ComponentPlugin: DiagramPlugin = {
  ...c4Plugin, id: 'seldia-c4-component', diagramType: DiagramType.C4_COMPONENT,
};
