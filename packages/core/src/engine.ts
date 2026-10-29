// =============================================================================
// SelDiA — Core Engine Interface & Implementation

/** Graph-shaped types whose geometry is fully described by the IR, so the
 *  canvas can be trimmed to the content bounding box (left/top included). */
const TRIM_TYPES = new Set<DiagramType>([
  DiagramType.FLOWCHART, DiagramType.CLASS, DiagramType.STATE, DiagramType.ER, DiagramType.USECASE,
  DiagramType.ACTIVITY, DiagramType.COMPONENT, DiagramType.DEPLOYMENT, DiagramType.C4_CONTEXT,
  DiagramType.C4_CONTAINER, DiagramType.C4_COMPONENT, DiagramType.C4_CODE, DiagramType.BPMN,
  DiagramType.DMN, DiagramType.NETWORK, DiagramType.BLOCK, DiagramType.CLOUD, DiagramType.WORKITEM,
]);

/** Per-render edge drawing options (see renderEdge). */
interface EdgeStyle { clean: boolean; jumps: Map<string, Hop[]>; round: boolean; }
interface EdgeParts { path: string; head: string; label: string; }


// =============================================================================

import type { ID, Diagnostic, Result, Point, Rect } from './types/common.js';
import type { DiagramIR, LayoutResult, RenderResult, IRNode, IREdge, IRGroup } from './ir/types.js';
import { DiagramType, EdgeRouting } from './ir/types.js';
import type { DiagramAST } from './ast/nodes.js';
import type { DiagramPlugin, PluginManager, PluginDiagnostic } from './plugin/types.js';
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
import { workitemPlugin } from './diagrams/workitem.js';
import { floorplanPlugin } from './diagrams/floorplan.js';
import { pcbPlugin } from './diagrams/pcb.js';
import { tablePlugin } from './diagrams/table.js';
import { circuitPlugin } from './diagrams/circuit.js';
import { tJunctions } from './circuit/layout.js';
import { bpmnPlugin } from './diagrams/bpmn.js';
import { componentPlugin } from './diagrams/component.js';
import { usecasePlugin, activityPlugin, deploymentPlugin, ganttPlugin, mindmapPlugin, networkPlugin, chartPlugin, chartLinePlugin, chartPiePlugin, chartRadarPlugin, chartScatterPlugin, gitgraphPlugin, formPlugin, sankeyPlugin, blockPlugin, timelinePlugin, dmnPlugin, wireframePlugin, cloudPlugin } from './diagrams/misc.js';
import { BUILTIN_THEMES } from './themes.js';
import { fullScore, lexLess, swapNeighbours, sweepOrder } from './layout/refine.js';
import { layoutWithDagre, layoutWithElkSync, type AutoLayoutResult } from './layout/engines.js';
import { routeEdgePolyline, routeAllEdges, manualEdgeRoute, centerOf, computeFans, type Fan } from './render/edge-routing.js';
import { iconLabelLayout, balancedWrap, shapeTextBox } from './render/node-label-geometry.js';
import { chipRect, EDGE_LABEL_FONT, computeEdgeLabelPositions, type LabelPlacement } from './render/edge-label-placement.js';
import { textWidth } from './layout/text-measure.js';
import { postRoute, postRouteCircuit, edgePathD, arrowheadSvg, groupTitleBand, POST_ROUTE_TYPES, type Hop } from './render/edge-layer.js';
import { roughRect, roughEllipse, roughPolygon, roughLine, seedFor, type RoughStyle } from './render/rough.js';
import { DS, readableTextOn, typeSwatch, roleSwatch, seriesColor, setPaletteOverride, clearPaletteOverride, resolvePalette, type Swatch, type SemanticRole } from './render/design-system.js';
import { customLayoutFor } from './render/custom-layout.js';
import { escapeXml } from './render/escape.js';
import { renderFloorplanWalls, renderFloorplanFrame, renderFloorplanTitleBlock, renderFloorplanFloors, renderFloorplanDimensions, renderFloorplanMeasures, renderFloorplanScaleBar, renderFloorplanRoomLabels } from './render/floorplan-render.js';
import { expandIncludes } from './macro/include.js';
// Per-type NODE rendering now dispatches through each plugin's renderNode
// hook (see plugin/types.ts) — only whole-canvas grammars (charts, sankey,
// gantt/timeline axes, sequence fragments/messages) and per-type EDGE
// rendering remain imported here.
import {
  renderSequenceMessage, renderSequenceFragment,
  renderErRelationship,
  renderGanttDependency, renderGanttAxis,
  renderMindmapBranch,
  renderSankeyNode, renderSankeyRibbon, renderSankeyChip,
  renderGitLane,
  renderChartBar, renderChartPie, renderChartLinePoint, renderChartLegend,
  renderChartAxes, chartScale, chartPlot, chartLegendHeight, chartLegendMinWidth,
  extractChartSeriesNames,
  renderTimelineAxis,
  renderTimelineNode,
  renderGroup,
  computeGroupBounds,
} from './render/custom-renderers.js';

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
  /** Lay out and render an IR that was produced by something other than the
   *  SelDiA parser — an importer for a foreign format, or an agent that built
   *  the structure directly. This is the engine's front door for input that
   *  never was SelDiA DSL text; it is what makes "the engine that runs your
   *  Mermaid" a real seam rather than a translation hack. */
  compileIRSync(ir: DiagramIR): Result<RenderResult>;
  /** Full pipeline, honoring the diagram's requested layout engine
   *  (including "elk", which requires async). */
  compile(source: string, filePath?: string): Promise<Result<RenderResult>>;
  validate(source: string, filePath?: string): Diagnostic[];
  /** The diagram type plugin's own semantic checks (warnings that degrade
   *  at render time rather than failing the compile), with 1-based lines. */
  validateSemantics(ast: DiagramAST): PluginDiagnostic[];
  getSupportedDiagramTypes(): string[];
  registerTheme(theme: Theme): void;
  getTheme(id: string): Theme | undefined;
  listThemes(): Theme[];
}

/** Split a label into display lines on both real newlines and the literal
 *  two-character escape `\n` that authors type inside `[...]` node labels
 *  (the bracket tokenizer keeps it verbatim, so it never became a real
 *  newline). Without this the escape rendered as visible "\n" text. */
function splitLabelLines(label: string): string[] {
  return (label || '').replace(/\\n/g, '\n').split('\n');
}

/** Infer a diagram-type-independent semantic role for a node from its shape
 *  and plugin `data.kind`, so start/stop/decision/etc. get their conventional
 *  color in every diagram type. Returns undefined for ordinary nodes, which
 *  then fall back to the diagram type's signature accent. */
function roleFor(node: IRNode): SemanticRole | undefined {
  const kind = String((node.data as any)?.kind || '').toLowerCase();
  const shape = String(node.shape || '').toLowerCase();
  const id = String(node.id || '').toLowerCase();
  const label = String(node.label || '').toLowerCase();

  if (kind === 'note') return 'note';
  if (kind === 'start' || kind === 'initial' || /^start$|^begin$/.test(id) || /^start$|^begin$/.test(label)) return 'start';
  if (kind === 'end' || kind === 'stop' || kind === 'final' || kind === 'terminate' || /^end$|^stop$|^done$/.test(id) || /^end$|^stop$|^done$/.test(label)) return 'stop';
  if (kind === 'error' || kind === 'exception' || /error|fail|reject|invalid/.test(label)) return 'error';
  if (kind === 'decision' || kind === 'gateway' || shape === 'diamond') return 'decision';
  if (kind === 'actor' || kind === 'external' || kind === 'person' || shape === 'actor') return 'external';
  return undefined;
}

/** Resolve the final swatch for a node: an explicit author style wins, then a
 *  semantic role, then the diagram type's signature accent. This is what keeps
 *  every diagram in one document visually harmonious while still meaningful. */
function nodeSwatch(node: IRNode, type: DiagramType): Swatch {
  const base = roleFor(node) ? roleSwatch(roleFor(node)!) : typeSwatch(type);
  const s = (node.style || {}) as Record<string, any>;
  return {
    stroke: (s.stroke as string) || base.stroke,
    fill: (s.fill as string) || base.fill,
    text: (s.textColor as string) || (s.fill ? readableTextOn(s.fill as string, base.text) : base.text),
    accent: base.accent,
  };
}

/** Deep-partial version of SelDiAConfig for engine construction: callers
 *  routinely want to override just one theme/palette field without having to
 *  restate every other RenderConfig/LayoutConfig property (see the
 *  constructor's per-sub-config merge below, which relies on each of these
 *  being genuinely optional rather than "Partial<SelDiAConfig>"'s shallow
 *  optionality, which still demanded a complete nested object). */
type DeepPartialConfig = {
  [K in keyof SelDiAConfig]?: SelDiAConfig[K] extends object ? Partial<SelDiAConfig[K]> : SelDiAConfig[K];
};

export interface EngineOptions {
  config?: DeepPartialConfig;
  plugins?: DiagramPlugin[];
  themes?: Theme[];
}

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

/** Smallest y any mark in a rendered SVG reaches: y/y1/y2 attributes,
 *  circle tops, and the y of each M/L/C point pair in path data (arc
 *  parameters are skipped). An estimate for cropping, never for layout. */
function svgContentTop(svg: string): number {
  let min = Infinity;
  const body = svg.replace(/^<svg[^>]*>\s*<rect [^>]*\/>/, '');
  for (const m of body.matchAll(/\sy[12]?="(-?[\d.]+)"/g)) min = Math.min(min, Number(m[1]));
  for (const m of body.matchAll(/cy="(-?[\d.]+)"[^>]*?\sr="([\d.]+)"/g)) min = Math.min(min, Number(m[1]) - Number(m[2]));
  for (const m of body.matchAll(/\sd="([^"]+)"/g)) {
    for (const seg of m[1].matchAll(/([MLC])([^MLCAZmlcaz]*)/g)) {
      const nums = seg[2].match(/-?[\d.]+(?:e-?\d+)?/g) ?? [];
      for (let i = 1; i < nums.length; i += 2) min = Math.min(min, Number(nums[i]));
    }
  }
  return Number.isFinite(min) ? min : 0;
}

class SelDiAEngine implements CoreEngine {
  readonly config: SelDiAConfig;
  readonly plugins: PluginManager;
  private themes = new Map<string, Theme>();

  constructor(options?: EngineOptions) {
    // A shallow spread here would let a caller's partial `render: { theme }`
    // silently blow away the rest of DEFAULT_CONFIG.render (background,
    // sketchy, padding, ...) — merge each known sub-config one level deep so
    // "just set the theme" doesn't reset everything else back to defaults.
    this.config = {
      ...DEFAULT_CONFIG,
      ...options?.config,
      render: { ...DEFAULT_CONFIG.render, ...options?.config?.render },
      layout: { ...DEFAULT_CONFIG.layout, ...options?.config?.layout },
      parser: { ...DEFAULT_CONFIG.parser, ...options?.config?.parser },
      plugins: { ...DEFAULT_CONFIG.plugins, ...options?.config?.plugins },
      output: { ...DEFAULT_CONFIG.output, ...options?.config?.output },
      debug: { ...DEFAULT_CONFIG.debug, ...options?.config?.debug },
      layoutEngineByType: { ...DEFAULT_CONFIG.layoutEngineByType, ...options?.config?.layoutEngineByType },
    } as SelDiAConfig;
    this.plugins = new DefaultPluginManager();
    for (const theme of BUILTIN_THEMES) this.themes.set(theme.id, theme);
    if (options?.themes) for (const t of options.themes) this.themes.set(t.id, t);

    const builtins = [flowchartPlugin, sequencePlugin, classPlugin, c4Plugin, c4ContainerPlugin, c4ComponentPlugin, statePlugin, erPlugin, bpmnPlugin, componentPlugin, usecasePlugin, activityPlugin, deploymentPlugin, ganttPlugin, mindmapPlugin, networkPlugin, chartPlugin, chartLinePlugin, chartPiePlugin, chartRadarPlugin, chartScatterPlugin, gitgraphPlugin, formPlugin, sankeyPlugin, blockPlugin, timelinePlugin, dmnPlugin, wireframePlugin, cloudPlugin, workitemPlugin, floorplanPlugin, circuitPlugin, pcbPlugin, tablePlugin];
    for (const p of builtins) this.plugins.registry.register(p);
    if (options?.plugins) for (const p of options.plugins) this.plugins.registry.register(p);
  }

  parse(source: string, filePath?: string): Result<DiagramAST> {
    // Expand `include "file.sld"` directives on the raw text before the DSL
    // parser ever sees it — this is a pure preprocessor pass (see
    // macro/include.ts), not a parser/tokenizer change, so it's safe to run
    // unconditionally: a source with no include directives round-trips
    // through expandIncludes() unchanged. A missing/circular include is a
    // hard parse error (there's no `warnings` channel on a successful
    // Result<DiagramAST> to attach a soft warning to), reported at the top
    // of the source since the directive line itself was already stripped.
    const { source: expanded, diagnostics } = expandIncludes(source, filePath);
    if (diagnostics.length > 0) {
      return {
        ok: false,
        errors: diagnostics.map((message) => ({
          severity: DiagnosticSeverity.ERROR,
          message,
          source: { file: filePath ?? '', startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, offset: 0 },
          code: 'E-INCLUDE',
        })),
      };
    }
    return parseDSL(expanded, filePath);
  }

  analyze(ast: DiagramAST): Result<DiagramAST> {
    return analyze(ast);
  }

  /**
   * Run the handling plugin's own semantic checks over an AST.
   *
   * `DiagramPlugin.validate` was declared in the plugin interface but nothing
   * ever called it, so per-type semantics had no way to be enforced. It is
   * surfaced as its own method rather than folded into `analyze()` because
   * `Result<T>` has no warnings channel on the success path (the same
   * constraint the macro/include work hit) — and these findings must not fail
   * a compile: an incomplete specification is the normal state of a
   * specification, and refusing to draw one would make the tool useless
   * exactly when it is most needed.
   *
   * Returns [] for a type whose plugin declares no checks.
   */
  validateSemantics(ast: DiagramAST): PluginDiagnostic[] {
    const plugin = this.plugins.findHandler(ast.type);
    if (!plugin?.validate) return [];
    try { return plugin.validate(ast); }
    // A plugin check that throws must not take the whole compile with it.
    catch (err: any) { return [{ severity: 'warning', message: `Validation error: ${err?.message ?? err}` }]; }
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
      const edgeDecl = ast.body.find((s): s is import('./ast/nodes.js').ASTEdgeStyleDecl => s.kind === 'EdgeStyleDecl');
      ir.metadata = { ...ir.metadata, layoutEngine: layoutDecl?.engine, ...(edgeDecl ? { edgeStyle: edgeDecl.style } : {}) };
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
      direction: this.config.layout.forceDirection
        || (typeDefaults.direction && dirMap[typeDefaults.direction])
        || this.config.layout.direction
        || Direction.TOP_TO_BOTTOM,
      nodeSpacing: typeDefaults.nodeSpacing?.[0] ?? this.config.layout.nodeSpacing?.[0] ?? 80,
      rankSpacing: typeDefaults.rankSpacing ?? this.config.layout.rankSpacing ?? 80,
      edgeSpacing: this.config.layout.edgeSpacing ?? 20,
    };
  }

  /** Groups have no independent layout of their own — they're a bounding box
   *  drawn around wherever their member nodes ended up, computed once after
   *  node positions are final. Every layout path (dagre, elk, custom, manual)
   *  must run this before returning, or a group's position/size stay at the
   *  zero-value the parser left them with. */
  private layoutGroups(ir: DiagramIR, nodes: IRNode[], engineBounds?: Map<string, Rect>): IRGroup[] {
    if (!ir.groups.length) return ir.groups;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    return ir.groups.map((g) => {
      // A layout engine that laid out compound nodes (ELK) owns the box: its
      // padding and header band already account for the contents.
      const eb = engineBounds?.get(g.id);
      if (eb) return { ...g, position: { x: eb.x, y: eb.y }, size: { width: eb.width, height: eb.height } };
      const { x, y, width, height } = computeGroupBounds(g, ir.groups, nodeById);
      return { ...g, position: { x, y }, size: { width, height } };
    });
  }

  /** Overlay any `via`-pinned edge's route (Step 4.2) onto already-laid-out
   *  edges, snapping the pinned points' endpoints to the (possibly
   *  auto-placed) nodes' current centres. Applied after every layout path —
   *  dagre, elk, custom, and manual — so a `via` edge keeps its bend even
   *  when nothing else in the diagram is manually positioned. */
  private applyManualEdgeRoutes(edges: IREdge[], nodes: IRNode[]): IREdge[] {
    if (!edges.some((e) => this.manualEdgeRoute(e) !== undefined)) return edges;
    return edges.map((e) => {
      const manual = this.manualEdgeRoute(e);
      if (!manual) return e;
      const wps = this.computeWaypoints(e, nodes);
      return wps.length ? { ...e, waypoints: wps } : e;
    });
  }

  layout(ir: DiagramIR): Result<LayoutResult> {
    if (this.isManuallyLaidOut(ir)) return this.layoutManual(ir);
    // Some diagram types have a topology dagre cannot express (sequence
    // lifelines, gantt time axis, radial mindmap, sankey flow columns,
    // gitgraph lanes) — those bypass dagre entirely via a dedicated layout
    // function. Everything else (flowchart-shaped types) still uses dagre.
    const custom = customLayoutFor(ir.type);
    if (custom) {
      const { nodes, edges, bounds, metadataPatch, warnings: customWarnings } = custom(ir);
      const positioned: DiagramIR = {
        ...ir, nodes, edges: this.applyManualEdgeRoutes(edges, nodes), groups: this.layoutGroups(ir, nodes),
        metadata: metadataPatch ? { ...ir.metadata, ...metadataPatch } : ir.metadata,
      };
      return { ok: true, value: { diagram: positioned, bounds, warnings: (customWarnings ?? []).map((message) => ({ message })) } };
    }
    const { nodes, edges, bounds, groupBounds } = this.autoLayout(ir);
    const positioned: DiagramIR = { ...ir, nodes, edges: this.applyManualEdgeRoutes(edges, nodes), groups: this.layoutGroups(ir, nodes, groupBounds) };
    return { ok: true, value: { diagram: positioned, bounds, warnings: [] } };
  }

  /** The engine an auto-laid-out diagram asks for: its own `layout …` line,
   *  then the per-type config map, then the global default. */
  private requestedEngine(ir: DiagramIR): 'dagre' | 'elk' | 'auto' {
    const explicit = ir.metadata?.layoutEngine as string | undefined;
    const r = explicit
      || (this.config.defaultLayoutEngine === 'elk' ? 'elk' : undefined) // explicit global opt-in wins over the per-type map
      || this.config.layoutEngineByType?.[ir.type]
      || this.config.defaultLayoutEngine;
    if (r === 'elk') return 'elk';
    // Grouped diagrams go to ELK under `auto` too (same rule as dagre below).
    // Dagre's group clusters are never compared: grouped = elk, or dagre when elkWhenGrouped is off.
    if (r === 'auto' && ir.groups?.some((g) => g.childNodeIds.length > 0)) return this.config.elkWhenGrouped && !explicit ? 'elk' : 'dagre';
    if (r === 'auto') return 'auto';
    // Dagre here came only from the per-type default: grouped diagrams go to ELK
    // (dagre's compound clusters overlap; ELK keeps them apart).
    if (!explicit && this.config.elkWhenGrouped && ir.groups?.some((g) => g.childNodeIds.length > 0)) return 'elk';
    return 'dagre';
  }

  /** Auto layout with the requested engine; ELK failure degrades to dagre. */
  private autoLayout(ir: DiagramIR): AutoLayoutResult {
    const opts = this.resolvedLayoutOptions(ir);
    const requested = this.requestedEngine(ir);
    if (requested === 'auto') return this.autoPick(ir, opts);
    if (requested === 'elk') {
      try { return layoutWithElkSync(ir, opts); }
      catch { /* fall through to dagre */ }
    }
    return layoutWithDagre(ir, opts);
  }

  /** `auto`: lay out with a few dagre and ELK variants, keep the one whose
   *  measured layout scores lowest (gated defects, crossings, bends, rank-skip
   *  penalty, routed length). Ties go to the earlier variant (dagre default
   *  first), so existing diagrams stay stable. Small diagrams try four variants
   *  and then a neighbour-swap pass; medium ones (<= `autoMaxNodes` nodes and
   *  `autoMaxEdges` edges) one dagre and one ELK; larger ones use ELK alone
   *  (dagre's ordering is superlinear on dense graphs). */
  private autoPick(ir: DiagramIR, opts: ReturnType<SelDiAEngine['resolvedLayoutOptions']>): AutoLayoutResult {
    const c = this.config;
    if (ir.edges.length < 2) return layoutWithDagre(ir, opts);
    const big = ir.nodes.length > c.autoMaxNodes || ir.edges.length > c.autoMaxEdges;
    if (big) {
      try { return layoutWithElkSync(ir, { ...opts, elkThoroughness: 3 }); } catch { return layoutWithDagre(ir, opts); }
    }
    const small = ir.nodes.length <= c.autoVariantMaxNodes && ir.edges.length <= c.autoVariantMaxEdges;
    const runs: Array<() => AutoLayoutResult> = [() => layoutWithDagre(ir, opts)];
    if (small) runs.push(() => layoutWithDagre(ir, { ...opts, ranker: 'longest-path' }));
    runs.push(() => layoutWithElkSync(ir, opts));
    // Cost grows with edges (each variant is routed and measured, and so is each swap
    // try): dense small graphs skip the extra variants and get a smaller swap budget.
    const sparse = ir.edges.length <= 36;
    if (small) runs.push(() => layoutWithElkSync(ir, { ...opts, elkPlacement: 'NETWORK_SIMPLEX' }));
    if (small && sparse) {
      runs.push(() => layoutWithDagre(ir, { ...opts, ranker: 'tight-tree' }));
      runs.push(() => layoutWithElkSync(ir, { ...opts, elkExtra: { 'elk.layered.considerModelOrder.strategy': 'NONE', 'elk.layered.layering.strategy': 'LONGEST_PATH_SOURCE' } }));
      if (ir.nodes.length <= 16) runs.push(() => layoutWithElkSync(ir, { ...opts, elkThoroughness: 20, elkExtra: { 'elk.layered.considerModelOrder.strategy': 'NONE', 'elk.layered.crossingMinimization.semiInteractive': 'true' } }));
    }
    const vertical = opts.direction === Direction.TOP_TO_BOTTOM || opts.direction === Direction.BOTTOM_TO_TOP;
    const score = (r: AutoLayoutResult) => fullScore({ ...ir, nodes: r.nodes, edges: r.edges, groups: [] }, vertical);
    const cands: Array<{ r: AutoLayoutResult; sc: number[] }> = [];
    for (const run of runs) {
      let r: AutoLayoutResult;
      try { r = run(); } catch { continue; }
      cands.push({ r, sc: score(r) });
    }
    if (!cands.length) return layoutWithDagre(ir, opts);
    const refine = (r: AutoLayoutResult) => (small && !ir.groups?.length ? swapNeighbours(ir, sweepOrder(ir, r, vertical), vertical, Math.min(60, Math.floor(900 / ir.edges.length))) : r);
    // Stable sort: ties keep the earlier variant.
    const ranked = cands.map((x, i) => ({ ...x, i }))
      .sort((a, b) => (lexLess(a.sc, b.sc) ? -1 : lexLess(b.sc, a.sc) ? 1 : a.i - b.i));
    let best: AutoLayoutResult | undefined, bestScore: number[] = [];
    for (const x of ranked.slice(0, small && ir.nodes.length <= 16 && ir.edges.length <= 24 ? 3 : 1)) {
      const r = refine(x.r);
      const sc = r === x.r ? x.sc : score(r);
      if (!best || lexLess(sc, bestScore)) { best = r; bestScore = sc; }
    }
    if (!best) best = cands[0].r;
    return best;
  }

  async layoutAsync(ir: DiagramIR): Promise<Result<LayoutResult>> {
    return this.layout(ir);
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
    const auto = this.autoLayout(sized);
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
    const groups = this.layoutGroups(ir, nodes);
    const positioned: DiagramIR = { ...ir, nodes, edges, groups };
    const bounds = this.computeBounds(nodes, edges, groups);
    return { ok: true, value: { diagram: positioned, bounds, warnings: [] } };
  }

  /** A user-pinned route: the flat `[x1,y1,x2,y2,...]` list from the DSL's
   *  `via:` edge attribute (next_steps.md Step 4.2), read the same way
   *  `manualOverride` reads a node's `{x,y}` — as a style field that wins
   *  over anything layout would otherwise compute. Odd-length or empty
   *  arrays are treated as absent rather than guessed at. */
  private manualEdgeRoute(edge: IREdge): Point[] | undefined {
    return manualEdgeRoute(edge);
  }

  /** Centre-to-centre; renderEdge clips it back to both node borders. Anchoring
   *  here (the old code always left the source's bottom and entered the
   *  target's top) is wrong whenever a node is dragged beside or above its
   *  neighbour — which is exactly what this manual-position path is for.
   *  A `via`-pinned edge (Step 4.2) skips this entirely and keeps its own
   *  points, endpoints snapped to the (possibly re-laid-out) node centres so
   *  it still tracks a dragged node's new position. */
  private computeWaypoints(edge: IREdge, nodes: IRNode[]): Point[] {
    const src = nodes.find(n => n.id === edge.sourceId);
    const tgt = nodes.find(n => n.id === edge.targetId);
    if (!src || !tgt) return [];
    const manual = this.manualEdgeRoute(edge);
    if (manual) return [centerOf(src), ...manual, centerOf(tgt)];
    return [centerOf(src), centerOf(tgt)];
  }

  private computeBounds(nodes: IRNode[], edges?: IREdge[], groups?: IRGroup[]): Rect {
    if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + n.size.width); maxY = Math.max(maxY, n.position.y + n.size.height);
      // Icon nodes draw their label beside/above the glyph, outside the node box.
      const lb = iconLabelLayout(n)?.box;
      if (lb) {
        minX = Math.min(minX, lb.x); minY = Math.min(minY, lb.y);
        maxX = Math.max(maxX, lb.x + lb.width); maxY = Math.max(maxY, lb.y + lb.height);
      }
    }
    // Also include edge waypoints so routed edges that extend beyond node
    // boundaries (obstacle avoidance, fanned anchors) are not clipped by
    // the SVG viewBox.
    if (edges) {
      for (const e of edges) {
        if (!e.waypoints) continue;
        for (const p of e.waypoints) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
      }
    }
    // Group boxes extend past their member nodes by the group's own padding
    // plus a header band, so without this a group's border/label can be
    // clipped by a viewBox sized only to the tightest node bounds.
    if (groups) {
      for (const g of groups) {
        if (g.size.width <= 0 || g.size.height <= 0) continue;
        minX = Math.min(minX, g.position.x); minY = Math.min(minY, g.position.y);
        maxX = Math.max(maxX, g.position.x + g.size.width); maxY = Math.max(maxY, g.position.y + g.size.height);
      }
    }
    return { x: minX, y: minY, width: maxX - minX + 20, height: maxY - minY + 20 };
  }

  render(layoutResult: LayoutResult): Result<RenderResult> {
    const chartIR = layoutResult.diagram.metadata?.tableChart as DiagramIR | undefined;
    if (chartIR && (layoutResult.diagram.type as string) === 'table') return this.renderTableWithChart(layoutResult, chartIR);
    const nodes = layoutResult.diagram.nodes;
    const edges = layoutResult.diagram.edges;
    const groups = layoutResult.diagram.groups;
    // Recompute bounds to include edge waypoints (the manhattan router may
    // route waypoints beyond the initial node-only bounds when detouring
    // around obstacles, and the initial dagre/elk waypoints may also extend
    // beyond node boundaries). Then union with the layout stage's own bounds:
    // custom layouts (gantt, sankey, gitgraph, sequence…) size their canvas
    // to content the node list alone can't see — the gantt row-label column
    // and time axis, sankey node captions, gitgraph lane labels — all placed
    // in absolute coordinates from origin 0. The node-only recompute anchored
    // at minX used to shrink the width by that left offset, clipping the
    // right edge of exactly those diagram types.
    const recomputed = this.computeBounds(nodes, edges, groups);
    const lb = layoutResult.bounds;
    // A table's layout bounds are exact (cells tile the grid with no stroke
    // overhang); the generic recompute's +20 slack would leave a lopsided
    // right/bottom margin around it.
    const finalBounds: Rect = (layoutResult.diagram.type as string) === 'table' ? { x: 0, y: 0, width: lb.width, height: lb.height } : {
      x: 0, y: 0,
      width: Math.max(recomputed.x + recomputed.width, lb.x + lb.width),
      height: Math.max(recomputed.y + recomputed.height, lb.y + lb.height),
    };
    // A theme/palette override (config.render.theme / config.render.palette)
    // is applied only around this one render call and cleared in `finally`,
    // so it can never leak into a concurrent/later compile of a different
    // diagram — see render/design-system.ts for why this is a module-level
    // slot rather than a threaded parameter.
    const override = resolvePalette(this.config.render.palette ?? this.config.render.theme);
    setPaletteOverride(override);
    try {
      const fragmentBoxes = (layoutResult.diagram.metadata?.sequenceFragmentBoxes as any[]) ?? [];
      const svg = this.renderToSvg(nodes, edges, finalBounds, layoutResult.diagram.type, groups, fragmentBoxes, layoutResult.diagram.metadata);
      return {
        ok: true,
        value: {
          svg,
          diagramType: layoutResult.diagram.type,
          width: finalBounds.width,
          height: finalBounds.height,
          stats: { nodeCount: nodes.length, edgeCount: edges.length, groupCount: layoutResult.diagram.groups.length, renderTimeMs: 0 },
        },
      };
    } catch (err: any) {
      // A renderer (plugin renderNode hook, or a custom whole-canvas grammar)
      // threw on malformed IR. Report it as a normal pipeline error so hosts get
      // an error box for this one diagram instead of an exception that takes down
      // the surrounding document render.
      return {
        ok: false,
        errors: [{
          severity: DiagnosticSeverity.ERROR,
          message: `Render error: ${err?.message ?? err}`,
          source: { file: '', startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, offset: 0 },
          code: 'E0006',
        }],
      };
    } finally {
      clearPaletteOverride();
    }
  }

  /** A table carrying a chart (table IR → chart IR, built in transform):
   *  the chart goes through the normal chart layout + render, then the two
   *  SVGs are stacked as nested <svg>s — table on top, chart below — or the
   *  chart stands alone for `only`. Each part renders under its own palette
   *  scope, so nothing here runs inside an override. */
  private renderTableWithChart(layoutResult: LayoutResult, chartIR: DiagramIR): Result<RenderResult> {
    const chart = this.compileIRSync(chartIR);
    if (!chart.ok) return chart;
    const meta = { ...layoutResult.diagram.metadata };
    delete meta.tableChart;
    if (meta.tableChartOnly) return { ok: true, value: { ...chart.value, diagramType: layoutResult.diagram.type } };
    const table = this.render({ ...layoutResult, diagram: { ...layoutResult.diagram, metadata: meta } });
    if (!table.ok) return table;
    const size = (svg: string) => {
      const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
      return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 0, h: 0 };
    };
    const t = size(table.value.svg), c = size(chart.value.svg);
    // The chart's own layout pads its top for a title it doesn't draw here;
    // crop its viewBox to just above the topmost mark so the table→chart gap
    // is the table's bottom padding plus GAP, not a third of the table.
    const GAP = 10;
    const top = Math.max(0, Math.min(c.h, svgContentTop(chart.value.svg)) - 12);
    const ch = c.h - top;
    const w = Math.max(t.w, c.w), h = t.h + GAP + ch;
    const bg = /<rect [^>]*fill="([^"]+)"/.exec(table.value.svg)?.[1] ?? '#ffffff';
    // Nested parts keep their markup but not the root class (host CSS sizes
    // `.seldia-diagram-svg-el`; only the outer root should get that) nor
    // their full-size rounded background — the outer one alone paints it.
    const part = (svg: string, x: number, y: number, vb: string, ph: number) => svg
      .replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="seldia-diagram-svg-el[^>]*>/,
        `<svg x="${x}" y="${y}" width="${vb.split(' ')[2]}" height="${ph}" viewBox="${vb}" class="seldia-diagram-part">`)
      .replace(/\n\s*<rect width="[\d.]+" height="[\d.]+" fill="[^"]*" rx="[\d.]+"\/>/, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="seldia-diagram-svg-el" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`
      + `  <rect width="${w}" height="${h}" fill="${bg}" rx="${DS.radius}"/>\n`
      + part(table.value.svg, (w - t.w) / 2, 0, `0 0 ${t.w} ${t.h}`, t.h) + '\n'
      + part(chart.value.svg, (w - c.w) / 2, t.h + GAP, `0 ${top} ${c.w} ${ch}`, ch) + '\n</svg>';
    return {
      ok: true,
      value: {
        ...table.value, svg, width: w, height: h,
        stats: { ...table.value.stats, nodeCount: table.value.stats.nodeCount + chart.value.stats.nodeCount },
      },
    };
  }

  private renderToSvg(nodes: IRNode[], edges: IREdge[], bounds: Rect, diagramType: DiagramType, groups: IRGroup[] = [], fragmentBoxes: any[] = [], metadata?: Record<string, unknown>): string {
    // Padding must cover both the configured breathing room AND the extra
    // pixels Rough.js's roughness/multi-stroke wobble can push geometry
    // outward, plus the thickest stroke width in use, so nothing gets
    // clipped by the viewBox at any zoom level (see improvement_request.md
    // item 7).
    const sketchy = this.config.render.sketchy !== false && !['circuit', 'pcb', 'table'].includes(diagramType as string);
    const maxStroke = Math.max(2, ...nodes.map((n) => (n.style?.strokeWidth as number) || 2));
    const displacement = sketchy ? 6 : 0;
    const pad = (this.config.render.padding || 20) + maxStroke + displacement;
    const isChart = diagramType === DiagramType.CHART_BAR || diagramType === DiagramType.CHART_LINE
      || diagramType === DiagramType.CHART_RADAR || diagramType === DiagramType.CHART_SCATTER || diagramType === DiagramType.CHART_PIE;
    // Multi-series charts need a legend (name → colour) or the bars/lines are
    // only distinguishable by memorising seriesColor()'s palette order. Pie
    // slices already carry their own inline category labels, so they're
    // excluded even though they're chart-shaped.
    //
    // The canvas is sized to the legend rather than the legend being crammed
    // into the canvas: widen it if a single entry wouldn't fit, then measure
    // the height the wrapped rows actually need. A fixed strip clipped every
    // legend that ran to a second row.
    const chartSeriesNames = isChart && diagramType !== DiagramType.CHART_PIE ? extractChartSeriesNames(nodes) : [];
    const bw = Math.max(bounds.width + pad * 2, chartLegendMinWidth(chartSeriesNames));
    const legendH = chartLegendHeight(chartSeriesNames, bw);
    const bh = bounds.height + pad * 2 + legendH;
    // An explicit config.render.background always wins; otherwise fall back
    // to the active palette's background (if any), then plain white. The
    // DEFAULT_CONFIG value is 'transparent', which we don't want to treat as
    // "explicitly set" — it's the un-set default, so an active theme's
    // background should still apply on top of it.
    const paletteBg = resolvePalette(this.config.render.palette ?? this.config.render.theme)?.background;
    const explicitBg = this.config.render.background;
    const bg = (explicitBg && explicitBg !== 'transparent') ? explicitBg : (paletteBg || explicitBg || '#ffffff');
    // Gantt and chart diagrams are left-aligned (their content starts from the
    // left edge — task labels, y-axis); everything else looks better centered.
    const par = (diagramType === DiagramType.GANTT || diagramType === DiagramType.CHART_BAR || diagramType === DiagramType.CHART_LINE || diagramType === DiagramType.CHART_PIE || diagramType === DiagramType.CHART_RADAR || diagramType === DiagramType.CHART_SCATTER)
      ? 'xMinYMin meet' : 'xMidYMid meet';
    // Gantt and Sankey diagrams are inherently wide — a time axis or flow
    // ribbon needs its full pixel budget to be readable.  The seldia-wide
    // class lifts the CSS max-width:100% so the SVG renders at its natural
    // width, triggering overflow:auto scrollbars + grab-to-pan. Timeline was
    // in this list too, but a handful of event boxes doesn't need the full
    // pixel budget — it just rendered oversized relative to its neighbours.
    const wideTypes: DiagramType[] = [DiagramType.GANTT, DiagramType.SANKEY];
    const wideClass = wideTypes.includes(diagramType) ? ' seldia-wide' : '';
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" class="seldia-diagram-svg-el${wideClass}" viewBox="0 0 ${bw} ${bh}" width="${bw}" height="${bh}" preserveAspectRatio="${par}">\n`;
    svg += `  <rect width="${bw}" height="${bh}" fill="${bg}" rx="${DS.radius}"/>\n`;
    const headerEnd = svg.length;
    const typeAccent = typeSwatch(diagramType);

    // Pie charts are one shape drawn from every node's data at once, not one
    // shape per node — special-cased here, still wrapping each node in its
    // identity <g> so data-seldia-node-id contracts hold.
    if (diagramType === DiagramType.CHART_PIE) {
      svg += `  <g class="seldia-chart-pie">\n${renderChartPie(nodes, pad, sketchy, bounds)}  </g>\n`;
      for (const n of nodes) svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}"></g>\n`;
      svg += '</svg>';
      return svg;
    }

    if (diagramType === DiagramType.CHART_BAR || diagramType === DiagramType.CHART_LINE || diagramType === DiagramType.CHART_RADAR || diagramType === DiagramType.CHART_SCATTER) {
      const seriesNames = extractChartSeriesNames(nodes);
      const scale = chartScale(nodes);
      const chartMax = scale.max;
      const plot = chartPlot(nodes, pad);
      // Axes first: gridlines are backdrop and must sit under the data.
      svg += renderChartAxes(nodes, pad, scale);
      for (const e of edges) svg += `  <g class="seldia-edge" data-seldia-edge-id="${this.esc(e.id)}"></g>\n`;
      if (diagramType === DiagramType.CHART_LINE || diagramType === DiagramType.CHART_SCATTER) {
        // One polyline (or a bare point cloud for scatter) per series, plotted
        // through each category's point for that series — distinct from the
        // bar chart's per-category grouped columns.
        const dotOnly = diagramType === DiagramType.CHART_SCATTER;
        seriesNames.forEach((_name, si) => {
          const color = seriesColor(si);
          const pts = nodes.map((n) => renderChartLinePoint(n, pad, chartMax, si));
          if (!dotOnly) {
            const line = pts.map((p) => `${p.x},${p.y}`).join(' ');
            svg += `  <polyline points="${line}" fill="none" stroke="${color}" stroke-width="${DS.stroke.emphasis}"/>\n`;
          }
          for (const p of pts) svg += `  <circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}"/>\n`;
        });
        // Category labels sit just under the x axis. They used to be pinned to
        // the bottom of the canvas, which stranded them ~100px below the plot.
        const catY = (plot ? plot.bottom : bounds.height + pad) + 20;
        for (const n of nodes) {
          const p = renderChartLinePoint(n, pad, chartMax);
          svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}"><text x="${p.x}" y="${catY}" text-anchor="middle" fill="${DS.neutral.text}" font-size="${DS.fontSize.meta}" font-family="${DS.fontFamily}">${this.esc(p.category)}</text></g>\n`;
        }
      } else {
        for (const n of nodes) svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}">\n${renderChartBar(n, pad, sketchy, chartMax, seriesNames)}  </g>\n`;
      }
      if (legendH > 0) svg += renderChartLegend(chartSeriesNames, bw, bounds.height + pad * 2);
      svg += '</svg>';
      return svg;
    }

    if (diagramType === DiagramType.SANKEY) {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      for (const e of edges) {
        const src = byId.get(e.sourceId), tgt = byId.get(e.targetId);
        const weight = ((e.data as any)?.sankeyWeight as number) ?? 1;
        const maxWeight = Math.max(1, ...edges.map((e2) => ((e2.data as any)?.sankeyWeight as number) ?? 1));
        const content = src && tgt ? renderSankeyRibbon(e, pad, src, tgt, weight, maxWeight, typeAccent.stroke) : '';
        svg += `  <g class="seldia-edge" data-seldia-edge-id="${this.esc(e.id)}">\n${content}  </g>\n`;
      }
      for (const n of nodes) svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}">\n${renderSankeyNode(n, pad, sketchy, nodeSwatch(n, diagramType))}  </g>\n`;
      for (const e of edges) { const src = byId.get(e.sourceId), tgt = byId.get(e.targetId); if (src && tgt) svg += renderSankeyChip(e, pad, src, tgt); }
      svg += '</svg>';
      return svg;
    }

    if (diagramType === DiagramType.GANTT) {
      svg += `  <g class="seldia-gantt-axis">\n${renderGanttAxis(nodes, pad, bounds)}  </g>\n`;
    }

    if (diagramType === DiagramType.TIMELINE) {
      svg += `  <g class="seldia-timeline-axis">\n${renderTimelineAxis(nodes, pad, bounds, typeAccent.stroke)}  </g>\n`;
      const midY = bounds.height / 2 + pad;
      for (const e of edges) svg += `  <g class="seldia-edge" data-seldia-edge-id="${this.esc(e.id)}"></g>\n`;
      for (const n of nodes) svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}">\n${renderTimelineNode(n, pad, sketchy, nodeSwatch(n, diagramType), midY)}  </g>\n`;
      svg += '</svg>';
      return svg;
    }

    // Floorplan: a precise technical drawing, not a graph — no edges, no
    // Rough.js. Frame chrome first (background), then derived walls/openings,
    // then room/furniture symbols, then the title-block stamp on top.
    if (diagramType === DiagramType.FLOORPLAN) {
      const walls = (metadata?.floorplanWalls as any[]) ?? [];
      const openings = (metadata?.floorplanOpenings as any[]) ?? [];
      const dims = (metadata?.floorplanDimensions as any[]) ?? [];
      const measures = (metadata?.floorplanMeasures as any[]) ?? [];
      const fpScale = (metadata?.floorplanScale as number) ?? 60;
      const kindOf = (n: IRNode) => String((n.data as any)?.fpKind || '');
      const roomNodes = nodes.filter((n) => kindOf(n) === 'room');
      const furnNodes = nodes.filter((n) => kindOf(n) === 'furniture');

      svg += renderFloorplanFrame(bw, bh);
      // Painter's order, bottom to top: floor tint, then rugs (which lie under
      // the furniture standing on them), then walls, then the furniture, then
      // all text. Room names go last of the plan content so no symbol can be
      // drawn over a label — the overlap the old single-pass loop allowed.
      svg += renderFloorplanFloors(roomNodes);
      // Floor heating is a zone fill like a rug — it must sit under whatever
      // furniture stands on that part of the floor, not on top of it.
      const isRug = (n: IRNode) => {
        const sym = String((n.data as any)?.symbol || '');
        return sym === 'carpet' || sym === 'floor-heating';
      };
      // data-fp-kind/data-fp-rotation ride along on the wrapper so the
      // interactive webview can scope the rotate action to furniture and read
      // back the current rotation without needing its own IR projection.
      for (const n of furnNodes.filter(isRug)) {
        svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}" data-fp-kind="furniture" data-fp-rotation="${Number((n.data as any)?.rotation) || 0}">\n${this.renderNode(n, pad, false, diagramType, nodeSwatch(n, diagramType))}  </g>\n`;
      }
      svg += renderFloorplanWalls(walls, openings);
      for (const n of furnNodes.filter((n) => !isRug(n))) {
        svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}" data-fp-kind="furniture" data-fp-rotation="${Number((n.data as any)?.rotation) || 0}">\n${this.renderNode(n, pad, false, diagramType, nodeSwatch(n, diagramType))}  </g>\n`;
      }
      svg += renderFloorplanRoomLabels(roomNodes, furnNodes);
      svg += renderFloorplanDimensions(dims);
      svg += renderFloorplanMeasures(measures);
      // Sheet chrome on top: it is opaque and must win over any linework that
      // happens to reach the corner it occupies.
      svg += renderFloorplanScaleBar(bh, fpScale);
      const titleBlock = (metadata?.titleBlock as any) ?? {};
      // Total floor area — a headline figure for the whole plan, summed from
      // the same room rectangles the per-room labels report.
      const totalM2 = roomNodes.reduce((sum, n) => sum + (n.size.width / fpScale) * (n.size.height / fpScale), 0);
      svg += renderFloorplanTitleBlock(bw, bh, {
        ...titleBlock,
        area: totalM2 > 0 ? `${totalM2.toFixed(1)} m²` : undefined,
      });
      svg += '</svg>';
      return svg;
    }

    // Groups draw as a background box behind their member nodes, so they must
    // be emitted before the edge/node loop below.
    // Titles are drawn in their own layer above the edges (on a surface chip),
    // so an edge crossing the title band never strikes through the text; the
    // chip rects also feed postRoute, which steers vertical runs around them.
    const titleSplit = diagramType !== DiagramType.WIREFRAME;
    let groupTitles = '';
    const titleBands: Rect[] = [];
    for (const g of groups) {
      let content = renderGroup(titleSplit && g.label ? { ...g, label: '' } : g, pad, sketchy);
      if (titleSplit && g.label && content) {
        const full = renderGroup(g, pad, sketchy);
        const title = full.startsWith(content) ? full.slice(content.length) : '';
        if (title) {
          const band = groupTitleBand(g)!;
          titleBands.push(band);
          groupTitles += `  <g class="seldia-group-title" data-seldia-group-id="${this.esc(g.id)}">\n    <rect x="${band.x + pad}" y="${band.y + pad}" width="${band.width}" height="${band.height}" rx="${DS.chip.rx}" fill="${DS.neutral.surface}" fill-opacity="0.92"/>\n${title}  </g>\n`;
        } else content = full;
      }
      if (content) svg += `  <g class="seldia-group" data-seldia-group-id="${this.esc(g.id)}">\n${content}  </g>\n`;
    }

    // Sequence control fragments: labelled boxes bracketing a range of
    // messages, drawn behind the message arrows (after lifelines, before
    // edges) so the arrows sit on top of the frame. Outer fragments first so
    // nested ones layer over them.
    for (const fb of fragmentBoxes) {
      svg += `  <g class="seldia-fragment" data-seldia-fragment-id="${this.esc(fb.id)}">\n${renderSequenceFragment(fb, pad, sketchy)}  </g>\n`;
    }

    let deferred = '';
    let edgeExtents: ((box: { add(x: number, y: number): void }) => void) | undefined;
    // Wireframe edges are layout-only (they stack controls in reading order);
    // drawing arrows between mockup controls would read as flowchart noise.
    if (diagramType !== DiagramType.WIREFRAME) {
      // Edges are clipped to the nodes they join, so the renderer needs to look
      // both up by id, and fanned across a shared border, which needs to know
      // about the other edges meeting there (see routedWaypoints).
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const fans = computeFans(edges, nodeById);
      // Compute edge label positions *after* routing so every edge has its
      // waypoints, and *before* rendering so labels can avoid each other and
      // every node box — no more two "Yes" labels piled on the same pixel.
      // Label placement must see the SAME polylines that get drawn.
      // renderEdge re-routes each edge (clip-to-border, fanning, obstacle
      // detours), so placing labels against the raw layout waypoints strands
      // them far from the visible line. Route once here and reuse.
      const allNodes = [...nodeById.values()];
      const routedWps = routeAllEdges(edges, allNodes);
      // Nudge parallel runs apart and plan line jumps on the SAME polylines the
      // labels are placed against and the paths are drawn from. Schematic and
      // layout-owned geometry (sequence lifelines, circuits, PCBs, git lanes)
      // keeps its routes untouched.
      const cleanEdges = ((metadata?.edgeStyle as string | undefined) ?? this.config.render.edgeStyle) !== 'sketch';   // in-fence `edges sketch|clean` beats config
      const dt = diagramType as string;
      const postRouted = POST_ROUTE_TYPES.has(dt);
      let jumps = new Map<string, Hop[]>();
      if (postRouted) {
        const fixed = new Map([...routedWps].filter(([id]) => !(edges.find((e) => e.id === id)?.data as any)?.exactEnds));
        const post = postRoute({ nodes: allNodes }, fixed, cleanEdges, titleBands);
        for (const [id, pts] of post.routes) routedWps.set(id, pts);
        jumps = post.jumps;
      } else if (dt === 'circuit') {
        const nets = new Map<string, string>();
        for (const e of edges) { const d = e.data as any; nets.set(e.id, String(d?.net ?? e.id)); }
        const post = postRouteCircuit({ nodes: allNodes }, routedWps, nets, cleanEdges);
        for (const [id, pts] of post.routes) routedWps.set(id, pts);
        jumps = post.jumps;
        // Junction dots come from the final geometry.
        const byNet = new Map<string, Point[][]>();
        for (const e of edges) {
          const d = e.data as any;
          if (d?.role !== 'wire' || !routedWps.has(e.id)) continue;
          (byNet.get(d.net) ?? byNet.set(d.net, []).get(d.net)!).push(routedWps.get(e.id)!);
        }
        for (const n of allNodes) {
          const d = n.data as any;
          if (d?.role === 'junction' && byNet.has(d.net)) d.dots = tJunctions(byNet.get(d.net)!);
        }
      }
      const routedEdges = edges.map((e) => routedWps.has(e.id) ? { ...e, waypoints: routedWps.get(e.id) } : e);
      const labelPos = computeEdgeLabelPositions(routedEdges, nodeById, pad, groups);
      // Layers, bottom to top: groups (above) → edge paths → nodes →
      // arrowheads → label chips and labels. Each edge's parts go to their own
      // layer so a node can never paint over a label or an arrowhead.
      const edgeStyle: EdgeStyle = { clean: cleanEdges, jumps, round: dt !== 'circuit' && dt !== 'pcb' };
      let paths = '', heads = '', labels = '';
      for (const e of routedEdges) {
        const parts = this.renderEdge(e, pad, sketchy, typeAccent, diagramType, nodeById, fans.get(e.id), labelPos.get(e.id), true, allNodes, edgeStyle);
        const id = this.esc(e.id);
        paths += `  <g class="seldia-edge" data-seldia-edge-id="${id}" data-src="${this.esc(e.sourceId)}" data-tgt="${this.esc(e.targetId)}">\n${parts.path}  </g>\n`;
        if (parts.head) heads += `    <g class="seldia-edge-head" data-seldia-edge-ref="${id}">\n${parts.head}    </g>\n`;
        if (parts.label) labels += `    <g class="seldia-edge-label" data-seldia-edge-ref="${id}">\n${parts.label}    </g>\n`;
      }
      if (routedEdges.length) {
        svg += `  <style>.seldia-edge:hover path{stroke-width:${DS.stroke.emphasis}}svg:has(.seldia-edge:hover) .seldia-edge:not(:hover),svg:has(.seldia-edge:hover) .seldia-edge-head,svg:has(.seldia-edge:hover) .seldia-edge-label{opacity:.35}svg:has(.seldia-edge:hover) .seldia-edge:hover,svg:has(.seldia-edge:hover) .seldia-edge-head:hover,svg:has(.seldia-edge:hover) .seldia-edge-label:hover{opacity:1}</style>\n`;
      }
      svg += paths;
      svg += groupTitles; groupTitles = '';
      deferred = (heads ? `  <g class="seldia-edge-heads">\n${heads}  </g>\n` : '') + (labels ? `  <g class="seldia-edge-labels">\n${labels}  </g>\n` : '');
      edgeExtents = (box) => {
        for (const e of routedEdges) {
          for (const p of e.waypoints || []) box.add(p.x + pad, p.y + pad);
          const lp = labelPos.get(e.id);
          if (lp && e.label) {
            const r = chipRect(lp.x, lp.y, e.label);
            box.add(r.x, r.y); box.add(r.x + r.width, r.y + r.height);
            if (lp.leader) { box.add(lp.leader.from.x, lp.leader.from.y); box.add(lp.leader.to.x, lp.leader.to.y); }
          }
        }
      };
    }
    for (const n of nodes) svg += `  <g class="seldia-node" data-seldia-node-id="${this.esc(n.id)}">\n${this.renderNode(n, pad, sketchy, diagramType, nodeSwatch(n, diagramType))}  </g>\n`;
    svg += deferred;

    // Canvas trim: size the viewBox to the real content (nodes, groups, edges,
    // chips, leaders) plus a uniform `pad`, so nothing is clipped at the left or
    // top and no slack is left over. Content is shifted with one wrapping <g>
    // so the viewBox keeps its "0 0 W H" origin (Marp and the editor read it).
    // Types that paint outside the IR (lifelines, axes, floorplans...) only
    // grow right/bottom as before.
    if (edgeExtents) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const box = { add(x: number, y: number) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
      const trims = TRIM_TYPES.has(diagramType) || (diagramType as string) === 'circuit';
      for (const n of nodes) { box.add(n.position.x + pad - 1, n.position.y + pad - 1); box.add(n.position.x + pad + n.size.width + 1, n.position.y + pad + n.size.height + 1); }
      for (const g of groups) { box.add(g.position.x + pad, g.position.y + pad); box.add(g.position.x + pad + g.size.width, g.position.y + pad + g.size.height); }
      edgeExtents(box);
      if (x0 !== Infinity) {
        let tx = 0, ty = 0, W = bw, H = bh;
        if (trims) {
          tx = Math.round(pad - x0); ty = Math.round(pad - y0);
          W = Math.ceil(x1 - x0 + 2 * pad); H = Math.ceil(y1 - y0 + 2 * pad);
        } else {
          W = Math.max(bw, Math.ceil(x1 + pad / 2)); H = Math.max(bh, Math.ceil(y1 + pad / 2));
        }
        if (W !== bw || H !== bh || tx || ty) {
          if (tx || ty) svg = svg.slice(0, headerEnd) + `  <g transform="translate(${tx},${ty})">\n` + svg.slice(headerEnd) + '  </g>\n';
          svg = svg.replace(`viewBox="0 0 ${bw} ${bh}" width="${bw}" height="${bh}"`, `viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"`)
            .replace(`<rect width="${bw}" height="${bh}"`, `<rect width="${W}" height="${H}"`);
        }
      }
    }
    svg += '</svg>';
    return svg;
  }

  /** Render a (possibly multi-line, `\n`-separated) label as one `<text>`
   *  element with one `<tspan>` per line, each on its own `y` offset — SVG's
   *  `<text>` does not treat `\n` as a line break on its own (item 2). */
  private renderLabel(x: number, startY: number, lineHeight: number, fs: number, ff: string, color: string, label: string, anchor: 'middle' | 'start' = 'middle'): string {
    const lines = splitLabelLines(label);
    const tspans = lines.map((line, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${this.esc(line)}</tspan>`).join('');
    return `    <text text-anchor="${anchor}" fill="${color}" font-size="${fs}" font-family="${ff}">${tspans}</text>\n`;
  }

  private renderNode(node: IRNode, pad: number, sketchy: boolean, diagramType: DiagramType, swatch: Swatch): string {
    // Per-type node grammar lives in each plugin's renderNode hook — the
    // engine no longer carries a `type === X` renderer ladder, so adding a
    // diagram type's visuals only touches its plugin. A hook returning
    // undefined (or a type with no hook) falls through to the generic
    // shape renderer below.
    const plugin = this.plugins.findHandler(diagramType);
    if (plugin?.renderNode) {
      const custom = plugin.renderNode(node, { pad, sketchy, swatch, diagramType });
      if (custom !== undefined) return custom;
    }

    const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
    const cx = x + w / 2, cy = y + h / 2;
    const s = node.style || {};
    const fill = swatch.fill, stroke = swatch.stroke, color = swatch.text;
    const sw = (s.strokeWidth as number) || DS.stroke.node;
    const fs = (s.fontSize as number) || DS.fontSize.label, ff = (s.fontFamily as string) || DS.fontFamily;
    const op = ' opacity="0.95"';
    const seed = seedFor(node.id);
    const roughStyle: RoughStyle = { stroke, strokeWidth: sw, fill, roughness: (s.roughness as number) ?? DS.roughness, fillStyle: (s.fillStyle as string) || 'solid', seed };
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
          : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius * 3.5}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="4,4"${op}/>\n`;
        break;
      case 'subroutine':
        if (sketchy) {
          el = roughRect(x, y, w, h, roughStyle);
          el += roughLine(x, y + 8, x + w, y + 8, roughStyle);
          el += roughLine(x, y + h - 8, x + w, y + h - 8, roughStyle);
        } else {
          el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n    <line x1="${x}" y1="${y + 8}" x2="${x + w}" y2="${y + 8}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${x}" y1="${y + h - 8}" x2="${x + w}" y2="${y + h - 8}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
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
          : `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${DS.radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op}/>\n`;
        break;
    }
    let rawLabel = node.label || node.id;
    // Non-rectangular outlines wrap to the text box inscribed in the shape, so a
    // long label no longer spills over a diamond's or hexagon's slanted sides.
    if (['diamond', 'hexagon', 'circle', 'parallelogram', 'stadium', 'cylinder'].includes(String(node.shape))) {
      rawLabel = balancedWrap(rawLabel, Math.max(20, shapeTextBox(node).width - 8), fs).join('\n');
    }
    const lineHeight = Math.round(fs * 1.3);
    const lineCount = rawLabel.split('\n').length;
    const startY = cy - ((lineCount - 1) * lineHeight) / 2 + fs * 0.35;
    el += this.renderLabel(cx, startY, lineHeight, fs, ff, color, rawLabel);
    return el;
  }

  /** Shape an edge's path and clip it to the two nodes it joins, so it always
   *  meets them on a border and never lies across one. See render/edge-routing
   *  for why the layout engine's own endpoints can't be reused.
   *  `allNodes` lets the router avoid crosscuts through unrelated nodes.
   *  A `via`-pinned edge (Step 4.2) skips the router entirely — obstacle
   *  avoidance and orthogonal elbow-routing would silently discard the
   *  user's own bend points, exactly the "manual override wins" rule
   *  `manualOverride` already applies to a dragged node — and only gets
   *  border-clipped, same as the router's own final step. */
  private routedWaypoints(edge: IREdge, wps: Point[], src?: IRNode, tgt?: IRNode, fan?: Fan, allNodes?: IRNode[]): Point[] {
    return routeEdgePolyline(edge, wps, src, tgt, fan, allNodes);
  }

  /** Draw one edge as separate parts so the caller can stack them in layers:
   *  `path` sits under the nodes;
   *  `head` (arrowhead) and `label` (chip, leader, text) sit above them. Types
   *  with their own edge grammar (sequence, ER, Gantt...) return everything in
   *  `path`, as before. */
  private renderEdge(edge: IREdge, pad: number, sketchy: boolean, typeAccent: Swatch, diagramType?: DiagramType, byId?: Map<string, IRNode>, fan?: Fan, labelPos?: LabelPlacement, preRouted = false, allNodesIn?: IRNode[], style?: EdgeStyle): EdgeParts {
    const only = (path: string): EdgeParts => ({ path, head: '', label: '' });
    if (diagramType === DiagramType.SEQUENCE) return only(renderSequenceMessage(edge, pad, sketchy, typeAccent));
    if (diagramType === DiagramType.ER) {
      const raw = edge.waypoints || [];
      const src = byId?.get(edge.sourceId), tgt = byId?.get(edge.targetId);
      // ER draws its own cardinality marks but wants the same clipped, fanned
      // route as every other edge.
      const routed = preRouted
        ? raw
        : (raw.length >= 2
            ? this.routedWaypoints(edge, raw, src, tgt, fan, allNodesIn ?? (byId ? [...byId.values()] : undefined))
            : raw);
      return only(renderErRelationship(edge, pad, sketchy, typeAccent.stroke, routed, labelPos));
    }
    if (diagramType === DiagramType.GANTT) return only(renderGanttDependency(edge, pad, sketchy, typeAccent.stroke));
    if (diagramType === DiagramType.MINDMAP) {
      const srcNode = byId?.get(edge.sourceId);
      const branchIdx = ((srcNode?.data as any)?.mindmapBranch as number) ?? 0;
      return only(renderMindmapBranch(edge, pad, sketchy, seriesColor(branchIdx)));
    }
    if (diagramType === DiagramType.GITGRAPH) {
      const srcLane = (edge.data as any)?.srcLane;
      return only(renderGitLane(edge, pad, sketchy, srcLane ?? 0));
    }

    const s = edge.style || {};
    // Edges take a muted tint of the diagram's signature accent so they read as
    // connective tissue (quieter than nodes) while still belonging to the same
    // colour family — never a jarring flat gray. Exception: when an edge fans
    // out alongside siblings at a shared node border (parallel edges running
    // side by side into/out of the same box), a flat gray makes them
    // indistinguishable from one another. Give each fanned slot its own colour
    // from the chart palette so parallel lines can be told apart at a glance.
    const fanned = !!fan && (fan.srcCount > 1 || fan.tgtCount > 1);
    const fanSlot = fanned && fan ? (fan.srcCount > 1 ? fan.srcIndex : fan.tgtIndex) : 0;
    const stroke = (s.stroke as string) || (fanned ? seriesColor(fanSlot) : DS.neutral.edge);
    const sw = (s.strokeWidth as number) || DS.stroke.edge;
    const dash = (s.strokeStyle as string) === 'dashed' ? DS.dash.edge : undefined;
    const rawWps = edge.waypoints || [];
    if (rawWps.length < 2) return only('');
    let wps: Point[];
    if (preRouted) {
      wps = rawWps;
    } else {
      const allNodes = allNodesIn ?? (byId ? [...byId.values()] : undefined);
      wps = this.routedWaypoints(edge, rawWps, byId?.get(edge.sourceId), byId?.get(edge.targetId), fan, allNodes);
    }
    const clean = style?.clean ?? true;
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
    const polyPts = wps.map(p => `${p.x + pad},${p.y + pad}`).join(' ');
    let el: string;
    if (!clean && sketchy) {
      const seed = seedFor(`${diagramType}:${edge.id}`);
      el = '';
      for (let i = 0; i < wps.length - 1; i++) {
        const a = wps[i], b = wps[i + 1];
        el += roughLine(a.x + pad, a.y + pad, b.x + pad, b.y + pad, { stroke, strokeWidth: sw, roughness: DS.roughness, seed: seed + i });
      }
    } else if (clean) {
      const d = edgePathD(wps, pad, pad, style?.jumps.get(edge.id), style?.round === false ? 0 : DS.bendRadius);
      el = `    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dashAttr}/>\n`;
    } else {
      el = `    <polyline points="${polyPts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dashAttr}/>\n`;
    }

    let head = '';
    const last = wps[wps.length - 1], prev = wps[wps.length - 2];
    if (last && prev) {
      const arrowType = ((edge.data as any)?.arrowType as string) || 'flow';
      // A use-case association (actor — use case) is a plain line: no head.
      const isUsecaseAssoc = diagramType === DiagramType.USECASE
        && (byId?.get(edge.sourceId)?.shape as string === 'actor' || byId?.get(edge.targetId)?.shape as string === 'actor'
          || (byId?.get(edge.sourceId)?.data as any)?.usecaseKind === 'actor' || (byId?.get(edge.targetId)?.data as any)?.usecaseKind === 'actor');
      if (!isUsecaseAssoc) head = this.renderArrowhead(arrowType, prev, last, pad, stroke, sw);
    }
    let label = '';
    if (edge.label) {
      // Use the anti-overlap placement when available; otherwise fall back
      // to the midpoint of the middle segment (the original behaviour).
      let lx: number, ly: number;
      if (labelPos) {
        lx = labelPos.x;
        ly = labelPos.y;
      } else {
        const mid = wps[Math.floor((wps.length - 1) / 2)];
        const next = wps[Math.floor((wps.length - 1) / 2) + 1] || mid;
        lx = (mid.x + next.x) / 2 + pad;
        ly = (mid.y + next.y) / 2 + pad;
      }
      // The chip rect is the placement module's own, so what is drawn is exactly
      // what the label placer avoided collisions with. Chip border uses the
      // diagram accent so the label belongs to the same colour family as its nodes.
      const r = chipRect(lx, ly, edge.label);
      const leader = labelPos?.leader;
      if (leader) label += `    <line x1="${leader.from.x}" y1="${leader.from.y}" x2="${leader.to.x}" y2="${leader.to.y}" stroke="${stroke}" stroke-width="${DS.stroke.hairline}" stroke-dasharray="${DS.dash.leader}"/>\n`;
      // No box: the label is plain text with a canvas-coloured halo (paint-order stroke), so the
      // line it sits on is knocked out just behind the glyphs and nothing reads as a white pill.
      const lines = splitLabelLines(edge.label);
      const lh = (r.height - 2 * DS.chip.padY) / lines.length;
      const tspans = lines.map((line, i) => `<tspan x="${lx}" y="${r.y + DS.chip.padY + lh * (i + 0.5)}">${this.esc(line)}</tspan>`).join('');
      const textAttrs = `text-anchor="middle" dominant-baseline="central" font-size="${EDGE_LABEL_FONT}" font-family="${DS.fontFamily}"`;
      // Two passes rather than paint-order: the halo copy sits underneath the plain one, which renders
      // the same in every SVG consumer (paint-order is missing from several rasterisers).
      label += `    <text ${textAttrs} fill="none" stroke="var(--seldia-label-bg, ${DS.neutral.surface})" stroke-width="${DS.stroke.halo}" stroke-linejoin="round" data-halo="1" aria-hidden="true">${tspans}</text>\n`;
      label += `    <text ${textAttrs} fill="${DS.neutral.text}">${tspans}</text>\n`;
    }
    return { path: el, head, label };
  }

  /** Draw one of the UML-conventional arrowhead types onto the last segment
   *  of `prev → last` (reference image B): filled triangle (flow, the
   *  historical default), hollow triangle (generalization/inheritance),
   *  open V (association), diamond (aggregation/composition). The head's
   *  length is `DS.arrowScale` × the edge stroke width. */
  private renderArrowhead(kind: string, prev: Point, last: Point, pad: number, stroke: string, sw: number = DS.stroke.edge): string {
    return arrowheadSvg(kind, prev, last, pad, stroke, sw);
  }

  private esc(s: string): string { return escapeXml(s); }

  compileSync(source: string, filePath?: string): Result<RenderResult> {
    const r1 = this.parse(source, filePath); if (!r1.ok) return r1;
    const r2 = this.analyze(r1.value); if (!r2.ok) return r2;
    const r3 = this.transform(r2.value); if (!r3.ok) return r3;
    const r4 = this.layout(r3.value); if (!r4.ok) return r4;
    return this.render(r4.value);
  }

  compileIRSync(ir: DiagramIR): Result<RenderResult> {
    const r = this.layout(ir); if (!r.ok) return r;
    return this.render(r.value);
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
