// =============================================================================
// SelDiA — Render Engine Types
// =============================================================================

import type { LayoutResult } from '@seldia/core/ir/types';
import type { Theme, NodeStyle, EdgeStyle, GroupStyle } from '@seldia/core/types/style';
import type { Rect, Size } from '@seldia/core/types/common';

// -----------------------------------------------------------------------------
// Render Options
// -----------------------------------------------------------------------------

export interface RenderOptions {
  /** Output format */
  format: 'svg' | 'canvas' | 'png' | 'pdf' | 'html';

  /** Scale factor (for raster output) */
  scale: number;

  /** Background color */
  background: string;

  /** Theme to apply */
  theme: Theme;

  /** Whether to use Rough.js (true) or smooth rendering (false) */
  sketchy: boolean;

  /** Whether to include interactive elements (for HTML output) */
  interactive: boolean;

  /** Whether to embed fonts via CSS @import */
  embedFonts: boolean;

  /** Whether to include debug overlays */
  debug: boolean;

  /** Additional CSS to inject (for SVG/HTML) */
  extraCSS?: string;
}

// -----------------------------------------------------------------------------
// Render Engine Interface
// -----------------------------------------------------------------------------

export interface RenderEngine {
  /**
   * Render a laid-out diagram.
   *
   * @param layoutResult - The layout result from the layout engine
   * @param options - Render options
   * @returns The rendered output as a string (SVG markup, HTML, etc.)
   */
  render(layoutResult: LayoutResult, options: Partial<RenderOptions>): Promise<RenderOutput>;
}

export interface RenderOutput {
  /** The rendered content as a string */
  content: string;

  /** Output MIME type */
  mimeType: string;

  /** Rendered dimensions */
  width: number;
  height: number;

  /** Render statistics */
  stats: RenderStats;
}

export interface RenderStats {
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  renderTimeMs: number;
}

// -----------------------------------------------------------------------------
// Shape Renderer Interface
// -----------------------------------------------------------------------------

export interface ShapeRenderer {
  /** The shape type this renderer handles */
  readonly shapeType: string;

  /**
   * Render a single shape.
   *
   * @param bounds - The bounding rectangle for the shape
   * @param style - The node style to apply
   * @param sketchy - Whether to use Rough.js
   * @returns SVG path data string(s) and/or SVG elements
   */
  render(
    bounds: Rect,
    style: Partial<NodeStyle>,
    sketchy: boolean
  ): ShapeRenderOutput;
}

export interface ShapeRenderOutput {
  /** SVG elements as strings */
  elements: string[];

  /** Computed inner bounds (for text placement) */
  innerBounds: Rect;

  /** Connection ports (computed from shape geometry) */
  ports: Array<{ position: string; point: { x: number; y: number } }>;
}

// -----------------------------------------------------------------------------
// Edge Renderer Interface
// -----------------------------------------------------------------------------

export interface EdgeRenderer {
  /**
   * Render an edge with waypoints.
   *
   * @param waypoints - Array of points defining the edge path
   * @param style - Edge style
   * @param sketchy - Whether to use Rough.js
   * @param arrowhead - Whether to draw an arrowhead
   * @returns SVG markup for the edge
   */
  render(
    waypoints: Array<{ x: number; y: number }>,
    style: Partial<EdgeStyle>,
    sketchy: boolean,
    arrowhead: boolean
  ): string;
}

// -----------------------------------------------------------------------------
// Text Measurer Interface
// -----------------------------------------------------------------------------

export interface TextMeasurer {
  /**
   * Measure the dimensions of a text string.
   *
   * @param text - The text to measure
   * @param fontFamily - CSS font-family
   * @param fontSize - Font size in pixels
   * @param fontWeight - Font weight
   * @param maxWidth - Maximum width (for word wrapping)
   * @returns The measured size and wrapped lines
   */
  measure(
    text: string,
    fontFamily: string,
    fontSize: number,
    fontWeight?: string,
    maxWidth?: number
  ): TextMetrics;
}

export interface TextMetrics {
  width: number;
  height: number;
  lines: string[];
  lineHeight: number;
}

// -----------------------------------------------------------------------------
// Exporter Interface
// -----------------------------------------------------------------------------

export interface Exporter {
  /** Export format */
  readonly format: string;

  /**
   * Export rendered SVG to the target format.
   *
   * @param svg - The SVG markup
   * @param options - Export options
   * @returns The exported content as Buffer or string
   */
  export(svg: string, options: ExportOptions): Promise<Buffer | string>;
}

export interface ExportOptions {
  width: number;
  height: number;
  scale: number;
  background: string;
  quality?: number; // 0-1 for JPEG quality
}
