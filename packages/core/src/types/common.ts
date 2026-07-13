// =============================================================================
// SelDiA — Common Types
// =============================================================================

/** A 2D point in the coordinate system */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle defined by position and dimensions */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A size/ dimension pair */
export interface Size {
  width: number;
  height: number;
}

/** Padding (CSS-like shorthand: top right bottom left) */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** RGBA color representation */
export interface Color {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1
}

/** A unique identifier (string) */
export type ID = string;

/** Source location in the DSL file */
export interface SourceLocation {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  offset: number;
}

/** Severity levels for diagnostics */
export enum DiagnosticSeverity {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  HINT = 'hint',
}

/** A diagnostic message with source location */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  source: SourceLocation;
  code?: string; // error code e.g. "E0001"
  helpUrl?: string;
}

/** Result wrapper for operations that can fail */
export type Result<T, E = Diagnostic[]> =
  | { ok: true; value: T }
  | { ok: false; errors: E };

/** Direction enum for layout and edges */
export enum Direction {
  TOP_TO_BOTTOM = 'TB',
  BOTTOM_TO_TOP = 'BT',
  LEFT_TO_RIGHT = 'LR',
  RIGHT_TO_LEFT = 'RL',
}

/** Alignment */
export enum Alignment {
  START = 'start',
  CENTER = 'center',
  END = 'end',
  STRETCH = 'stretch',
}
