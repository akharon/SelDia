// =============================================================================
// SelDiA — Marp Document Detection (pure, testable)
// =============================================================================
// A Markdown document is a Marp deck when its YAML front-matter sets
// `marp: true`, matching the convention the official Marp tooling uses. No
// other signal (fence content, filename) opts a document in — false positives
// would make an ordinary Markdown file suddenly turn into a slide deck.
// =============================================================================

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** True if `markdown` has YAML front-matter containing a truthy `marp` key. */
export function isMarpDocument(markdown: string): boolean {
  const m = FRONT_MATTER_RE.exec(markdown);
  if (!m) return false;
  return /^marp\s*:\s*true\s*$/m.test(m[1]);
}
