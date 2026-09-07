// =============================================================================
// SelDiA — Marp Deck Export (PPTX)
// =============================================================================
// One slide-sized PNG per slide, placed edge-to-edge in a pptxgenjs deck.
//
// This mirrors what `marp-cli --pptx` does by default (it also screenshots each
// slide with Puppeteer and lays the images out with pptxgenjs), with one
// difference that is the whole point: we render through SelDiA's own Marp
// pipeline, so ```seldia / ```mermaid / ```plantuml fences come out as real
// diagrams instead of code blocks. marp-cli runs its own Marp Core in a
// separate process and has never heard of our fence renderer.
//
// marp-cli's `--pptx-editable` produces text-based slides, but only by shelling
// out to a local LibreOffice install, which we can't require of users.
// =============================================================================

import PptxGenJS from 'pptxgenjs';
import type { CoreEngine } from '@seldia/core';
import { renderMarpDeck, assembleMarpDocument } from './render.js';
import type { MarpExportResult } from './export.js';

/** PPTX export reports the same shape as the HTML/PDF exporters, so the
 *  `seldia.exportMarp` command can treat all three results identically. */
export type MarpPptxResult = MarpExportResult;

export interface MarpPptxOptions {
  /** Rasterization scale. 2 = retina-sharp on projectors. */
  scale?: number;
  /** Include per-slide speaker notes. Default true. */
  includeNotes?: boolean;
  timeout?: number;
}

/** Marp writes its slide size into its own stylesheet as
 *  `@page {size:1280px 720px;margin:0}`. Read it rather than hardcoding, so
 *  4:3 decks and `size: 4K` directives produce correctly-shaped PPTX slides. */
export function readSlideSize(css: string): { width: number; height: number } {
  const m = /@page\s*{[^}]*\bsize:\s*([0-9.]+)px\s+([0-9.]+)px/.exec(css);
  if (!m) return { width: 1280, height: 720 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

export async function exportMarpToPptx(
  engine: CoreEngine,
  markdown: string,
  outputPath: string,
  title?: string,
  options: MarpPptxOptions = {}
): Promise<MarpPptxResult> {
  let rendered;
  try {
    rendered = renderMarpDeck(engine, markdown);
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }

  const { width, height } = readSlideSize(rendered.css);
  const doc = assembleMarpDocument(rendered.html, rendered.css, title);

  let shots: string[];
  try {
    shots = await captureSlides(doc, width, height, options);
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }

  if (shots.length === 0) {
    return { success: false, errorMessage: 'No slides were found in this deck.' };
  }

  try {
    const pptx = new PptxGenJS();

    // PPTX geometry is in inches. Pin a custom layout matching the deck's own
    // aspect ratio at 96dpi so images fill the slide with no letterboxing.
    const wIn = width / 96;
    const hIn = height / 96;
    pptx.defineLayout({ name: 'SELDIA', width: wIn, height: hIn });
    pptx.layout = 'SELDIA';
    if (title) pptx.title = title;

    // Notes are indexed by Marp's own per-slide `comments` array, while the
    // images come from a DOM query. Those agree in practice, but if they ever
    // diverge (unexpected markup, a Marp change) pairing them by index would
    // silently staple notes onto the wrong slides. Only attach notes when the
    // two counts confirm each other.
    const notesAligned = rendered.notes.length === shots.length;
    const includeNotes = options.includeNotes !== false && notesAligned;

    shots.forEach((data, i) => {
      const slide = pptx.addSlide();
      slide.addImage({ data, x: 0, y: 0, w: wIn, h: hIn });
      const note = includeNotes ? rendered.notes[i] : '';
      if (note) slide.addNotes(note);
    });

    await pptx.writeFile({ fileName: outputPath });
    return { success: true, outputPath, slideCount: shots.length };
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }
}

/** Screenshot each top-level slide, returning base64 PNG data URIs. */
async function captureSlides(
  html: string,
  width: number,
  height: number,
  options: MarpPptxOptions
): Promise<string[]> {
  let puppeteer: any;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    throw new Error('Puppeteer is not installed. Run: npm install puppeteer');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: options.scale ?? 2,
    });
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: options.timeout ?? 60000,
    });

    // Marp emits either <svg data-marpit-svg> wrappers or bare <section>s
    // depending on the `inlineSVG` setting, always as direct children of the
    // single outer div.marpit. Selecting on those direct children avoids
    // counting <svg>/<section> markup *inside* a rendered diagram.
    const slides = await page.$$(
      'div.marpit > svg[data-marpit-svg], div.marpit > section'
    );

    const out: string[] = [];
    for (const el of slides) {
      const buf = await el.screenshot({ type: 'png' });
      out.push(`image/png;base64,${Buffer.from(buf).toString('base64')}`);
    }
    return out;
  } finally {
    await browser.close();
  }
}
