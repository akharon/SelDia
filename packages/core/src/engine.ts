// =============================================================================
// SelDiA — Core Engine Interface & Implementation
// =============================================================================

import type { ID, Diagnostic, Result, Point, Rect } from './types/common.js';
import type { DiagramIR, LayoutResult, RenderResult, IRNode, IREdge } from './ir/types.js';
import type { DiagramAST } from './ast/nodes.js';
import type { DiagramPlugin, PluginManager } from './plugin/types.js';
import type { Theme } from './types/style.js';
import type { SelDiAConfig } from './config.js';
import { DiagnosticSeverity } from './types/common.js';
import { DEFAULT_CONFIG } from './config.js';
import { analyze } from './analyzer.js';
import { parseDSL } from './parser/index.js';
import { DefaultPluginManager } from './plugin-manager.js';
import { flowchartPlugin } from './diagrams/flowchart.js';
import { sequencePlugin } from './diagrams/sequence.js';
import { classPlugin } from './diagrams/class.js';
import { c4Plugin } from './diagrams/c4.js';
import { statePlugin } from './diagrams/state.js';
import { erPlugin } from './diagrams/er.js';
import { bpmnPlugin } from './diagrams/bpmn.js';
import { componentPlugin } from './diagrams/component.js';
import { usecasePlugin, activityPlugin, deploymentPlugin, ganttPlugin, mindmapPlugin, networkPlugin, chartPlugin, gitgraphPlugin, formPlugin, sankeyPlugin, blockPlugin, timelinePlugin } from './diagrams/misc.js';
import { BUILTIN_THEMES } from './themes.js';

// -----------------------------------------------------------------------------
// Core Engine Interface
// -----------------------------------------------------------------------------

export interface CoreEngine {
  readonly config: SelDiAConfig;
  readonly plugins: PluginManager;
  parse(source: string, filePath?: string): Result<DiagramAST>;
  analyze(ast: DiagramAST): Result<DiagramAST>;
  transform(ast: DiagramAST): Result<DiagramIR>;
  layout(ir: DiagramIR): Result<LayoutResult>;
  render(layoutResult: LayoutResult): Result<RenderResult>;
  /** Synchronous full pipeline. Required by contexts that cannot await
   *  (e.g. VS Code's markdown-it fence renderer). */
  compileSync(source: string, filePath?: string): Result<RenderResult>;
  compile(source: string, filePath?: string): Promise<Result<RenderResult>>;
  validate(source: string, filePath?: string): Diagnostic[];
  getSupportedDiagramTypes(): string[];
  registerTheme(theme: Theme): void;
  getTheme(id: string): Theme | undefined;
  listThemes(): Theme[];
}

export interface EngineOptions {
  config?: Partial<SelDiAConfig>;
  plugins?: DiagramPlugin[];
  themes?: Theme[];
}

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

class SelDiAEngine implements CoreEngine {
  readonly config: SelDiAConfig;
  readonly plugins: PluginManager;
  private themes = new Map<string, Theme>();

  constructor(options?: EngineOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options?.config } as SelDiAConfig;
    this.plugins = new DefaultPluginManager();
    for (const theme of BUILTIN_THEMES) this.themes.set(theme.id, theme);
    if (options?.themes) for (const t of options.themes) this.themes.set(t.id, t);

    const builtins = [flowchartPlugin, sequencePlugin, classPlugin, c4Plugin, statePlugin, erPlugin, bpmnPlugin, componentPlugin, usecasePlugin, activityPlugin, deploymentPlugin, ganttPlugin, mindmapPlugin, networkPlugin, chartPlugin, gitgraphPlugin, formPlugin, sankeyPlugin, blockPlugin, timelinePlugin];
    for (const p of builtins) this.plugins.registry.register(p);
    if (options?.plugins) for (const p of options.plugins) this.plugins.registry.register(p);
  }

  parse(source: string, filePath?: string): Result<DiagramAST> {
    return parseDSL(source, filePath);
  }

  analyze(ast: DiagramAST): Result<DiagramAST> {
    return analyze(ast);
  }

  transform(ast: DiagramAST): Result<DiagramIR> {
    const plugin = this.plugins.findHandler(ast.type);
    if (!plugin) return {
      ok: false,
      errors: [{ severity: DiagnosticSeverity.ERROR, message: `No plugin for type: "${ast.type}"`, source: ast.loc, code: 'E0004' }],
    };
    try { return { ok: true, value: plugin.transform(ast, this.config) }; }
    catch (err: any) { return { ok: false, errors: [{ severity: DiagnosticSeverity.ERROR, message: `Transform error: ${err.message}`, source: ast.loc, code: 'E0005' }] }; }
  }

  layout(ir: DiagramIR): Result<LayoutResult> {
    const nodes = ir.nodes.map((n, i) => ({
      ...n,
      position: this.resolvePosition(n, i),
      size: n.size.width > 0 ? n.size : { width: 140, height: 60 },
    }));
    const edges = ir.edges.map(e => ({ ...e, waypoints: e.waypoints || this.computeWaypoints(e, nodes) }));
    const positioned: DiagramIR = { ...ir, nodes, edges };
    const bounds = this.computeBounds(nodes);
    return { ok: true, value: { diagram: positioned, bounds, warnings: [] } };
  }

  /** Resolve a node's position, honoring a manual override from the DSL
   *  (`{ layout: { x, y } }` or top-level `{ x, y }`), then any position set
   *  by the plugin transform, and finally a default grid placement. */
  private resolvePosition(node: IRNode, index: number): Point {
    const style = (node.style || {}) as Record<string, any>;
    const manual = (style.layout && typeof style.layout === 'object') ? style.layout : style;
    const mx = manual?.x, my = manual?.y;
    if (typeof mx === 'number' && typeof my === 'number') return { x: mx, y: my };
    if (node.position.x !== 0 || node.position.y !== 0) return node.position;
    return { x: 100 + (index % 3) * 220, y: 100 + Math.floor(index / 3) * 120 };
  }

  private computeWaypoints(edge: IREdge, nodes: IRNode[]): Point[] {
    const src = nodes.find(n => n.id === edge.sourceId);
    const tgt = nodes.find(n => n.id === edge.targetId);
    if (!src || !tgt) return [];
    const x1 = src.position.x + src.size.width / 2, y1 = src.position.y + src.size.height;
    const x2 = tgt.position.x + tgt.size.width / 2, y2 = tgt.position.y;
    return [{ x: x1, y: y1 }, { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, { x: x2, y: y2 }];
  }

  private computeBounds(nodes: IRNode[]): Rect {
    if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + n.size.width); maxY = Math.max(maxY, n.position.y + n.size.height);
    }
    return { x: minX, y: minY, width: maxX - minX + 40, height: maxY - minY + 40 };
  }

  render(layoutResult: LayoutResult): Result<RenderResult> {
    const nodes = layoutResult.diagram.nodes;
    const edges = layoutResult.diagram.edges;
    const svg = this.renderToSvg(nodes, edges, layoutResult.bounds);
    return {
      ok: true,
      value: {
        svg,
        width: layoutResult.bounds.width,
        height: layoutResult.bounds.height,
        stats: { nodeCount: nodes.length, edgeCount: edges.length, groupCount: layoutResult.diagram.groups.length, renderTimeMs: 0 },
      },
    };
  }

  private renderToSvg(nodes: IRNode[], edges: IREdge[], bounds: Rect): string {
    const pad = this.config.render.padding || 20;
    const bw = bounds.width + pad * 2, bh = bounds.height + pad * 2;
    const bg = this.config.render.background || '#ffffff';
    const sketchy = this.config.render.sketchy !== false;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bw} ${bh}" width="${bw}" height="${bh}">\n`;
    svg += `  <defs>\n    <filter id="sketch"><feTurbulence type="turbulence" baseFrequency="0.03" numOctaves="2" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="${sketchy ? 2 : 0}" xChannelSelector="R" yChannelSelector="G"/></filter>\n  </defs>\n`;
    svg += `  <rect width="${bw}" height="${bh}" fill="${bg}" rx="8"/>\n`;
    for (const e of edges) svg += `  <g class="seldia-edge" data-seldia-edge-id="${this.esc(e.id)}">\n${this.renderEdge(e, pad, sketchy)}  </g>\n`;
    for (const n of nodes) svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}">\n${this.renderNode(n, pad, sketchy)}  </g>\n`;
    svg += '</svg>';
    return svg;
  }

  private renderNode(node: IRNode, pad: number, sketchy: boolean): string {
    const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
    const cx = x + w / 2, cy = y + h / 2;
    const s = node.style || {};
    const fill = (s.fill as string) || '#e8f4f8', stroke = (s.stroke as string) || '#2c3e50';
    const sw = (s.strokeWidth as number) || 2, color = (s.textColor as string) || '#2c3e50';
    const fs = (s.fontSize as number) || 14, ff = (s.fontFamily as string) || 'Inter, system-ui, sans-serif';
    const flt = sketchy ? ' filter="url(#sketch)"' : '';
    const op = ' opacity="0.9"';
    let el = '';
    switch (node.shape) {
      case 'diamond':
        el = `    <polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n`; break;
      case 'circle':
        el = `    <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n`; break;
      case 'hexagon':
        el = `    <polygon points="${cx},${y} ${x + w},${y + h * 0.25} ${x + w},${y + h * 0.75} ${cx},${y + h} ${x},${y + h * 0.75} ${x},${y + h * 0.25}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n`; break;
      case 'parallelogram':
        el = `    <polygon points="${x + 15},${y} ${x + w},${y} ${x + w - 15},${y + h} ${x},${y + h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n`; break;
      case 'cylinder': {
        const ry = 12;
        el = `    <rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n`;
        el += `    <ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n    <ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n`; break;
      }
      case 'actor': {
        const r = Math.min(w, h * 0.3) / 2;
        el = `    <circle cx="${cx}" cy="${y + r + 4}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n    <line x1="${cx}" y1="${y + r * 2 + 8}" x2="${cx}" y2="${y + h * 0.6}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n    <line x1="${x + 10}" y1="${y + h * 0.4}" x2="${x + w - 10}" y2="${y + h * 0.4}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n    <line x1="${cx - w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n    <line x1="${cx + w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n    <text x="${cx}" y="${y + h - 6}" text-anchor="middle" fill="${color}" font-size="${Math.min(fs, 11)}" font-family="${ff}">${this.esc(node.label)}</text>\n`; return el;
      }
      case 'cloud':
        el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="25" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="4,4"${op}${flt}/>\n`; break;
      case 'subroutine':
        el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n    <line x1="${x}" y1="${y + 8}" x2="${x + w}" y2="${y + 8}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n    <line x1="${x}" y1="${y + h - 8}" x2="${x + w}" y2="${y + h - 8}" stroke="${stroke}" stroke-width="${sw}"${flt}/>\n`; break;
      case 'stadium':
        el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n`; break;
      default:
        el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}${flt}/>\n`; break;
    }
    const label = this.esc(node.label || node.id);
    el += `    <text x="${cx}" y="${cy + fs * 0.35}" text-anchor="middle" fill="${color}" font-size="${fs}" font-family="${ff}">${label}</text>\n`;
    return el;
  }

  private renderEdge(edge: IREdge, pad: number, sketchy: boolean): string {
    const s = edge.style || {};
    const stroke = (s.stroke as string) || '#666';
    const sw = (s.strokeWidth as number) || 2;
    const dash = (s.strokeStyle as string) === 'dashed' ? ' stroke-dasharray="6,4"' : '';
    const flt = sketchy ? ' filter="url(#sketch)"' : '';
    const wps = edge.waypoints || [];
    if (wps.length < 2) return '';
    const pts = wps.map(p => `${p.x + pad},${p.y + pad}`).join(' ');
    let el = `    <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash}${flt}/>\n`;
    const last = wps[wps.length - 1], prev = wps[wps.length - 2];
    if (last && prev) {
      const dx = last.x - prev.x, dy = last.y - prev.y, len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const nx = dx / len, ny = dy / len, asz = 10, ax = last.x + pad, ay = last.y + pad;
        el += `    <polygon points="${ax - asz * (nx * 0.8 - ny * 0.4)},${ay - asz * (ny * 0.8 + nx * 0.4)} ${ax - asz * (nx * 0.8 + ny * 0.4)},${ay - asz * (ny * 0.8 - nx * 0.4)} ${ax},${ay}" fill="${stroke}" stroke="${stroke}" stroke-width="1"${flt}/>\n`;
      }
    }
    if (edge.label) {
      const mid = wps[Math.floor(wps.length / 2)];
      if (mid) el += `    <text x="${mid.x + pad}" y="${mid.y + pad - 8}" text-anchor="middle" fill="#555" font-size="12" font-family="Inter, sans-serif">${this.esc(edge.label)}</text>\n`;
    }
    return el;
  }

  private esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  compileSync(source: string, filePath?: string): Result<RenderResult> {
    const r1 = this.parse(source, filePath); if (!r1.ok) return r1;
    const r2 = this.analyze(r1.value); if (!r2.ok) return r2;
    const r3 = this.transform(r2.value); if (!r3.ok) return r3;
    const r4 = this.layout(r3.value); if (!r4.ok) return r4;
    return this.render(r4.value);
  }

  async compile(source: string, filePath?: string): Promise<Result<RenderResult>> {
    return this.compileSync(source, filePath);
  }

  validate(source: string, filePath?: string): Diagnostic[] {
    const r1 = this.parse(source, filePath); if (!r1.ok) return r1.errors;
    const r2 = this.analyze(r1.value); if (!r2.ok) return r2.errors;
    return [];
  }

  getSupportedDiagramTypes(): string[] { return this.plugins.registry.supportedTypes().map(t => t.toString()); }
  registerTheme(theme: Theme): void { this.themes.set(theme.id, theme); }
  getTheme(id: string): Theme | undefined { return this.themes.get(id); }
  listThemes(): Theme[] { return Array.from(this.themes.values()); }
}

export function createEngine(options?: EngineOptions): CoreEngine {
  return new SelDiAEngine(options);
}
