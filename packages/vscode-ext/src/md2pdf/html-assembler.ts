// =============================================================================
// SelDiA — MD→PDF HTML Assembler
// =============================================================================
// Assembles a complete HTML document from the markdown-parsed HTML,
// injected diagrams, print CSS, and optional Table of Contents.

import { PRINT_CSS } from './print-css.js';
import { generateToc, extractHeadings, type TocEntry } from './toc-generator.js';
import type { InjectorResult } from './diagram-injector.js';

export interface AssemblyOptions {
  /** Document title (for <title> tag and page header) */
  title?: string;
  /** Whether to generate a Table of Contents */
  generateToc?: boolean;
  /** Minimum number of diagrams to trigger TOC */
  tocMinDiagrams?: number;
  /** Additional CSS to inject */
  customCss?: string;
  /** Document metadata */
  metadata?: {
    author?: string;
    subject?: string;
    keywords?: string[];
    description?: string;
  };
}

export interface AssemblyResult {
  /** Complete HTML document */
  html: string;
  /** Number of pages estimation */
  estimatedPages: number;
}

/**
 * Assemble a full HTML document ready for Puppeteer PDF rendering.
 */
export function assembleHtml(
  bodyHtml: string,
  injectorResult: InjectorResult,
  options: AssemblyOptions = {}
): AssemblyResult {
  const title = options.title || 'SelDiA Document';

  let finalBody = bodyHtml;

  // Generate and prepend TOC if requested and enough diagrams
  let tocHtml = '';
  if (options.generateToc !== false) {
    const headings = extractHeadings(bodyHtml);
    tocHtml = generateToc(headings, injectorResult.diagrams, {
      minDiagrams: options.tocMinDiagrams ?? 3,
    });
  }

  // Add diagram anchors for TOC links
  if (tocHtml) {
    for (const d of injectorResult.diagrams) {
      const diagramAnchor = `seldia-diagram-${d.index}`;
      finalBody = finalBody.replace(
        `<div class="seldia-diagram" data-block-idx="${d.index}">`,
        `<div class="seldia-diagram" id="${diagramAnchor}" data-block-idx="${d.index}">`
      );
    }

    // Prepend TOC after the first <h1> or at the beginning
    const firstH1 = finalBody.indexOf('<h1');
    if (firstH1 >= 0) {
      const afterH1 = finalBody.indexOf('</h1>', firstH1);
      if (afterH1 >= 0) {
        const afterClose = afterH1 + 5;
        // Insert TOC after the first h1
        finalBody = finalBody.slice(0, afterClose) + '\n' + tocHtml + '\n' + finalBody.slice(afterClose);
      } else {
        finalBody = tocHtml + '\n' + finalBody;
      }
    } else {
      finalBody = tocHtml + '\n' + finalBody;
    }
  }

  const metadata = options.metadata || {};
  const metaTags = [
    metadata.author ? `<meta name="author" content="${escapeHtml(metadata.author)}">` : '',
    metadata.subject ? `<meta name="subject" content="${escapeHtml(metadata.subject)}">` : '',
    metadata.description ? `<meta name="description" content="${escapeHtml(metadata.description)}">` : '',
    metadata.keywords?.length ? `<meta name="keywords" content="${escapeHtml(metadata.keywords.join(', '))}">` : '',
  ].filter(Boolean).join('\n  ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${metaTags}
  <style>
    ${PRINT_CSS}
    ${options.customCss || ''}
  </style>
</head>
<body>
${finalBody}
</body>
</html>`;

  // Rough page estimate: ~3000 chars per page for A4 with 25mm margins
  const estimatedPages = Math.max(1, Math.ceil(html.length / 3000));

  return { html, estimatedPages };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
