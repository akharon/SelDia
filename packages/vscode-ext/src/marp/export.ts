// =============================================================================
// SelDiA — Marp Deck Export (HTML / PDF)
// =============================================================================
// HTML export is a direct write of the assembled document. PDF export reuses
// the existing Puppeteer wrapper (md2pdf/pdf-renderer.ts) with Marp's own
// per-slide page size, printing one Marp <section> per PDF page via Marp
// Core's print CSS (`@page` + `size` are already emitted in `css`).
// =============================================================================

import { writeFileSync } from 'fs';
import type { CoreEngine } from '@seldia/core';
import { renderMarpDeck, assembleMarpDocument } from './render.js';
import { renderPdf } from '../md2pdf/pdf-renderer.js';
import type { ProgressReporter } from './browser.js';

export interface MarpExportResult {
  success: boolean;
  outputPath?: string;
  slideCount?: number;
  errorMessage?: string;
}

export function exportMarpToHtml(engine: CoreEngine, markdown: string, outputPath: string, title?: string): MarpExportResult {
  try {
    const { html, css, slideCount } = renderMarpDeck(engine, markdown);
    const doc = assembleMarpDocument(html, css, title);
    writeFileSync(outputPath, doc, 'utf-8');
    return { success: true, outputPath, slideCount };
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }
}

export async function exportMarpToPdf(
  engine: CoreEngine,
  markdown: string,
  outputPath: string,
  title?: string,
  onProgress?: ProgressReporter
): Promise<MarpExportResult> {
  let rendered;
  try {
    rendered = renderMarpDeck(engine, markdown);
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }
  const doc = assembleMarpDocument(rendered.html, rendered.css, title);

  const pdfResult = await renderPdf(doc, outputPath, {
    printBackground: true,
    // Marp's own CSS declares @page size per slide; no header/footer chrome
    // belongs on top of a slide deck.
    headerTemplate: '<span></span>',
    footerTemplate: '<span></span>',
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    onProgress,
  });

  if (!pdfResult.success) {
    return { success: false, errorMessage: pdfResult.errorMessage };
  }
  return { success: true, outputPath, slideCount: rendered.slideCount };
}
