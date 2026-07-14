// =============================================================================
// SelDiA — Core Engine Interface & Implementation
// =============================================================================

import type { ID, Diagnostic, Result, Point, Rect } from './types/common.js';
import type { DiagramIR, LayoutResult, RenderResult, IRNode, IREdge } from './ir/types.js';
import { DiagramType, EdgeRouting } from './ir/types.js';
import type { DiagramAST } from './ast/nodes.js';
import type { DiagramPlugin, PluginManager } from './plugin/types.js';
import type { Theme } from './types/style.js';
import type { SelDiAConfig } from './config.js';
import { DiagnosticSeverity, Direction } from './types/common.js';
import { DEFAULT_CONFIG } from './config.js';
import { analyze } from './analyzer.js';
import { parseDSL } from './parser/index.js';
import { DefaultPluginManager } from './plugin-manager.js';
import { flowchartPlugin } from './diagrams/flowchart.js';
import { sequencePlugin } from './diagrams/sequence.js';
import { classPlugin } from './diagrams/class.js';
import { c4Plugin, c4ContainerPlugin, c4ComponentPlugin } from './diagrams/c4.js';
import { statePlugin } from './diagrams/state.js';
import { erPlugin } from './diagrams/er.js';
import { bpmnPlugin } from './diagrams/bpmn.js';
import { componentPlugin } from './diagrams/component.js';
import { usecasePlugin, activityPlugin, deploymentPlugin, ganttPlugin, mindmapPlugin, networkPlugin, chartPlugin, gitgraphPlugin, formPlugin, sankeyPlugin, blockPlugin, timelinePlugin, dmnPlugin } from './diagrams/misc.js';
import { BUILTIN_THEMES } from './themes.js';
import { layoutWithDagre, layoutWithElk, LAYOUT_ENGINES } from './layout/engines.js';
import { roughRect, roughEllipse, roughPolygon, roughLine, seedFor, type RoughStyle } from './render/rough.js';

// -----------------------------------------------------------------------------
// Core Engine Interface
// -----------------------------------------------------------------------------

export interface CoreEngine {
  readonly config: SelDiAConfig;
  readonly plugins: PluginManager;
  parse(source: string, filePath?: string): Result<DiagramAST>;
  analyze(ast: DiagramAST): Result<DiagramAST>;
  transform(ast: DiagramAST): Result<DiagramIR>;
  /** Synchronous layout. Always uses the "dagre" engine — the only auto-layout
   *  algorithm with a synchronous implementation. If the diagram requests
   *  "elk" via `layout elk`, this silently falls back to dagre; use
   *  `layoutAsync` to honor an elk request. */
  layout(ir: DiagramIR): Result<LayoutResult>;
  /** Async layout. Honors the diagram's requested engine ("dagre" or "elk"),
   *  defaulting to `config.defaultLayoutEngine`. */
  layoutAsync(ir: DiagramIR): Promise<Result<LayoutResult>>;
  render(layoutResult: LayoutResult): Result<RenderResult>;
  /** Synchronous full pipeline. Required by contexts that cannot await
   *  (e.g. VS Code's markdown-it fence renderer). Always lays out with
   *  "dagre" — see `layout()`. */
  compileSync(source: string, filePath?: string): Result<RenderResult>;
  /** Full pipeline, honoring the diagram's requested layout engine
   *  (including "elk", which requires async). */
  compile(source: string, filePath?: string): Promise<Result<RenderResult>>;
  validate(source: string, filePath?: string): Diagnostic[];
  getSupportedDiagramTypes(): string[];
  registerTheme(theme: Theme): void;
  getTheme(id: string): Theme | undefined;
  listThemes(): Theme[];
}

/** Per-diagram-type default fill/stroke, used when a plugin/node doesn't set
 *  its own style — keeps diagram types visually distinguishable across all
 *  themes instead of every type falling through to one hardcoded color
 *  (docs/improvement_request.md item 3). Individual plugins may still set
 *  their own defaults (e.g. bpmn.ts, misc.ts already do); this is the
 *  final fallback for types that don't. */
function defaultPaletteFor(type: DiagramType): { fill: string; stroke: string } {
  switch (type) {
    case DiagramType.CLASS: return { fill: '#eef2ff', stroke: '#3730a3' };
    case DiagramType.FLOWCHART: return { fill: '#eef2ff', stroke: '#4338ca' };
    case DiagramType.ER: return { fill: '#ecfeff', stroke: '#0e7490' };
    case DiagramType.STATE: return { fill: '#f0fdf4', stroke: '#15803d' };
    case DiagramType.SEQUENCE: return { fill: '#fdf4ff', stroke: '#86198f' };
    case DiagramType.BPMN: return { fill: '#f0fdf4', stroke: '#166534' };
    default: return { fill: '#e8f4f8', stroke: '#2c3e50' };
  }
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

    const builtins = [flowchartPlugin, sequencePlugin, classPlugin, c4Plugin, c4ContainerPlugin, c4ComponentPlugin, statePlugin, erPlugin, bpmnPlugin, componentPlugin, usecasePlugin, activityPlugin, deploymentPlugin, ganttPlugin, mindmapPlugin, networkPlugin, chartPlugin, gitgraphPlugin, formPlugin, sankeyPlugin, blockPlugin, timelinePlugin, dmnPlugin];
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
    try {
      const ir = plugin.transform(ast, this.config);
      const layoutDecl = ast.body.find((s): s is import('./ast/nodes.js').ASTLayoutDecl => s.kind === 'LayoutDecl');
      ir.metadata = { ...ir.metadata, layoutEngine: layoutDecl?.engine };
      return { ok: true, value: ir };
    }
    catch (err: any) { return { ok: false, errors: [{ severity: DiagnosticSeverity.ERROR, message: `Transform error: ${err.message}`, source: ast.loc, code: 'E0005' }] }; }
  }

  /** A node carries a manual position override when its style has a flat
   *  `{ x, y }` (or legacy nested `{ layout: { x, y } }`) — this is how the
   *  Markdown preview's drag-to-move writes positions back into the DSL. */
  private manualOverride(node: IRNode): Point | undefined {
    const style = (node.style || {}) as Record<string, any>;
    const manual = (style.layout && typeof style.layout === 'object') ? style.layout : style;
    const mx = manual?.x, my = manual?.y;
    return typeof mx === 'number' && typeof my === 'number' ? { x: mx, y: my } : undefined;
  }

  /** True if any node in the diagram has a manual position override — per
   *  the diagram-wide auto-layout model, this disables the auto-layout
   *  engine for every node until "Auto Layout" is triggered again (which
   *  clears all overrides). */
  private isManuallyLaidOut(ir: DiagramIR): boolean {
    return ir.nodes.some((n) => this.manualOverride(n) !== undefined);
  }

  /** Diagram-type spacing defaults (each plugin's `getDefaultLayoutOptions()`
   *  — previously defined but never consumed anywhere) are the base; the
   *  global `config.layout` values only override when the user explicitly
   *  set them, so a class diagram and a flowchart get different rank/node
   *  spacing out of the box (docs/improvement_request.md item 6). */
  private resolvedLayoutOptions(ir: DiagramIR) {
    const plugin = this.plugins.findHandler(ir.type);
    const typeDefaults = plugin?.getDefaultLayoutOptions?.() ?? {};
    const dirMap: Record<string, Direction> = {
      TB: Direction.TOP_TO_BOTTOM, LR: Direction.LEFT_TO_RIGHT, BT: Direction.BOTTOM_TO_TOP, RL: Direction.RIGHT_TO_LEFT,
    };
    return {
      direction: (typeDefaults.direction && dirMap[typeDefaults.direction]) || this.config.layout.direction || Direction.TOP_TO_BOTTOM,
      nodeSpacing: typeDefaults.nodeSpacing?.[0] ?? this.config.layout.nodeSpacing?.[0] ?? 80,
      rankSpacing: typeDefaults.rankSpacing ?? this.config.layout.rankSpacing ?? 80,
      edgeSpacing: this.config.layout.edgeSpacing ?? 20,
    };
  }

  layout(ir: DiagramIR): Result<LayoutResult> {
    if (this.isManuallyLaidOut(ir)) return this.layoutManual(ir);
    // Synchronous path only has dagre available; an "elk" request is honored
    // by layoutAsync() (used by compile()), not here.
    const { nodes, edges, bounds } = layoutWithDagre(ir, this.resolvedLayoutOptions(ir));
    const positioned: DiagramIR = { ...ir, nodes, edges };
    return { ok: true, value: { diagram: positioned, bounds, warnings: [] } };
  }

  async layoutAsync(ir: DiagramIR): Promise<Result<LayoutResult>> {
    if (this.isManuallyLaidOut(ir)) return this.layoutManual(ir);
    const requested = (ir.metadata?.layoutEngine as string | undefined) || this.config.defaultLayoutEngine;
    const opts = this.resolvedLayoutOptions(ir);
    const { nodes, edges, bounds } = requested === 'elk' && LAYOUT_ENGINES.has('elk')
      ? await layoutWithElk(ir, opts)
      : layoutWithDagre(ir, opts);
    const positioned: DiagramIR = { ...ir, nodes, edges };
    return { ok: true, value: { diagram: positioned, bounds, warnings: [] } };
  }

  /** Diagram-wide manual layout: pinned nodes (manual `{x,y}`) keep their
   *  exact position; every un-pinned node is still auto-arranged (via dagre,
   *  run on the whole graph for legible spacing/routing) rather than
   *  dropped to a naive fixed grid — a per-node "pinned" model with
   *  constrained layout (docs/improvement_request.md item 6, replacing the
   *  old `resolvePosition()` grid fallback). */
  private layoutManual(ir: DiagramIR): Result<LayoutResult> {
    const sized: DiagramIR = {
      ...ir,
      nodes: ir.nodes.map((n) => ({ ...n, size: n.size.width > 0 ? n.size : { width: 140, height: 60 } })),
    };
    const auto = layoutWithDagre(sized, this.resolvedLayoutOptions(sized));
    const autoById = new Map(auto.nodes.map((n) => [n.id, n]));

    // Anchor the auto-arranged cluster relative to the pinned nodes: shift
    // the whole auto layout so it doesn't start overlapping pinned space,
    // by offsetting it to sit below the lowest pinned node (if any).
    const pinned = sized.nodes.filter((n) => this.manualOverride(n) !== undefined);
    let offsetY = 0;
    if (pinned.length > 0 && auto.nodes.some((n) => this.manualOverride(n) === undefined)) {
      const pinnedMaxY = Math.max(...pinned.map((n) => this.manualOverride(n)!.y + n.size.height));
      const autoMinY = Math.min(
        ...auto.nodes.filter((n) => this.manualOverride(n) === undefined).map((n) => n.position.y)
      );
      offsetY = Math.max(0, pinnedMaxY + 60 - autoMinY);
    }

    const nodes = sized.nodes.map((n) => {
      const manual = this.manualOverride(n);
      if (manual) return { ...n, position: manual };
      const a = autoById.get(n.id);
      return a ? { ...n, position: { x: a.position.x, y: a.position.y + offsetY }, size: a.size } : { ...n, position: { x: 0, y: 0 } };
    });
    const edges = ir.edges.map((e) => ({ ...e, waypoints: this.computeWaypoints(e, nodes) }));
    const positioned: DiagramIR = { ...ir, nodes, edges };
    const bounds = this.computeBounds(nodes);
    return { ok: true, value: { diagram: positioned, bounds, warnings: [] } };
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
    const svg = this.renderToSvg(nodes, edges, layoutResult.bounds, layoutResult.diagram.type);
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

  private renderToSvg(nodes: IRNode[], edges: IREdge[], bounds: Rect, diagramType: DiagramType): string {
    // Padding must cover both the configured breathing room AND the extra
    // pixels Rough.js's roughness/multi-stroke wobble can push geometry
    // outward, plus the thickest stroke width in use, so nothing gets
    // clipped by the viewBox at any zoom level (see improvement_request.md
    // item 7).
    const sketchy = this.config.render.sketchy !== false;
    const maxStroke = Math.max(2, ...nodes.map((n) => (n.style?.strokeWidth as number) || 2));
    const displacement = sketchy ? 6 : 0;
    const pad = (this.config.render.padding || 20) + maxStroke + displacement;
    const bw = bounds.width + pad * 2, bh = bounds.height + pad * 2;
    const bg = this.config.render.background || '#ffffff';
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bw} ${bh}" width="${bw}" height="${bh}">\n`;
    svg += `  <rect width="${bw}" height="${bh}" fill="${bg}" rx="8"/>\n`;
    for (const e of edges) svg += `  <g class="seldia-edge" data-seldia-edge-id="${this.esc(e.id)}">\n${this.renderEdge(e, pad, sketchy)}  </g>\n`;
    for (const n of nodes) svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}">\n${this.renderNode(n, pad, sketchy, diagramType)}  </g>\n`;
    svg += '</svg>';
    return svg;
  }

  /** Render a (possibly multi-line, `\n`-separated) label as one `<text>`
   *  element with one `<tspan>` per line, each on its own `y` offset — SVG's
   *  `<text>` does not treat `\n` as a line break on its own (item 2). */
  private renderLabel(x: number, startY: number, lineHeight: number, fs: number, ff: string, color: string, label: string, anchor: 'middle' | 'start' = 'middle'): string {
    const lines = (label || '').split('\n');
    const tspans = lines.map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${this.esc(line)}</tspan>`).join('');
    return `    <text text-anchor="${anchor}" fill="${color}" font-size="${fs}" font-family="${ff}">${tspans}</text>\n`;
  }

  private renderNode(node: IRNode, pad: number, sketchy: boolean, diagramType: DiagramType): string {
    const kind = (node.data as any)?.kind as string | undefined;
    if (diagramType === DiagramType.CLASS && kind === 'note') return this.renderNoteNode(node, pad, sketchy);
    if (diagramType === DiagramType.CLASS && kind === 'class' && (node.data as any)?.compartments) {
      return this.renderClassNode(node, pad, sketchy);
    }

    const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
    const cx = x + w / 2, cy = y + h / 2;
    const s = node.style || {};
    const palette = defaultPaletteFor(diagramType);
    const fill = (s.fill as string) || palette.fill, stroke = (s.stroke as string) || palette.stroke;
    const sw = (s.strokeWidth as number) || 2, color = (s.textColor as string) || palette.stroke;
    const fs = (s.fontSize as number) || 14, ff = (s.fontFamily as string) || 'Inter, system-ui, sans-serif';
    const op = ' opacity="0.9"';
    const seed = seedFor(node.id);
    const roughStyle: RoughStyle = { stroke, strokeWidth: sw, fill, roughness: (s.roughness as number) ?? 1.2, fillStyle: (s.fillStyle as string) || 'hachure', seed };
    let el = '';
    switch (node.shape) {
      case 'diamond':
        el = sketchy
          ? roughPolygon([[cx, y], [x + w, cy], [cx, y + h], [x, cy]], roughStyle)
          : `    <polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
        break;
      case 'circle':
        el = sketchy
          ? roughEllipse(cx, cy, w, h, roughStyle)
          : `    <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
        break;
      case 'hexagon': {
        const pts: [number, number][] = [[cx, y], [x + w, y + h * 0.25], [x + w, y + h * 0.75], [cx, y + h], [x, y + h * 0.75], [x, y + h * 0.25]];
        el = sketchy ? roughPolygon(pts, roughStyle) : `    <polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
        break;
      }
      case 'parallelogram': {
        const pts: [number, number][] = [[x + 15, y], [x + w, y], [x + w - 15, y + h], [x, y + h]];
        el = sketchy ? roughPolygon(pts, roughStyle) : `    <polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
        break;
      }
      case 'cylinder': {
        const ry = 12;
        if (sketchy) {
          el = roughRect(x, y + ry, w, h - ry * 2, roughStyle);
          el += roughEllipse(cx, y + ry, w, ry * 2, roughStyle);
          el += roughEllipse(cx, y + h - ry, w, ry * 2, roughStyle);
        } else {
          el = `    <rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
          el += `    <ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>\n    <ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
        }
        break;
      }
      case 'actor': {
        const r = Math.min(w, h * 0.3) / 2;
        if (sketchy) {
          el = roughEllipse(cx, y + r + 4, r * 2, r * 2, { ...roughStyle, fill: 'none' });
          el += roughLine(cx, y + r * 2 + 8, cx, y + h * 0.6, roughStyle);
          el += roughLine(x + 10, y + h * 0.4, x + w - 10, y + h * 0.4, roughStyle);
          el += roughLine(cx - w * 0.3, y + h * 0.85, cx, y + h * 0.65, roughStyle);
          el += roughLine(cx + w * 0.3, y + h * 0.85, cx, y + h * 0.65, roughStyle);
        } else {
          el = `    <circle cx="${cx}" cy="${y + r + 4}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${cx}" y1="${y + r * 2 + 8}" x2="${cx}" y2="${y + h * 0.6}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${x + 10}" y1="${y + h * 0.4}" x2="${x + w - 10}" y2="${y + h * 0.4}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${cx - w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${cx + w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
        }
        el += this.renderLabel(cx, y + h - 6, Math.round(Math.min(fs, 11) * 1.2), Math.min(fs, 11), ff, color, node.label);
        return el;
      }
      case 'cloud':
        el = sketchy
          ? roughRect(x, y, w, h, { ...roughStyle, roughness: (roughStyle.roughness ?? 1.2) * 1.4 })
          : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="25" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="4,4"${op}/>\n`;
        break;
      case 'subroutine':
        if (sketchy) {
          el = roughRect(x, y, w, h, roughStyle);
          el += roughLine(x, y + 8, x + w, y + 8, roughStyle);
          el += roughLine(x, y + h - 8, x + w, y + h - 8, roughStyle);
        } else {
          el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n    <line x1="${x}" y1="${y + 8}" x2="${x + w}" y2="${y + 8}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${x}" y1="${y + h - 8}" x2="${x + w}" y2="${y + h - 8}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
        }
        break;
      case 'stadium':
        el = sketchy
          ? roughRect(x, y, w, h, roughStyle)
          : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
        break;
      default:
        el = sketchy
          ? roughRect(x, y, w, h, roughStyle)
          : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
        break;
    }
    const rawLabel = node.label || node.id;
    const lineHeight = Math.round(fs * 1.3);
    const lineCount = rawLabel.split('\n').length;
    const startY = cy - ((lineCount - 1) * lineHeight) / 2 + fs * 0.35;
    el += this.renderLabel(cx, startY, lineHeight, fs, ff, color, rawLabel);
    return el;
  }

  /** Distinct yellow annotation box for UML notes (reference image B) —
   *  no compartments, folded-corner styling, left-aligned text. */
  private renderNoteNode(node: IRNode, pad: number, sketchy: boolean): string {
    const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
    const s = node.style || {};
    const fill = (s.fill as string) || '#fef9c3', stroke = (s.stroke as string) || '#a16207';
    const sw = (s.strokeWidth as number) || 1.5, color = (s.textColor as string) || '#713f12';
    const fs = (s.fontSize as number) || 12, ff = (s.fontFamily as string) || 'Inter, system-ui, sans-serif';
    const fold = 12;
    let el: string;
    if (sketchy) {
      const style: RoughStyle = { stroke, strokeWidth: sw, fill, roughness: 1.2, fillStyle: 'hachure', seed: seedFor(node.id) };
      el = roughPolygon([[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h], [x, y + h]], style);
      el += roughLine(x + w - fold, y, x + w, y + fold, { stroke, strokeWidth: sw, seed: seedFor(node.id) });
    } else {
      el = `    <path d="M ${x} ${y} H ${x + w - fold} L ${x + w} ${y + fold} V ${y + h} H ${x} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
      el += `    <path d="M ${x + w - fold} ${y} V ${y + fold} H ${x + w}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>\n`;
    }
    const lineHeight = Math.round(fs * 1.3);
    const lines = node.label.split('\n');
    const startY = y + 16;
    el += `    <text text-anchor="start" fill="${color}" font-size="${fs}" font-family="${ff}" font-style="italic">${lines.map((l, i) => `<tspan x="${x + 10}" y="${startY + i * lineHeight}">${this.esc(l)}</tspan>`).join('')}</text>\n`;
    return el;
  }

  /** UML class box: name compartment (bold, centered, tinted header),
   *  divider, attributes compartment (left-aligned, visibility markers kept
   *  verbatim), divider, operations compartment — reference image B. */
  private renderClassNode(node: IRNode, pad: number, sketchy: boolean): string {
    const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
    const s = node.style || {};
    const fill = (s.fill as string) || '#eef2ff', stroke = (s.stroke as string) || '#3730a3';
    const sw = (s.strokeWidth as number) || 2, color = (s.textColor as string) || '#1e1b4b';
    const fs = (s.fontSize as number) || 14, ff = (s.fontFamily as string) || 'Inter, system-ui, sans-serif';
    const { name, attributes, operations } = (node.data as any).compartments as { name: string; attributes: string[]; operations: string[] };

    const lineHeight = Math.round((fs - 2) * 1.35);
    const nameHeight = fs + 18;
    const attrHeight = attributes.length > 0 ? attributes.length * lineHeight + 12 : 0;
    const opHeight = operations.length > 0 ? operations.length * lineHeight + 12 : 0;

    let el: string;
    if (sketchy) {
      el = roughRect(x, y, w, h, { stroke, strokeWidth: sw, fill, roughness: 1, fillStyle: 'hachure', seed: seedFor(node.id) });
    } else {
      el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
    }
    // Name compartment — tinted header, bold, centered.
    el += `    <rect x="${x}" y="${y}" width="${w}" height="${nameHeight}" rx="4" fill="${stroke}" opacity="0.15"/>\n`;
    el += `    <text x="${x + w / 2}" y="${y + nameHeight / 2 + fs * 0.35}" text-anchor="middle" font-weight="bold" fill="${color}" font-size="${fs}" font-family="${ff}">${this.esc(name)}</text>\n`;

    let cursorY = y + nameHeight;
    if (attrHeight > 0) {
      el += `    <line x1="${x}" y1="${cursorY}" x2="${x + w}" y2="${cursorY}" stroke="${stroke}" stroke-width="1"/>\n`;
      const startY = cursorY + lineHeight;
      el += `    <text text-anchor="start" fill="${color}" font-size="${fs - 2}" font-family="${ff}">${attributes.map((l, i) => `<tspan x="${x + 10}" y="${startY + i * lineHeight}">${this.esc(l)}</tspan>`).join('')}</text>\n`;
      cursorY += attrHeight;
    }
    if (opHeight > 0) {
      el += `    <line x1="${x}" y1="${cursorY}" x2="${x + w}" y2="${cursorY}" stroke="${stroke}" stroke-width="1"/>\n`;
      const startY = cursorY + lineHeight;
      el += `    <text text-anchor="start" fill="${color}" font-size="${fs - 2}" font-family="${ff}">${operations.map((l, i) => `<tspan x="${x + 10}" y="${startY + i * lineHeight}">${this.esc(l)}</tspan>`).join('')}</text>\n`;
    }
    return el;
  }

  /** Insert orthogonal (right-angle) bend points between waypoints when
   *  `routing === ORTHOGONAL` and the layout engine didn't already produce
   *  bends (dagre/elk both return their own bend points in some cases —
   *  only rewrite a straight 2-point run). Honoring `IREdge.routing` here
   *  (previously read nowhere) is item 3/6's edge-routing fix. */
  private routedWaypoints(edge: IREdge, wps: Point[]): Point[] {
    if (edge.routing !== EdgeRouting.ORTHOGONAL || wps.length !== 2) return wps;
    const [a, b] = wps;
    const midY = (a.y + b.y) / 2;
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }

  private renderEdge(edge: IREdge, pad: number, sketchy: boolean): string {
    const s = edge.style || {};
    const stroke = (s.stroke as string) || '#666';
    const sw = (s.strokeWidth as number) || 2;
    const dash = (s.strokeStyle as string) === 'dashed' ? [6, 4] : undefined;
    const rawWps = edge.waypoints || [];
    if (rawWps.length < 2) return '';
    const wps = this.routedWaypoints(edge, rawWps);
    let el: string;
    if (sketchy) {
      const seed = seedFor(edge.id);
      el = '';
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1];
        el += roughLine(a.x + pad, a.y + pad, b.x + pad, b.y + pad, { stroke, strokeWidth: sw, roughness: 1, seed: seed + i });
      }
    } else {
      const pts = wps.map(p => `${p.x + pad},${p.y + pad}`).join(' ');
      const dashAttr = dash ? ` stroke-dasharray="${dash.join(',')}"` : '';
      el = `    <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dashAttr}/>\n`;
    }

    const last = wps[wps.length - 1], prev = wps[wps.length - 2];
    if (last && prev) {
      const arrowType = ((edge.data as any)?.arrowType as string) || 'flow';
      el += this.renderArrowhead(arrowType, prev, last, pad, stroke);
    }
    if (edge.label) {
      const mid = wps[Math.floor((wps.length - 1) / 2)];
      const next = wps[Math.floor((wps.length - 1) / 2) + 1] || mid;
      if (mid) {
        const lx = (mid.x + next.x) / 2 + pad, ly = (mid.y + next.y) / 2 + pad;
        const labelText = edge.label;
        const chipW = Math.max(24, labelText.length * 6.5 + 12);
        // Small neutral background chip so the label stays readable where it
        // crosses the edge line (reference image C).
        el += `    <rect x="${lx - chipW / 2}" y="${ly - 15}" width="${chipW}" height="18" rx="4" fill="var(--seldia-label-bg, #ffffff)" fill-opacity="0.92" stroke="#d1d5db" stroke-width="1"/>\n`;
        el += `    <text x="${lx}" y="${ly - 2}" text-anchor="middle" fill="#374151" font-size="11" font-family="Inter, sans-serif">${this.esc(labelText)}</text>\n`;
      }
    }
    return el;
  }

  /** Draw one of the UML-conventional arrowhead types onto the last segment
   *  of `prev → last` (reference image B): filled triangle (flow, the
   *  historical default), hollow triangle (generalization/inheritance),
   *  open V (association), diamond (aggregation/composition). */
  private renderArrowhead(kind: string, prev: Point, last: Point, pad: number, stroke: string): string {
    const dx = last.x - prev.x, dy = last.y - prev.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return '';
    const nx = dx / len, ny = dy / len;
    const ax = last.x + pad, ay = last.y + pad;
    const asz = kind === 'generalization' ? 14 : 10;
    const p1x = ax - asz * (nx * 0.8 - ny * 0.4), p1y = ay - asz * (ny * 0.8 + nx * 0.4);
    const p2x = ax - asz * (nx * 0.8 + ny * 0.4), p2y = ay - asz * (ny * 0.8 - nx * 0.4);
    switch (kind) {
      case 'generalization':
        // Hollow triangle pointing at the superclass.
        return `    <polygon points="${p1x},${p1y} ${p2x},${p2y} ${ax},${ay}" fill="white" stroke="${stroke}" stroke-width="1.5"/>\n`;
      case 'association':
        // Open V — two lines, no fill.
        return `    <polyline points="${p1x},${p1y} ${ax},${ay} ${p2x},${p2y}" fill="none" stroke="${stroke}" stroke-width="1.5"/>\n`;
      case 'aggregation':
      case 'composition': {
        const midx = ax - asz * nx, midy = ay - asz * ny;
        const fill = kind === 'composition' ? stroke : 'white';
        return `    <polygon points="${ax},${ay} ${p1x},${p1y} ${midx},${midy} ${p2x},${p2y}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>\n`;
      }
      case 'dependency':
      case 'flow':
      default:
        return `    <polygon points="${p1x},${p1y} ${p2x},${p2y} ${ax},${ay}" fill="${stroke}" stroke="${stroke}" stroke-width="1"/>\n`;
    }
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
    const r1 = this.parse(source, filePath); if (!r1.ok) return r1;
    const r2 = this.analyze(r1.value); if (!r2.ok) return r2;
    const r3 = this.transform(r2.value); if (!r3.ok) return r3;
    const r4 = await this.layoutAsync(r3.value); if (!r4.ok) return r4;
    return this.render(r4.value);
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
