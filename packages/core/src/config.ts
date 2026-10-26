// =============================================================================
// SelDiA — Global Configuration
// =============================================================================

import { Direction } from './types/common.js';

// -----------------------------------------------------------------------------
// SelDiA Configuration
// -----------------------------------------------------------------------------

export interface SelDiAConfig {
  /** Default diagram direction */
  defaultDirection: Direction;

  /** Default theme ID */
  defaultTheme: string;

  /** Default auto-layout engine. "dagre" is synchronous and always available
   *  (including in compileSync()); "elk" (Eclipse Layout Kernel) generally
   *  produces higher-quality layouts for architecture-style diagrams but is
   *  async-only, so it's honored by compile()/layoutAsync() but silently
   *  falls back to "dagre" in the synchronous compileSync()/layout() path.
   *  A diagram can override this per-file with `layout elk` / `layout dagre`. */
  defaultLayoutEngine: 'dagre' | 'elk';

  /** Per-diagram-type auto-layout engine, consulted after a diagram's own
   *  `layout …` line and before `defaultLayoutEngine`. Every entry is "dagre"
   *  until a type is shown (layout metrics) to be no worse under "elk";
   *  override single types via `new SelDiAEngine({ config: { layoutEngineByType:
   *  { flowchart: 'elk' } } })`. Custom-layout types ignore it. */
  layoutEngineByType: Record<string, 'dagre' | 'elk'>;

  /** When a diagram would get dagre only from the per-type default (no `layout`
   *  line, no global elk) and its IR has a group with members, use ELK instead:
   *  dagre's compound clusters overlap, ELK keeps them apart. Set false to disable. */
  elkWhenGrouped: boolean;

  /** Rendering options */
  render: RenderConfig;

  /** Layout options */
  layout: LayoutConfig;

  /** Parser options */
  parser: ParserConfig;

  /** Plugin configuration */
  plugins: PluginConfig;

  /** Output configuration */
  output: OutputConfig;

  /** Debug options */
  debug: DebugConfig;
}

// -----------------------------------------------------------------------------
// Sub-configs
// -----------------------------------------------------------------------------

export interface RenderConfig {
  /** Default output format */
  format: 'svg' | 'png' | 'pdf' | 'html';

  /** Scale factor for PNG/PDF export (1 = 1x, 2 = 2x / Retina) */
  scale: number;

  /** Background color (CSS string) */
  background: string;

  /** Whether to embed fonts in SVG */
  embedFonts: boolean;

  /** Whether to use hand-drawn (sketchy) rendering style */
  sketchy: boolean;

  /** Whether to include Rough.js annotation data in output */
  includeRoughAnnotations: boolean;

  /** Padding around the diagram (pixels) */
  padding: number;

  /** Named built-in palette to apply ("default" | "dark" | "high-contrast"),
   *  or a custom color map. Swaps node/edge/text/background colors without
   *  forking any renderer code — see render/design-system.ts PaletteOverride.
   *  `palette` (a literal color map) takes precedence over `theme` (a name)
   *  when both are set. */
  theme?: string;
  palette?: import('./render/design-system.js').PaletteOverride;
}

export interface LayoutConfig {
  /** Default layout direction */
  direction: Direction;

  /** When set, overrides *every* diagram type's own default direction for
   *  the next layout pass — unlike `direction` above, which only fills in
   *  when a type has no opinion of its own (see `resolvedLayoutOptions` in
   *  engine.ts). Meant to be set transiently by a caller that needs to force
   *  an orientation regardless of what the diagram's author or type default
   *  declared (e.g. Marp forcing landscape diagrams to fit a slide), then
   *  cleared immediately after — it is not a persistent config value. */
  forceDirection?: Direction;

  /** Node spacing (horizontal, vertical) */
  nodeSpacing: [number, number];

  /** Rank spacing for hierarchical layouts */
  rankSpacing: number;

  /** Edge spacing for routing */
  edgeSpacing: number;

  /** Whether to allow overlapping nodes (useful for manual layouts) */
  allowOverlap: boolean;

  /** Maximum layout iterations for force-directed */
  maxIterations: number;
}

export interface ParserConfig {
  /** Whether to allow unknown statements (lenient mode) */
  lenient: boolean;

  /** Whether to preserve comments in the AST */
  preserveComments: boolean;

  /** Maximum number of parser errors before aborting */
  maxErrors: number;

  /** Source file encoding */
  encoding: string;
}

export interface PluginConfig {
  /** Whether to auto-discover plugins from node_modules */
  autoDiscover: boolean;

  /** Plugin search paths */
  searchPaths: string[];

  /** Plugins to explicitly enable */
  enabled: string[];

  /** Plugins to explicitly disable */
  disabled: string[];

  /** Per-plugin configuration, keyed by plugin ID */
  options: Record<string, Record<string, unknown>>;
}

export interface OutputConfig {
  /** Output directory for CLI */
  outDir: string;

  /** Whether to overwrite existing files */
  overwrite: boolean;

  /** File naming pattern (supports {name}, {type}, {ext}) */
  filenamePattern: string;
}

export interface DebugConfig {
  /** Enable debug logging */
  enabled: boolean;

  /** Log level */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';

  /** Whether to include timing information in output */
  showTiming: boolean;

  /** Whether to include AST/IR debug info in output */
  showDebugInfo: boolean;

  /** Whether to render layout debug overlays (bounding boxes, etc.) */
  showLayoutDebug: boolean;
}

// -----------------------------------------------------------------------------
// Default Configuration
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG: SelDiAConfig = {
  defaultDirection: Direction.TOP_TO_BOTTOM,
  defaultTheme: 'sketchy-light',
  defaultLayoutEngine: 'dagre',
  elkWhenGrouped: true,
  layoutEngineByType: {
    flowchart: 'dagre', class: 'elk', er: 'dagre', state: 'elk', usecase: 'dagre', activity: 'dagre',
    component: 'elk', deployment: 'dagre', 'c4-context': 'dagre', 'c4-container': 'dagre',
    'c4-component': 'dagre', 'c4-code': 'dagre', bpmn: 'dagre', dmn: 'dagre', network: 'elk',
    block: 'elk', cloud: 'dagre', workitem: 'elk', form: 'dagre', wireframe: 'dagre',
  },

  render: {
    format: 'svg',
    scale: 1,
    background: 'transparent',
    embedFonts: true,
    sketchy: true,
    includeRoughAnnotations: false,
    padding: 20,
  },

  layout: {
    direction: Direction.TOP_TO_BOTTOM,
    nodeSpacing: [80, 60],
    rankSpacing: 80,
    edgeSpacing: 20,
    allowOverlap: false,
    maxIterations: 500,
  },

  parser: {
    lenient: false,
    preserveComments: false,
    maxErrors: 10,
    encoding: 'utf-8',
  },

  plugins: {
    autoDiscover: true,
    searchPaths: [],
    enabled: [],
    disabled: [],
    options: {},
  },

  output: {
    outDir: './out',
    overwrite: true,
    filenamePattern: '{name}.{ext}',
  },

  debug: {
    enabled: false,
    logLevel: 'warn',
    showTiming: false,
    showDebugInfo: false,
    showLayoutDebug: false,
  },
};
