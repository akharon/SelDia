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

  /** Default layout engine */
  defaultLayoutEngine: string;

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
}

export interface LayoutConfig {
  /** Default layout direction */
  direction: Direction;

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
