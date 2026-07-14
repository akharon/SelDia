// =============================================================================
// SelDiA — MD→PDF Pipeline
// =============================================================================
// Orchestrates: parse Markdown → compile diagrams → assemble HTML → render PDF.

import type { CoreEngine } from '@seldia/core';
import { parseMarkdown } from './markdown-parser.js';
import { injectDiagrams } from './diagram-injector.js';
import { assembleHtml } from './html-assembler.js';
import { renderPdf } from './pdf-renderer.js';
import { createProgressReporter } from './progress-reporter.js';
import type { Md2PdfOptions, Md2PdfResult } from './types.js';

export async function runPipeline(
  markdown: string,
  options: Md2PdfOptions,
  engine: CoreEngine
): Promise<Md2PdfResult> {
  const startTime = Date.now();
  const reporter = createProgressReporter();

  try {
    // Stage 1: Parse Markdown
    reporter.report({ stage: 'Parsing Markdown', percentage: 10 });
    const { html: parsedHtml, blocks } = parseMarkdown(markdown);
    reporter.report({ stage: 'Parsing Markdown', percentage: 20, detail: `${blocks.length} diagram(s) found` });

    // Stage 2: Compile diagrams
    reporter.report({ stage: 'Compiling diagrams', percentage: 30 });
    const injectorResult = await injectDiagrams(
      parsedHtml, blocks, engine,
      options.theme || 'sketchy-light',
      options.sketchy !== false
    );
    reporter.report({
      stage: 'Compiling diagrams', percentage: 60,
      detail: `${injectorResult.diagramCount} diagram(s), ${injectorResult.errorCount} error(s)`,
    });

    // Stage 3: Assemble HTML
    reporter.report({ stage: 'Assembling HTML', percentage: 70 });
    const { html: fullHtml } = assembleHtml(injectorResult.html, injectorResult, {
      title: options.metadata?.title || options.inputPath.split('/').pop()?.replace(/\.(md|mdx)$/, ''),
      generateToc: options.generateToc,
      tocMinDiagrams: options.tocMinDiagrams,
      customCss: options.customCss,
      metadata: options.metadata,
    });

    // Stage 4: Render PDF
    const outputPath = options.outputPath || options.inputPath.replace(/\.(md|mdx)$/, '.pdf');
    reporter.report({ stage: 'Rendering PDF', percentage: 85, detail: `Output: ${outputPath}` });

    const pdfResult = await renderPdf(fullHtml, outputPath, {
      format: options.format || 'A4',
      orientation: options.orientation || 'portrait',
      scale: options.scale ?? 1,
      printBackground: options.printBackground !== false,
      margin: options.margin ? {
        top: options.margin.top, right: options.margin.right,
        bottom: options.margin.bottom, left: options.margin.left,
      } : undefined,
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
      timeout: options.timeout,
      showPageNumbers: options.showPageNumbers,
    });

    const durationMs = Date.now() - startTime;

    if (!pdfResult.success) {
      return {
        success: false,
        outputPath: '',
        diagramCount: injectorResult.diagramCount,
        failedDiagrams: [],
        durationMs,
        errors: [{ phase: 'render' as const, message: pdfResult.errorMessage || 'PDF generation failed' }],
      };
    }

    reporter.report({ stage: 'Done', percentage: 100, detail: `$(check) PDF saved to ${outputPath}` });

    return {
      success: true,
      outputPath,
      pageCount: pdfResult.pageCount,
      diagramCount: injectorResult.diagramCount,
      failedDiagrams: injectorResult.errorCount > 0
        ? injectorResult.diagrams
            .filter(d => d.hasError)
            .map(d => ({ blockId: String(d.index), line: 0, title: d.title, error: 'Compilation failed' }))
        : [],
      durationMs,
    };
  } catch (err: any) {
    return {
      success: false,
      outputPath: '',
      diagramCount: 0,
      failedDiagrams: [],
      durationMs: Date.now() - startTime,
      errors: [{ phase: 'assemble' as const, message: `Pipeline failed: ${err.message}` }],
    };
  }
}
