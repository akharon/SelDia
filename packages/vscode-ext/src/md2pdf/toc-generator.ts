// =============================================================================
// SelDiA — MD→PDF Table of Contents Generator
// =============================================================================
// Generates a Table of Contents from the document headings and diagram list.

export interface TocConfig {
  /** Minimum number of diagrams to trigger TOC */
  minDiagrams: number;
  /** Whether to include diagram entries in the TOC */
  includeDiagrams: boolean;
  /** Whether to include page numbers */
  includePageNumbers: boolean;
}

export interface TocEntry {
  level: number;       // 1 = h1, 2 = h2, etc.
  text: string;
  anchor: string;
  isDiagram?: boolean;
  diagramIndex?: number;
}

/**
 * Extract headings from an HTML string to build a Table of Contents.
 */
export function extractHeadings(html: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const headingRegex = /<h([1-6])\s+[^>]*id="([^"]*)"[^>]*>(.*?)<\/h[1-6]>/g;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1]);
    const anchor = match[2];
    const text = match[3].replace(/<[^>]*>/g, '').trim();
    entries.push({ level, text, anchor });
  }

  return entries;
}

/**
 * Generate a Table of Contents HTML section.
 */
export function generateToc(
  headings: TocEntry[],
  diagrams: Array<{ index: number; title: string; type: string; hasError: boolean }>,
  config: Partial<TocConfig> = {}
): string {
  const cfg: TocConfig = {
    minDiagrams: config.minDiagrams ?? 3,
    includeDiagrams: config.includeDiagrams ?? true,
    includePageNumbers: config.includePageNumbers ?? true,
  };

  const hasEnoughDiagrams = diagrams.length >= cfg.minDiagrams;

  let html = '<div class="seldia-toc">\n';
  html += '<h1>Table of Contents</h1>\n<ul>\n';

  for (const entry of headings) {
    const indent = entry.level > 1 ? ` class="toc-h${entry.level}"` : '';
    const pageNum = cfg.includePageNumbers ? ' <span style="float:right;color:#94a3b8;"></span>' : '';
    html += `  <li${indent}><a href="#${entry.anchor}">${escapeHtml(entry.text)}</a>${pageNum}</li>\n`;
  }

  // Add diagram entries
  if (cfg.includeDiagrams && hasEnoughDiagrams && diagrams.length > 0) {
    html += '  <li style="margin-top:12px;font-weight:600;border-bottom:none;">Diagrams</li>\n';
    // Small self-contained inline SVGs — this HTML is rendered standalone by
    // Puppeteer into a PDF, so it has no access to VS Code's Codicon font or
    // the webview icon sprite; a literal emoji would be the only other
    // option, which is what item 1 asks to move away from.
    const warningIcon = '<svg width="12" height="12" viewBox="0 0 24 24" style="vertical-align:-1px"><path d="M12 3 2 21h20L12 3Z" fill="none" stroke="#b45309" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4" stroke="#b45309" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1" fill="#b45309"/></svg>';
    const diagramIcon = '<svg width="12" height="12" viewBox="0 0 24 24" style="vertical-align:-1px"><rect x="3" y="4" width="7" height="5" rx="1" fill="none" stroke="#334155" stroke-width="2"/><rect x="14" y="4" width="7" height="5" rx="1" fill="none" stroke="#334155" stroke-width="2"/><rect x="8.5" y="15" width="7" height="5" rx="1" fill="none" stroke="#334155" stroke-width="2"/><path d="M6.5 9v3.5h10.5V9M12 12.5V15" fill="none" stroke="#334155" stroke-width="2" stroke-linecap="round"/></svg>';
    for (const d of diagrams) {
      const label = d.title || `${d.type} diagram`;
      const icon = d.hasError ? warningIcon : diagramIcon;
      const diagramAnchor = `seldia-diagram-${d.index}`;
      html += `  <li class="toc-h2"><a href="#${diagramAnchor}">${icon} ${escapeHtml(label)}</a></li>\n`;
    }
  }

  html += '</ul>\n</div>\n';
  return html;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
