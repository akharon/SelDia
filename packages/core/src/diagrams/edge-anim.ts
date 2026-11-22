// Carries only the authored `animate` attribute from an AST edge style into the IR
// edge style, for diagram types that otherwise start from an empty style.
import type { EdgeStyle } from '../types/style.js';

export function animStyle(style: unknown): Partial<EdgeStyle> {
  const a = (style as { animate?: unknown } | undefined)?.animate;
  return a === undefined ? {} : { animate: a as EdgeStyle['animate'] };
}
