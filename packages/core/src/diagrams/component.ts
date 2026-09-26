// =============================================================================
// SelDiA — Component Diagram Plugin
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
import { renderComponentNode } from '../render/custom-renderers.js';

export type ComponentKind = 'component' | 'datastore' | 'interface' | 'service';

/** Classifies a component-diagram node from its DSL shape and id/label
 *  keywords, the same "no dedicated syntax needed" convention used by every
 *  other misc.ts plugin: a cylinder or db-ish word is a datastore, a circle
 *  shape or the word "interface" reads as a provided-interface lollipop, and
 *  "service/microservice" gets its own tag distinct from a plain component
 *  box — the three UML component-diagram shapes authors reach for most.
 *
 *  Note "api" is deliberately NOT an interface keyword. The probe includes the
 *  node id, and `api` is the single most common id for a plain service box
 *  (`api: [API Service]`), which it then drew as a lollipop circle. A
 *  provided interface is signalled explicitly — by the `(( ))` circle shape or
 *  by the unambiguous word "interface". */
function componentKindOf(nd: ASTNodeDecl): ComponentKind {
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (nd.shape === ShapeType.CYLINDER || /\b(db|database|cache|redis|store|queue|repository)\b/.test(probe)) return 'datastore';
  if (nd.shape === ShapeType.CIRCLE || /\binterfaces?\b/.test(probe)) return 'interface';
  if (/\b(service|microservice|gateway|worker)\b/.test(probe)) return 'service';
  return 'component';
}

export const componentPlugin: DiagramPlugin = {
  id: 'seldia-component', name: 'Component Diagram', version: '1.0.0',
  diagramType: DiagramType.COMPONENT,
  description: 'Software component and dependency diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const kind = componentKindOf(nd);
        const shape = kind === 'datastore' ? ShapeType.CYLINDER : kind === 'interface' ? ShapeType.CIRCLE : ShapeType.RECTANGLE;
        const size = kind === 'interface' ? { width: 90, height: 90 } : { width: 170, height: 74 };
        nodes.push({
          id: nd.id, label: nd.label, shape,
          position: { x: 0, y: 0 }, size, style: { ...(nd.style || {}) },
          ports: [], classList: [], collapsed: false, data: { ...(nd.data || {}), componentKind: kind },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `compe-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: (ed.routing && ROUTING_MAP[ed.routing]) || EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'comp-1', type: DiagramType.COMPONENT, title: ast.title || 'Component Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderComponentNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [100, 80], rankSpacing: 100 }; },
};
