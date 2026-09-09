// =============================================================================
// SelDiA — Miscellaneous Diagram Plugins (use case, activity, deployment, gantt, mindmap, network, chart, gitgraph, form, sankey, block, timeline)
// =============================================================================

import type { DiagramPlugin } from '../plugin/types.js';
import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl, ASTSectionDecl, ASTGroupDecl, ASTStatement } from '../ast/nodes.js';
import type { DiagramIR, IRNode, IREdge } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType, EdgeRouting } from '../ir/types.js';
import { ShapeType } from '../types/shapes.js';
import { sizeForLabel } from '../layout/text-measure.js';
import type { NodeRenderContext } from '../plugin/types.js';
import { seriesColor } from '../render/design-system.js';
import {
  renderGanttRow, renderMindmapNode, renderGitCommit, renderDmnNode,
  renderUsecaseNode, renderActivityNode, renderDeploymentNode,
  renderNetworkNode, renderFormNode, renderBlockNode, renderWireframeNode,
  renderCloudNode,
} from '../render/custom-renderers.js';

// Note: color is intentionally NOT set here — the central design system
// (packages/core/src/render/design-system.ts) supplies each diagram type's
// signature accent and any semantic-role colors. Baking defaults in here would
// shadow that system and collapse every type to one look. Only genuine
// author-provided `nd.style` is passed through.
function genericPlugin(id: string, name: string, dt: DiagramType, desc: string, shape: ShapeType = ShapeType.RECTANGLE, renderNode?: DiagramPlugin['renderNode']): DiagramPlugin {
  return {
    id, name, version: '1.0.0', diagramType: dt, description: desc,
    transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
      const nodes: IRNode[] = []; const edges: IREdge[] = [];
      // Walk statement lists recursively: `section "Planning" { … }` (and
      // `group { … }`) bodies hold real node declarations, and a flat
      // top-level-only loop dropped every one of them. For a Gantt chart that
      // meant a sectioned plan — including the shipped gantt template —
      // compiled to zero bars and collapsed to a sliver of a chart.
      // `sectionLabel` rides along on each node's data so a renderer can band
      // or caption its section without re-walking the AST.
      const walk = (body: ASTStatement[], sectionLabel?: string) => {
        for (const stmt of body) {
          if (stmt.kind === 'NodeDecl') {
            const nd = stmt as ASTNodeDecl;
            nodes.push({ id: nd.id, label: nd.label, shape: nd.shape || shape, position: { x: 0, y: 0 }, size: sizeForLabel(nd.label, (nd.style?.fontSize as number) || 14, 150, 60), style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false, data: { ...(nd.data || {}), ...(sectionLabel ? { sectionLabel } : {}) } });
          } else if (stmt.kind === 'EdgeDecl') {
            const ed = stmt as ASTEdgeDecl;
            edges.push({ id: `${dt}e-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
          } else if (stmt.kind === 'SectionDecl') {
            const sd = stmt as ASTSectionDecl;
            walk(sd.body, sd.label || sd.id);
          } else if (stmt.kind === 'GroupDecl') {
            walk((stmt as ASTGroupDecl).body, sectionLabel);
          }
        }
      };
      walk(ast.body);
      return { id: ast.metadata?.id || `${dt}-1`, type: dt, title: ast.title || name, nodes, edges, groups: [], layers: [], metadata: {} };
    },
    getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [80, 60], rankSpacing: 80 }; },
    renderNode,
  };
}

export const ganttPlugin = genericPlugin('seldia-gantt', 'Gantt Chart', DiagramType.GANTT, 'Gantt charts', ShapeType.RECTANGLE,
  (node, ctx) => renderGanttRow(node, ctx.pad, ctx.sketchy, ctx.swatch));
export const mindmapPlugin = genericPlugin('seldia-mindmap', 'Mind Map', DiagramType.MINDMAP, 'Mind maps', ShapeType.ROUNDED_RECTANGLE,
  (node, ctx) => {
    const isRoot = (node.data as any)?.mindmapRoot === true;
    const branchIdx = ((node.data as any)?.mindmapBranch as number) ?? 0;
    const branchColor = isRoot ? ctx.swatch.stroke : seriesColor(branchIdx);
    return renderMindmapNode(node, ctx.pad, ctx.sketchy, ctx.swatch, isRoot, branchColor);
  });
export const chartPlugin = genericPlugin('seldia-chart', 'Charts', DiagramType.CHART_BAR, 'Charts (bar, line, pie, radar, scatter)', ShapeType.RECTANGLE);
export const chartLinePlugin = genericPlugin('seldia-chart-line', 'Line Chart', DiagramType.CHART_LINE, 'Line charts', ShapeType.RECTANGLE);
export const chartPiePlugin = genericPlugin('seldia-chart-pie', 'Pie Chart', DiagramType.CHART_PIE, 'Pie charts', ShapeType.RECTANGLE);
export const chartRadarPlugin = genericPlugin('seldia-chart-radar', 'Radar Chart', DiagramType.CHART_RADAR, 'Radar charts', ShapeType.RECTANGLE);
export const chartScatterPlugin = genericPlugin('seldia-chart-scatter', 'Scatter Chart', DiagramType.CHART_SCATTER, 'Scatter charts', ShapeType.RECTANGLE);
export const gitgraphPlugin = genericPlugin('seldia-gitgraph', 'Git Graph', DiagramType.GITGRAPH, 'Git branch graphs', ShapeType.ROUNDED_RECTANGLE,
  (node, ctx) => renderGitCommit(node, ctx.pad, ctx.sketchy));
export const sankeyPlugin = genericPlugin('seldia-sankey', 'Sankey', DiagramType.SANKEY, 'Flow/sankey diagrams', ShapeType.RECTANGLE);

// -----------------------------------------------------------------------------
// Use Case — actors (stick figures) vs use-case ovals, told apart by DSL shape
// -----------------------------------------------------------------------------

/** `(Customer)` parses to ROUNDED_RECTANGLE and is the DSL's own convention for
 *  "not a boxy action" (see demo.md); an actor is additionally recognized by
 *  id/label reading like a role noun so plain `actor: (Customer)` still gets
 *  a stick figure instead of an oval. Everything else — `[Withdraw Cash]` —
 *  is a use-case oval, the shape that actually reads as UML use-case notation. */
function isUsecaseActor(nd: ASTNodeDecl): boolean {
  if (nd.shape === ShapeType.ACTOR) return true;
  if (nd.shape !== ShapeType.ROUNDED_RECTANGLE) return false;
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  return /\b(customer|user|admin|actor|operator|client|system|guest)\b/.test(probe);
}

export const usecasePlugin: DiagramPlugin = {
  id: 'seldia-usecase', name: 'Use Case', version: '1.0.0', diagramType: DiagramType.USECASE,
  description: 'Use case diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const isActor = isUsecaseActor(nd);
        nodes.push({
          id: nd.id, label: nd.label, shape: isActor ? ShapeType.ACTOR : ShapeType.ROUNDED_RECTANGLE,
          position: { x: 0, y: 0 }, size: isActor ? { width: 70, height: 100 } : sizeForLabel(nd.label, 14, 160, 64),
          style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false,
          data: { ...(nd.data || {}), usecaseKind: isActor ? 'actor' : 'usecase' },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `uce-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'usecase-1', type: DiagramType.USECASE, title: ast.title || 'Use Case Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderUsecaseNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'LR', nodeSpacing: [90, 70], rankSpacing: 140 }; },
};

// -----------------------------------------------------------------------------
// Activity — start/end dots, decision diamonds, rounded action boxes
// -----------------------------------------------------------------------------

function activityKindOf(nd: ASTNodeDecl): 'start' | 'end' | 'decision' | 'action' {
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (nd.shape === ShapeType.DIAMOND || /\?\s*$/.test(nd.label.trim())) return 'decision';
  if (nd.shape === ShapeType.ROUNDED_RECTANGLE || nd.shape === ShapeType.CIRCLE) {
    if (/\b(start|begin)\b/.test(probe)) return 'start';
    if (/\b(end|done|stop|finish|complete)\b/.test(probe)) return 'end';
  }
  return 'action';
}

export const activityPlugin: DiagramPlugin = {
  id: 'seldia-activity', name: 'Activity', version: '1.0.0', diagramType: DiagramType.ACTIVITY,
  description: 'Activity diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const kind = activityKindOf(nd);
        const size = kind === 'start' || kind === 'end' ? { width: 48, height: 48 } : kind === 'decision' ? { width: 130, height: 90 } : sizeForLabel(nd.label, 14, 160, 60);
        nodes.push({
          id: nd.id, label: kind === 'start' || kind === 'end' ? '' : nd.label,
          shape: kind === 'start' || kind === 'end' ? ShapeType.CIRCLE : kind === 'decision' ? ShapeType.DIAMOND : ShapeType.ROUNDED_RECTANGLE,
          position: { x: 0, y: 0 }, size, style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false,
          data: { ...(nd.data || {}), activityKind: kind, activityLabel: nd.label },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `acte-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'activity-1', type: DiagramType.ACTIVITY, title: ast.title || 'Activity Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderActivityNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [80, 60], rankSpacing: 90 }; },
};

// -----------------------------------------------------------------------------
// Deployment — 3D "node" boxes (UML deployment-diagram device notation)
// -----------------------------------------------------------------------------

export type DeploymentKind = 'datastore' | 'node' | 'device' | 'artifact' | 'executionEnvironment';

function deploymentKindOf(nd: ASTNodeDecl): DeploymentKind {
  if (nd.shape === ShapeType.CYLINDER) return 'datastore';
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (/\b(db|database|cache|redis|store|queue)\b/.test(probe)) return 'datastore';
  if (/\b(artifact|\.jar|\.war|\.dll|\.exe|binary|package)\b/.test(probe)) return 'artifact';
  if (/\b(device|phone|mobile|tablet|iot|sensor)\b/.test(probe)) return 'device';
  if (/\b(container|docker|runtime|jvm|environment|env\b|sandbox)\b/.test(probe)) return 'executionEnvironment';
  return 'node';
}

export const deploymentPlugin: DiagramPlugin = {
  id: 'seldia-deployment', name: 'Deployment', version: '1.0.0', diagramType: DiagramType.DEPLOYMENT,
  description: 'Deployment diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const kind = deploymentKindOf(nd);
        const size = kind === 'artifact' ? { width: 150, height: 90 } : { width: 180, height: 84 };
        nodes.push({
          id: nd.id, label: nd.label, shape: kind === 'datastore' ? ShapeType.CYLINDER : ShapeType.RECTANGLE,
          position: { x: 0, y: 0 }, size, style: { ...(nd.style || {}) },
          ports: [], classList: [], collapsed: false, data: { ...(nd.data || {}), deploymentKind: kind },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `depe-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'deploy-1', type: DiagramType.DEPLOYMENT, title: ast.title || 'Deployment Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderDeploymentNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [100, 90], rankSpacing: 110 }; },
};

// -----------------------------------------------------------------------------
// Network — device-shaped nodes: router (hexagon-ish), switch, workstation
// -----------------------------------------------------------------------------

export type NetworkKind = 'router' | 'switch' | 'server' | 'workstation' | 'firewall' | 'cloud' | 'loadbalancer' | 'database' | 'storage' | 'accesspoint' | 'internet';

function networkKindOf(nd: ASTNodeDecl): NetworkKind {
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (/\bfirewall\b/.test(probe)) return 'firewall';
  if (/\b(cloud|aws|azure|gcp)\b/.test(probe)) return 'cloud';
  if (/\b(internet|wan)\b/.test(probe)) return 'internet';
  if (/\b(load.?balancer|lb)\b/.test(probe)) return 'loadbalancer';
  if (/\b(access.?point|wifi|wi-fi|ap)\b/.test(probe)) return 'accesspoint';
  if (/\b(storage|disk|nas|san)\b/.test(probe)) return 'storage';
  if (/\b(db|database|sql)\b/.test(probe)) return 'database';
  if (/\brouter\b/.test(probe)) return 'router';
  if (/\bswitch\b/.test(probe)) return 'switch';
  if (/\b(server|host)\b/.test(probe)) return 'server';
  return 'workstation';
}

export const networkPlugin: DiagramPlugin = {
  id: 'seldia-network', name: 'Network', version: '1.0.0', diagramType: DiagramType.NETWORK,
  description: 'Network topology',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const kind = networkKindOf(nd);
        const size = kind === 'router' || kind === 'firewall' ? { width: 90, height: 90 }
          : kind === 'switch' ? { width: 130, height: 60 }
          : kind === 'cloud' || kind === 'internet' ? { width: 150, height: 96 }
          : kind === 'loadbalancer' ? { width: 100, height: 90 }
          : kind === 'database' || kind === 'storage' ? { width: 100, height: 100 }
          : { width: 96, height: 90 };
        const shape = kind === 'router' ? ShapeType.HEXAGON : kind === 'database' ? ShapeType.CYLINDER : ShapeType.RECTANGLE;
        nodes.push({
          id: nd.id, label: nd.label, shape,
          position: { x: 0, y: 0 }, size, style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false,
          data: { ...(nd.data || {}), networkKind: kind },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `nete-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'network-1', type: DiagramType.NETWORK, title: ast.title || 'Network Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderNetworkNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [90, 80], rankSpacing: 110 }; },
};

// -----------------------------------------------------------------------------
// Form — field rows (label / type+required badge), parsed from
// `name: [Label: type, required]` / `theme: [Theme: A / B / C]` conventions
// -----------------------------------------------------------------------------

/** Parses the demo DSL's form-field convention: "Label: type[, required]" or
 *  "Label: option / option / option" for a select-style field. Falls back to
 *  treating the whole label as the field name with a "text" type when no
 *  colon is present, so an author's plain label never renders empty. */
function parseFormField(label: string): { name: string; type: string; required: boolean; options?: string[] } {
  const idx = label.indexOf(':');
  if (idx === -1) return { name: label, type: 'text', required: false };
  const name = label.slice(0, idx).trim();
  const rest = label.slice(idx + 1).trim();
  if (rest.includes('/')) return { name, type: 'select', required: false, options: rest.split('/').map((s) => s.trim()) };
  const parts = rest.split(',').map((s) => s.trim());
  const required = parts.some((p) => /required/i.test(p));
  const type = (parts[0] || 'text').replace(/\d+-\d+/, 'range').toLowerCase();
  return { name, type, required };
}

export const formPlugin: DiagramPlugin = {
  id: 'seldia-form', name: 'Form', version: '1.0.0', diagramType: DiagramType.FORM,
  description: 'Form definitions',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const field = parseFormField(nd.label);
        const isSubmit = /submit|register|save|confirm/i.test(field.name);
        nodes.push({
          id: nd.id, label: nd.label, shape: isSubmit ? ShapeType.STADIUM : ShapeType.RECTANGLE,
          position: { x: 0, y: 0 }, size: isSubmit ? { width: 160, height: 50 } : { width: 220, height: 60 },
          style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false,
          data: { ...(nd.data || {}), formField: field, formSubmit: isSubmit },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `forme-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'form-1', type: DiagramType.FORM, title: ast.title || 'Form', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderFormNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [70, 24], rankSpacing: 40 }; },
};

// -----------------------------------------------------------------------------
// Block — system architecture blocks; a node whose label matches another
// node's id/label prefix nests visually via a subtle "group" tint (kept flat
// in IR — no true nesting yet — but distinguished from a plain flowchart box
// by a stacked-layers glyph, the block-diagram signature).
// -----------------------------------------------------------------------------

export const blockPlugin: DiagramPlugin = {
  id: 'seldia-block', name: 'Block', version: '1.0.0', diagramType: DiagramType.BLOCK,
  description: 'System block diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        nodes.push({
          id: nd.id, label: nd.label, shape: ShapeType.RECTANGLE, position: { x: 0, y: 0 },
          size: sizeForLabel(nd.label, 14, 150, 66), style: { ...(nd.style || {}) },
          ports: [], classList: [], collapsed: false, data: nd.data || {},
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `blke-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'block-1', type: DiagramType.BLOCK, title: ast.title || 'Block Diagram', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderBlockNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [70, 60], rankSpacing: 80 }; },
};

// -----------------------------------------------------------------------------
// Timeline — horizontal axis with period markers, one per node in edge order
// -----------------------------------------------------------------------------

export const timelinePlugin: DiagramPlugin = {
  id: 'seldia-timeline', name: 'Timeline', version: '1.0.0', diagramType: DiagramType.TIMELINE,
  description: 'Timeline charts',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    let i = 0;
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        nodes.push({
          id: nd.id, label: nd.label, shape: ShapeType.ROUNDED_RECTANGLE, position: { x: 0, y: 0 },
          size: { width: 170, height: 70 }, style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false,
          data: { ...(nd.data || {}), timelineIndex: i++ },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `tle-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.STRAIGHT, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'timeline-1', type: DiagramType.TIMELINE, title: ast.title || 'Timeline', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  getDefaultLayoutOptions() { return { direction: 'LR', nodeSpacing: [60, 60], rankSpacing: 130 }; },
};

/** DMN's IR shape is generic (nodes+edges), but "Rule: ..." nodes need a
 *  taller box than "Input: ..." nodes to fit their condition+outcome rows —
 *  sizeForLabel (built for single-purpose label text) sized every node the
 *  same, which is why decision tables read as plain boxes. */
export const dmnPlugin: DiagramPlugin = {
  id: 'seldia-dmn', name: 'DMN Decision Table', version: '1.0.0', diagramType: DiagramType.DMN,
  description: 'DMN decision tables',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const isRule = /^rule\s*:/i.test(nd.label.split(/\\n|\n/)[0] || '');
        nodes.push({
          id: nd.id, label: nd.label, shape: ShapeType.RECTANGLE, position: { x: 0, y: 0 },
          size: isRule ? { width: 220, height: 110 } : { width: 170, height: 70 },
          style: { ...(nd.style || {}) }, ports: [], classList: [], collapsed: false, data: nd.data || {},
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `dmne-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'dmn-1', type: DiagramType.DMN, title: ast.title || 'DMN Decision Table', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderDmnNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'LR', nodeSpacing: [90, 70], rankSpacing: 110 }; },
};

// -----------------------------------------------------------------------------
// Wireframe — low-fidelity UI mockup elements (wired-elements style): button,
// input, heading, text, image placeholder, checkbox, navbar, card/panel
// -----------------------------------------------------------------------------

export type WireframeKind =
  | 'button' | 'input' | 'textarea' | 'checkbox' | 'radio' | 'toggle'
  | 'slider' | 'dropdown' | 'progress' | 'divider' | 'link' | 'image'
  | 'avatar' | 'heading' | 'navbar' | 'card' | 'text';

/** Classifies a wireframe node from its id/label keywords — the same "no
 *  dedicated syntax needed" convention as every other misc.ts plugin. Checked
 *  in order of specificity so a more distinctive control keyword wins over a
 *  more generic one (e.g. `toggle` before `checkbox`, `avatar` before
 *  `image`). */
function wireframeKindOf(nd: ASTNodeDecl): WireframeKind {
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (/\b(divider|separator|\bhr\b|rule)\b/.test(probe)) return 'divider';
  if (/\b(avatar|profile\s*pic|userpic)\b/.test(probe)) return 'avatar';
  if (/\b(image|img|photo|picture|logo|thumbnail|banner)\b/.test(probe)) return 'image';
  if (/\b(navbar|nav|menu|toolbar|appbar)\b/.test(probe)) return 'navbar';
  if (/\b(textarea|message|comment|description|notes|bio|paragraph)\b/.test(probe)) return 'textarea';
  if (/\b(dropdown|select|combobox|combo|picker)\b/.test(probe)) return 'dropdown';
  if (/\b(slider|range)\b/.test(probe)) return 'slider';
  if (/\b(progress|progressbar|loading|meter)\b/.test(probe)) return 'progress';
  if (/\b(toggle|switch)\b/.test(probe)) return 'toggle';
  if (/\b(radio|option)\b/.test(probe)) return 'radio';
  if (/\b(checkbox|check|remember|agree|accept|consent|terms)\b/.test(probe)) return 'checkbox';
  if (/\b(link|forgot|hyperlink|anchor)\b/.test(probe)) return 'link';
  if (/\b(button|btn|submit|cancel|save|login|sign\s*in|sign\s*up|register|continue|next|ok)\b/.test(probe)) return 'button';
  if (/\b(input|field|textbox|search|email|password|username|phone|address)\b/.test(probe)) return 'input';
  if (/\b(h1|h2|h3|heading|title|headline)\b/.test(probe)) return 'heading';
  if (/\b(card|panel|tile|container)\b/.test(probe)) return 'card';
  return 'text';
}

/** Default on-canvas size for each wireframe control kind. */
function wireframeSize(kind: WireframeKind): { width: number; height: number } {
  switch (kind) {
    case 'button': return { width: 132, height: 42 };
    case 'input': return { width: 240, height: 42 };
    case 'textarea': return { width: 240, height: 92 };
    case 'checkbox': return { width: 200, height: 30 };
    case 'radio': return { width: 200, height: 30 };
    case 'toggle': return { width: 200, height: 34 };
    case 'slider': return { width: 240, height: 40 };
    case 'dropdown': return { width: 240, height: 42 };
    case 'progress': return { width: 240, height: 26 };
    case 'divider': return { width: 280, height: 14 };
    case 'link': return { width: 180, height: 26 };
    case 'image': return { width: 200, height: 130 };
    case 'avatar': return { width: 76, height: 76 };
    case 'heading': return { width: 280, height: 42 };
    case 'navbar': return { width: 400, height: 52 };
    case 'card': return { width: 240, height: 150 };
    default: return { width: 220, height: 30 };
  }
}

export const wireframePlugin: DiagramPlugin = {
  id: 'seldia-wireframe', name: 'Wireframe', version: '1.0.0', diagramType: DiagramType.WIREFRAME,
  description: 'Low-fidelity UI wireframes/mockups',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const kind = wireframeKindOf(nd);
        nodes.push({
          id: nd.id, label: nd.label, shape: ShapeType.RECTANGLE,
          position: { x: 0, y: 0 }, size: wireframeSize(kind), style: { ...(nd.style || {}) },
          ports: [], classList: [], collapsed: false, data: { ...(nd.data || {}), wireframeKind: kind },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        // Wireframe edges are LAYOUT-ONLY — they stack controls in reading order
        // but are never drawn: a mockup is a screen layout, not a flowchart, so
        // arrows threading between form fields would be visual noise. The engine
        // skips drawing edges for DiagramType.WIREFRAME (see engine.ts).
        edges.push({ id: `wfe-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    // If the author gave no edges, auto-chain the controls top-to-bottom in
    // declaration order so they still stack into a form instead of overlapping.
    if (edges.length === 0) {
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({ id: `wfe-auto-${i}`, sourceId: nodes[i].id, targetId: nodes[i + 1].id, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'wireframe-1', type: DiagramType.WIREFRAME, title: ast.title || 'Wireframe', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderWireframeNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'TB', nodeSpacing: [28, 18], rankSpacing: 26 }; },
};

// -----------------------------------------------------------------------------
// Cloud — AWS/cloud architecture diagrams with service nodes and cloud boundary
// -----------------------------------------------------------------------------

export type CloudKind = 'cloud' | 'region' | 'vpc' | 'az' | 'compute' | 'container' | 'serverless' | 'storage' | 'database' | 'network' | 'security' | 'queue' | 'cdn' | 'dns' | 'user';

function cloudKindOf(nd: ASTNodeDecl): CloudKind {
  const probe = `${nd.id} ${nd.label}`.toLowerCase();
  if (/\b(region)\b/.test(probe)) return 'region';
  if (/\b(vpc|virtual\s*private)\b/.test(probe)) return 'vpc';
  if (/\b(az|availability\s*zone)\b/.test(probe)) return 'az';
  if (/\b(ec2|vm|instance|compute|server\b|host)\b/.test(probe)) return 'compute';
  if (/\b(ecs|eks|kubernetes|k8s|container|docker)\b/.test(probe)) return 'container';
  if (/\b(lambda|function|serverless)\b/.test(probe)) return 'serverless';
  if (/\b(s3|bucket|storage|object|blob|efs|nfs)\b/.test(probe)) return 'storage';
  if (/\b(rds|aurora|dynamodb|database|db\b|sql|nosql|postgres|mysql)\b/.test(probe)) return 'database';
  if (/\b(elb|alb|nlb|load\s*balancer|api\s*gateway|cloudfront|cdn)\b/.test(probe)) return 'cdn';
  if (/\b(route53|dns|domain)\b/.test(probe)) return 'dns';
  if (/\b(sqs|sns|queue|message|eventbridge|kafka|stream)\b/.test(probe)) return 'queue';
  if (/\b(iam|waf|cognito|security|firewall|shield)\b/.test(probe)) return 'security';
  if (/\b(user|client|browser|mobile|device|endpoint)\b/.test(probe)) return 'user';
  if (/\b(cloud|aws|azure|gcp|internet)\b/.test(probe)) return 'cloud';
  return 'compute';
}

function cloudSize(kind: CloudKind): { width: number; height: number } {
  switch (kind) {
    case 'cloud': case 'region': return { width: 260, height: 200 };
    case 'vpc': return { width: 200, height: 160 };
    case 'az': return { width: 160, height: 120 };
    case 'user': return { width: 70, height: 80 };
    default: return { width: 100, height: 90 };
  }
}

export const cloudPlugin: DiagramPlugin = {
  id: 'seldia-cloud', name: 'Cloud Architecture', version: '1.0.0', diagramType: DiagramType.CLOUD,
  description: 'Cloud/AWS architecture diagrams',
  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const nodes: IRNode[] = []; const edges: IREdge[] = [];
    for (const stmt of ast.body) {
      if (stmt.kind === 'NodeDecl') {
        const nd = stmt as ASTNodeDecl;
        const kind = cloudKindOf(nd);
        nodes.push({
          id: nd.id, label: nd.label, shape: ShapeType.RECTANGLE,
          position: { x: 0, y: 0 }, size: cloudSize(kind), style: { ...(nd.style || {}) },
          ports: [], classList: [], collapsed: false, data: { ...(nd.data || {}), cloudKind: kind },
        });
      }
      if (stmt.kind === 'EdgeDecl') {
        const ed = stmt as ASTEdgeDecl;
        edges.push({ id: `cloude-${ed.sourceId}-${ed.targetId}`, sourceId: ed.sourceId, targetId: ed.targetId, label: ed.label || undefined, style: {}, routing: EdgeRouting.ORTHOGONAL, bidirectional: false, classList: [], data: {} });
      }
    }
    return { id: ast.metadata?.id || 'cloud-1', type: DiagramType.CLOUD, title: ast.title || 'Cloud Architecture', nodes, edges, groups: [], layers: [], metadata: {} };
  },
  renderNode(node, ctx) { return renderCloudNode(node, ctx.pad, ctx.sketchy, ctx.swatch); },
  getDefaultLayoutOptions() { return { direction: 'LR', nodeSpacing: [80, 60], rankSpacing: 100 }; },
};
