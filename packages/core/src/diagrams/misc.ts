// =============================================================================
// SelDiA — Miscellaneous Diagram Plugins (use case, activity, deployment, gantt, mindmap, network, chart, gitgraph, form, sankey, block, timeline)
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';

function genericPlugin(id: string, name: string, dt: DiagramType, desc: string, shape: ShapeType = ShapeType.RECTANGLE, defFill = '#f8fafc', defStroke = '#334155'): DiagramPlugin {
  return {
    id, name, version: '1.0.0', diagramType: dt, description: desc,
    transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
      const nodes: IRNode[] = []; const edges: IREdge[] = [];
      for (const stmt of ast.body) {
        if (stmt.kind === 'NodeDecl') {
          const nd = stmt as ASTNodeDecl;
          nodes.push({ id: nd.id, label: nd.label, shape: nd.shape || shape, position: { x: 0, y: 0 }, size: { width: 150, height: 60 }, style: { ...(nd.style || {}), fill: defFill, stroke: defStroke }, ports: [], classList: [], collapsed: false, data: nd.data || {} });
        }
        if (stmt.kind === 'EdgeDecl') {
          const ed = stmt as ASTEdgeDecl;
          edges.push({ id: `${dt}e-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {} });
        }
      }
      return { id: ast.metadata?.id || `${dt}-1`, type: dt, title: ast.title || name, nodes, edges, groups: [], layers: [], metadata: {} };
    },
    getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [80, 60], rankSpacing: 80 }; },
  };
}

export const usecasePlugin = genericPlugin('seldia-usecase', 'Use Case', DiagramType.USECASE, 'Use case diagrams', ShapeType.ROUNDED_RECTANGLE, '#fff7ed', '#9a3412');
export const activityPlugin = genericPlugin('seldia-activity', 'Activity', DiagramType.ACTIVITY, 'Activity diagrams', ShapeType.ROUNDED_RECTANGLE, '#f0f9ff', '#1e40af');
export const deploymentPlugin = genericPlugin('seldia-deployment', 'Deployment', DiagramType.DEPLOYMENT, 'Deployment diagrams', ShapeType.RECTANGLE, '#f5f3ff', '#5b21b6');
export const ganttPlugin = genericPlugin('seldia-gantt', 'Gantt Chart', DiagramType.GANTT, 'Gantt charts', ShapeType.RECTANGLE, '#ecfdf5', '#065f46');
export const mindmapPlugin = genericPlugin('seldia-mindmap', 'Mind Map', DiagramType.MINDMAP, 'Mind maps', ShapeType.ROUNDED_RECTANGLE, '#fef9c3', '#a16207');
export const networkPlugin = genericPlugin('seldia-network', 'Network', DiagramType.NETWORK, 'Network topology', ShapeType.RECTANGLE, '#f1f5f9', '#475569');
export const chartPlugin = genericPlugin('seldia-chart', 'Charts', DiagramType.CHART_BAR, 'Charts (bar, line, pie, radar, scatter)', ShapeType.RECTANGLE, '#fef2f2', '#991b1b');
export const gitgraphPlugin = genericPlugin('seldia-gitgraph', 'Git Graph', DiagramType.GITGRAPH, 'Git branch graphs', ShapeType.ROUNDED_RECTANGLE, '#f0fdfa', '#115e59');
export const formPlugin = genericPlugin('seldia-form', 'Form', DiagramType.FORM, 'Form definitions', ShapeType.RECTANGLE, '#faf5ff', '#581c87');
export const sankeyPlugin = genericPlugin('seldia-sankey', 'Sankey', DiagramType.SANKEY, 'Flow/sankey diagrams', ShapeType.RECTANGLE, '#fce7f3', '#831843');
export const blockPlugin = genericPlugin('seldia-block', 'Block', DiagramType.BLOCK, 'System block diagrams', ShapeType.RECTANGLE, '#eef2ff', '#312e81');
export const timelinePlugin = genericPlugin('seldia-timeline', 'Timeline', DiagramType.TIMELINE, 'Timeline charts', ShapeType.ROUNDED_RECTANGLE, '#f0fdfa', '#134e4a');
