// =============================================================================
// SelDiA — Shape Types
// =============================================================================

import type { Rect, Point, Size } from './common.js';

// -----------------------------------------------------------------------------
// Shape Enum — all supported node shapes
// -----------------------------------------------------------------------------

export enum ShapeType {
  /** Rectangle [label] — standard process / action */
  RECTANGLE = 'rectangle',

  /** Rounded rectangle (label) — start/stop, use case */
  ROUNDED_RECTANGLE = 'rounded-rectangle',

  /** Diamond {label} — decision / conditional */
  DIAMOND = 'diamond',

  /** Hexagon <label> — preparation / setup */
  HEXAGON = 'hexagon',

  /** Parallelogram [/label/] or [\label\] — input/output */
  PARALLELOGRAM = 'parallelogram',

  /** Circle ((label)) — connector / start */
  CIRCLE = 'circle',

  /** Database cylinder [||label||] — data store */
  CYLINDER = 'cylinder',

  /** Subroutine {{label}} — predefined process */
  SUBROUTINE = 'subroutine',

  /** Stadium / pill shape [()label()] */
  STADIUM = 'stadium',

  /** Cloud (outline) — external system / internet */
  CLOUD = 'cloud',

  /** Actor stick figure — person / user */
  ACTOR = 'actor',

  /** Note / comment box (folded corner) */
  NOTE = 'note',

  /** Queue / pipe — message queue */
  QUEUE = 'queue',

  /** Custom path — user-defined SVG path */
  CUSTOM = 'custom',

  /** None — invisible container / spacer */
  NONE = 'none',
}

// -----------------------------------------------------------------------------
// Shape Render Hints
// -----------------------------------------------------------------------------

/** Hints passed from the DSL to the shape renderer */
export interface ShapeHints {
  /** Whether to draw a double border (e.g., for external C4 elements) */
  doubleBorder?: boolean;

  /** Whether to draw a dashed border */
  dashed?: boolean;

  /** Whether to draw a bold/thick border */
  bold?: boolean;

  /** Icon name to render inside the shape (e.g., 'database', 'server', 'user') */
  icon?: string;

  /** Whether the shape has a shadow */
  shadow?: boolean;

  /** Corner radius override for rectangle-based shapes */
  cornerRadius?: number;

  /** Custom SVG path data for CUSTOM shape type */
  customPath?: string;
}

// -----------------------------------------------------------------------------
// Shape Definition — combines type, hints, and geometry
// -----------------------------------------------------------------------------

export interface ShapeDefinition {
  type: ShapeType;
  hints: ShapeHints;
}

// -----------------------------------------------------------------------------
// Port — connection point on a shape for edge attachment
// -----------------------------------------------------------------------------

export enum PortPosition {
  TOP = 'top',
  RIGHT = 'right',
  BOTTOM = 'bottom',
  LEFT = 'left',
  CENTER = 'center',
}

export interface Port {
  id: string;
  position: PortPosition;
  offset?: number; // 0-1 relative position along the side
}

// -----------------------------------------------------------------------------
// Shape registry — maps DSL shape syntax to ShapeType
// -----------------------------------------------------------------------------

/**
 * Maps DSL shape shorthand to ShapeType.
 *
 * Syntax mapping:
 *   [text]     → RECTANGLE
 *   (text)     → ROUNDED_RECTANGLE
 *   {text}     → DIAMOND
 *   <text>     → HEXAGON
 *   [/text/]   → PARALLELOGRAM
 *   ((text))   → CIRCLE
 *   [||text||] → CYLINDER
 *   {{text}}   → SUBROUTINE
 *   [()text()] → STADIUM
 *   @text@     → CLOUD
 *   :text:     → ACTOR
 */
export const DSL_SHAPE_MAP: Record<string, ShapeType> = {
  '[': ShapeType.RECTANGLE,
  '(': ShapeType.ROUNDED_RECTANGLE,
  '{': ShapeType.DIAMOND,
  '<': ShapeType.HEXAGON,
  '[/': ShapeType.PARALLELOGRAM,
  '[\\': ShapeType.PARALLELOGRAM,
  '((': ShapeType.CIRCLE,
  '[||': ShapeType.CYLINDER,
  '{{': ShapeType.SUBROUTINE,
  '[()': ShapeType.STADIUM,
  '@': ShapeType.CLOUD,
  ':': ShapeType.ACTOR,
};
