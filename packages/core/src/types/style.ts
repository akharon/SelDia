// =============================================================================
// SelDiA — Style & Theme Types
// =============================================================================

import type { Color } from './common.js';

// -----------------------------------------------------------------------------
// Fill style (Rough.js compatible)
// -----------------------------------------------------------------------------

export enum FillStyle {
  HACHURE = 'hachure',
  SOLID = 'solid',
  ZIGZAG = 'zigzag',
  CROSS_HATCH = 'cross-hatch',
  DOTS = 'dots',
  DASHED = 'dashed',
  ZIGZAG_LINE = 'zigzag-line',
}

// -----------------------------------------------------------------------------
// Stroke style for edges
// -----------------------------------------------------------------------------

export enum StrokeStyle {
  SOLID = 'solid',
  DASHED = 'dashed',
  DOTTED = 'dotted',
  DOUBLE = 'double',
}

// -----------------------------------------------------------------------------
// Font weight
// -----------------------------------------------------------------------------

export enum FontWeight {
  NORMAL = 'normal',
  BOLD = 'bold',
  LIGHT = 'light',
}

// -----------------------------------------------------------------------------
// Font style
// -----------------------------------------------------------------------------

export enum FontStyle {
  NORMAL = 'normal',
  ITALIC = 'italic',
}

// -----------------------------------------------------------------------------
// Text alignment
// -----------------------------------------------------------------------------

export enum TextAlign {
  LEFT = 'left',
  CENTER = 'center',
  RIGHT = 'right',
}

// -----------------------------------------------------------------------------
// Node Style
// -----------------------------------------------------------------------------

export interface NodeStyle {
  // --- Rough.js specific ---
  /** Roughness: 0 (smooth) to 3 (very sketchy). Default: 1.2 */
  roughness: number;

  /** Bowing of lines: 0 (straight) to 5 (curved). Default: 1.5 */
  bowing: number;

  /** Fill pattern style. Default: 'hachure' */
  fillStyle: FillStyle;

  /** Stroke width of fill pattern lines. Default: 1 */
  fillWeight: number;

  /** Angle of hachure lines in degrees. Default: -41 */
  hachureAngle: number;

  /** Gap between hachure lines. Default: 5 */
  hachureGap: number;

  // --- General styling ---
  /** Stroke color (CSS color string). Default: '#000000' */
  stroke: string;

  /** Stroke width in pixels. Default: 2 */
  strokeWidth: number;

  /** Stroke dash array (e.g., '5,5'). Empty string = solid */
  strokeDasharray: string;

  /** Fill color (CSS color string). Default: '#ffffff' */
  fill: string;

  /** Background opacity (0-1). Default: 1 */
  opacity: number;

  // --- Text styling ---
  /** Font family (CSS font-family). Default: 'Caveat, Comic Sans MS, cursive' */
  fontFamily: string;

  /** Font size in pixels. Default: 16 */
  fontSize: number;

  /** Font weight. Default: 'normal' */
  fontWeight: FontWeight;

  /** Font style. Default: 'normal' */
  fontStyle: FontStyle;

  /** Text color (CSS color string). Default: '#000000' */
  textColor: string;

  /** Text alignment within the node. Default: 'center' */
  textAlign: TextAlign;

  // --- Padding ---
  /** Internal padding in pixels. Default: 12 */
  padding: number;

  /** Minimum width of the node. Default: 80 */
  minWidth: number;

  /** Minimum height of the node. Default: 40 */
  minHeight: number;

  // --- Border radius ---
  /** Border radius for rectangles. Default: 4 */
  borderRadius: number;

  // --- Shadow ---
  /** Whether to render a drop shadow. Default: false */
  shadow: boolean;

  /** Shadow blur radius. Default: 4 */
  shadowBlur: number;

  /** Shadow offset X. Default: 2 */
  shadowOffsetX: number;

  /** Shadow offset Y. Default: 2 */
  shadowOffsetY: number;

  /** Shadow color. Default: 'rgba(0,0,0,0.2)' */
  shadowColor: string;
}

// -----------------------------------------------------------------------------
// Edge Style
// -----------------------------------------------------------------------------

export interface EdgeStyle {
  // --- Rough.js specific ---
  roughness: number;
  bowing: number;

  // --- General styling ---
  /** Stroke color. Default: '#000000' */
  stroke: string;

  /** Stroke width. Default: 2 */
  strokeWidth: number;

  /** Stroke style. Default: 'solid' */
  strokeStyle: StrokeStyle;

  /** Custom dash array for dashed/dotted */
  strokeDasharray: string;

  /** Opacity (0-1). Default: 1 */
  opacity: number;

  // --- Arrow head ---
  /** Whether to draw an arrowhead at the end. Default: true */
  arrowhead: boolean;

  /** Arrowhead size in pixels. Default: 10 */
  arrowheadSize: number;

  // --- Label styling ---
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeight;
  fontStyle: FontStyle;
  textColor: string;

  // --- User-pinned route ---
  /** Flat `[x1, y1, x2, y2, ...]` waypoint list from the DSL's `via:` edge
   *  attribute. When present, layout skips routing for this edge and uses
   *  these points (plus the node border clip) as-is — same "manual override
   *  wins" model as a node's `{x,y}`. Optional: absent on every edge that
   *  hasn't been manually routed, which is the overwhelming majority. */
  via?: number[];
}

// -----------------------------------------------------------------------------
// Group Style
// -----------------------------------------------------------------------------

export interface GroupStyle {
  roughness: number;
  bowing: number;

  /** Stroke color. Default: '#888888' */
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string;
  fill: string;
  opacity: number;

  /** Header label styling */
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeight;
  fontStyle: FontStyle;
  textColor: string;

  /** Padding inside the group boundary */
  padding: number;

  /** Border radius. Default: 8 */
  borderRadius: number;
}

// -----------------------------------------------------------------------------
// Theme — a complete visual configuration
// -----------------------------------------------------------------------------

export interface Theme {
  /** Unique theme identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description?: string;

  /** Whether this theme uses Rough.js (true) or smooth rendering (false) */
  sketchy: boolean;

  /** Base font family for all text */
  fontFamily: string;

  /** Base font size */
  fontSize: number;

  /** Color palette */
  palette: ThemePalette;

  /** Default node style */
  node: Partial<NodeStyle>;

  /** Default edge style */
  edge: Partial<EdgeStyle>;

  /** Default group style */
  group: Partial<GroupStyle>;

  /** Diagram-type-specific overrides, keyed by diagram type */
  overrides?: Partial<Record<string, {
    node?: Partial<NodeStyle>;
    edge?: Partial<EdgeStyle>;
  }>>;
}

export interface ThemePalette {
  /** Primary accent color */
  primary: string;

  /** Secondary accent color */
  secondary: string;

  /** Tertiary accent color */
  tertiary: string;

  /** Background color */
  background: string;

  /** Surface / card color */
  surface: string;

  /** Default text color */
  text: string;

  /** Muted / secondary text */
  textMuted: string;

  /** Default border color */
  border: string;

  /** Success color (green) */
  success: string;

  /** Warning color (amber) */
  warning: string;

  /** Error / danger color (red) */
  error: string;

  /** Info color (blue) */
  info: string;

  /** Additional named colors */
  extended?: Record<string, string>;
}

// -----------------------------------------------------------------------------
// Default Theme Presets
// -----------------------------------------------------------------------------

export const DEFAULT_THEME_SKETCHY_LIGHT: Theme = {
  id: 'sketchy-light',
  name: 'Sketchy Light',
  sketchy: true,
  fontFamily: 'Caveat, Comic Sans MS, cursive, sans-serif',
  fontSize: 16,
  palette: {
    primary: '#2563eb',
    secondary: '#7c3aed',
    tertiary: '#059669',
    background: '#fafaf9',
    surface: '#ffffff',
    text: '#1c1917',
    textMuted: '#78716c',
    border: '#292524',
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
    info: '#2563eb',
  },
  node: {
    roughness: 1.2,
    bowing: 1.5,
    fillStyle: FillStyle.HACHURE,
    fillWeight: 1.5,
    hachureAngle: -41,
    hachureGap: 5,
    stroke: '#292524',
    strokeWidth: 2.5,
    fill: '#ffffff',
    fontFamily: 'Caveat, Comic Sans MS, cursive, sans-serif',
    fontSize: 16,
    textColor: '#1c1917',
    padding: 14,
    minWidth: 80,
    minHeight: 40,
    borderRadius: 4,
    shadow: true,
    shadowBlur: 3,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    shadowColor: 'rgba(0,0,0,0.15)',
  },
  edge: {
    roughness: 1.0,
    bowing: 1.2,
    stroke: '#292524',
    strokeWidth: 2,
    arrowhead: true,
    arrowheadSize: 10,
    fontFamily: 'Caveat, Comic Sans MS, cursive, sans-serif',
    fontSize: 13,
    textColor: '#57534e',
  },
  group: {
    roughness: 0.8,
    bowing: 1.0,
    stroke: '#a8a29e',
    strokeWidth: 1.5,
    strokeDasharray: '8,4',
    fill: 'rgba(245,245,244,0.3)',
    fontFamily: 'Caveat, Comic Sans MS, cursive, sans-serif',
    fontSize: 14,
    textColor: '#78716c',
    padding: 20,
    borderRadius: 8,
  },
};
