// =============================================================================
// SelDiA — MD→PDF Export Public API
// =============================================================================
// Entry point for the Markdown → PDF export pipeline.

import type { CoreEngine } from '@seldia/core';
import { runPipeline } from './pipeline.js';
import type { Md2PdfOptions, Md2PdfResult } from './types.js';

export type { Md2PdfOptions, Md2PdfResult } from './types.js';
export { runPipeline } from './pipeline.js';

/**
 * Export a Markdown file with SelDiA diagrams to PDF.
 *
 * This is the main public API for the MD→PDF feature.
 * It orchestrates the full pipeline: parse markdown → compile diagrams →
 * assemble HTML → render PDF via Puppeteer.
 */
export async function exportMarkdownToPdf(
  markdown: string,
  options: Md2PdfOptions,
  engine: CoreEngine
): Promise<Md2PdfResult> {
  return runPipeline(markdown, options, engine);
}
