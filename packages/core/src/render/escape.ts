// =============================================================================
// SelDiA — XML/SVG text escaping
// =============================================================================
// One shared implementation. Escapes both quote characters so the result is
// safe in single- and double-quoted attribute values alike, and tolerates
// null/undefined because labels and ids reach the renderers from importers.
// =============================================================================

/** Escape a string for safe interpolation into SVG/XML text or an attribute
 *  value (either quoting style). */
export function escapeXml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
