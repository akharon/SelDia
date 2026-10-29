// =============================================================================
// SelDiA — Per-Document TOC/Caption Overrides (pure, testable)
// =============================================================================
// A document opts out of the auto-TOC or the numbered captions with YAML
// front-matter keys, overriding the workspace-wide
// seldia.markdown.toc.enabled / seldia.markdown.captions.enabled settings for
// just that file:
//
//   ---
//   seldia_toc: false
//   seldia_captions: false
//   seldia_tables: false
//   ---
//
// This exists for documents that already carry their own hand-written TOC —
// the global setting can't distinguish "no TOC anywhere" from "this one
// document already has one", so the override has to live in the document
// itself. Same front-matter-sniffing approach as marp/detect.ts: a regex over
// the leading `---` block, no YAML parser pulled in for two boolean keys.
// =============================================================================

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface SelDiAFrontMatterOverrides {
  /** `seldia_toc: false` in front-matter — suppresses the auto-TOC for this document. */
  toc?: boolean;
  /** `seldia_captions: false` in front-matter — suppresses numbered captions for this document. */
  captions?: boolean;
  /** `seldia_tables: false` in front-matter — renders this document's tables plain (no SelDiA styling/toolbar). */
  tables?: boolean;
}

/** Read `seldia_toc` / `seldia_captions` booleans out of a document's YAML
 *  front-matter, if present. Absent keys leave the corresponding field
 *  `undefined` so the caller can fall back to the workspace setting. */
export function readFrontMatterOverrides(markdown: string): SelDiAFrontMatterOverrides {
  const m = FRONT_MATTER_RE.exec(markdown);
  if (!m) return {};
  const body = m[1];
  const overrides: SelDiAFrontMatterOverrides = {};
  const toc = /^seldia_toc\s*:\s*(true|false)\s*$/m.exec(body);
  if (toc) overrides.toc = toc[1] === 'true';
  const captions = /^seldia_captions\s*:\s*(true|false)\s*$/m.exec(body);
  if (captions) overrides.captions = captions[1] === 'true';
  const tables = /^seldia_tables\s*:\s*(true|false)\s*$/m.exec(body);
  if (tables) overrides.tables = tables[1] === 'true';
  return overrides;
}
