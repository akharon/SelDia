// =============================================================================
// SelDiA — Approximate Text Measurement
// =============================================================================
// A pure-Node SVG-string renderer has no canvas/DOM to measure text with, so
// this uses a per-character average-width heuristic keyed by font size. Good
// enough to size node boxes so labels don't overflow (see
// docs/improvement_request.md item 2) — not pixel-perfect, but conservative
// (slightly generous) so overflow is the rare case, not the common one.
// =============================================================================

/** Average glyph width as a fraction of font size, for a typical UI sans-serif. */
const AVG_CHAR_WIDTH_EM = 0.56;

export interface MeasuredText {
  lines: string[];
  /** Widest line's estimated pixel width. */
  width: number;
  /** Total estimated pixel height for all lines at the given line height. */
  height: number;
  lineHeight: number;
}

/** Split a label on `\n` and estimate its rendered box size at `fontSize`. */
export function measureLabel(label: string, fontSize: number): MeasuredText {
  const lines = (label || '').split('\n');
  const lineHeight = Math.round(fontSize * 1.35);
  const charWidth = fontSize * AVG_CHAR_WIDTH_EM;
  const width = Math.max(1, ...lines.map((l) => l.length)) * charWidth;
  const height = lines.length * lineHeight;
  return { lines, width, height, lineHeight };
}

/** Size a node box from its label (and optional extra lines, e.g. class
 *  compartments), with a floor so short labels don't shrink below the
 *  historical minimum for that diagram type. */
export function sizeForLabel(
  label: string,
  fontSize: number,
  minWidth: number,
  minHeight: number,
  paddingX = 24,
  paddingY = 16,
  extraLines: string[] = []
): { width: number; height: number } {
  const allLines = [...label.split('\n'), ...extraLines];
  const m = measureLabel(allLines.join('\n'), fontSize);
  return {
    width: Math.max(minWidth, Math.ceil(m.width + paddingX)),
    height: Math.max(minHeight, Math.ceil(m.height + paddingY)),
  };
}
