// =============================================================================
// SelDiA — MD→PDF Diagram Injector
// =============================================================================
// Replaces ```seldia placeholder markers in HTML with compiled SVG content.

import type { CoreEngine, Diagnostic } from '@seldia/core';
import { renderErrorBlock } from './error-handler.js';
import type { DetectedBlock } from './markdown-parser.js';
import { anchorForDiagram, captionFor, titleFromDsl } from '../markdown-preview/numbering.js';

export interface InjectorResult {
  /** HTML with SVG diagrams injected */
  html: string;
  /** Total number of diagrams processed */
  diagramCount: number;
  /** Number of diagrams that failed to compile */
  errorCount: number;
  /** Captionable diagram data for TOC */
  diagrams: Array<{ index: number; title: string; type: string; hasError: boolean }>;
}

/**
 * Process all detected SelDiA blocks: compile each one and inject the
 * resulting SVG (or error box) into the HTML.
 */
export async function injectDiagrams(
  html: string,
  blocks: DetectedBlock[],
  engine: CoreEngine,
  theme: string,
  sketchy: boolean
): Promise<InjectorResult> {
  let resultHtml = html;
  let errorCount = 0;
  const diagrams: InjectorResult['diagrams'] = [];

  for (const block of blocks) {
    const placeholder = `<!--SELDIA_BLOCK_${block.index}-->`;

    // Compile the DSL source
    const compileResult = await engine.compile(block.dslSource);

    let injectedHtml: string;

    if (compileResult.ok) {
      const svg = compileResult.value.svg;
      const renderResult = compileResult.value;
      const stats = renderResult.stats;

      // Diagram numbering is 1-based (DetectedBlock.index is 0-based); this
      // stays aligned with the built-in preview's `Diagram N` / `id="diagram-N"`
      // convention so a document reads the same in both.
      const n = block.index + 1;
      const anchor = anchorForDiagram(n);
      const title = titleFromDsl(block.dslSource) || '';

      diagrams.push({
        index: block.index,
        title,
        type: block.diagramType,
        hasError: false,
      });

      const typeBadge = `<span class="seldia-diagram__type-badge">${escapeHtml(block.diagramType)}</span>`;

      injectedHtml = `
<div class="seldia-diagram" id="${anchor}" data-block-idx="${block.index}">
  <div class="seldia-diagram__header">
    <span>${escapeHtml(title || `${block.diagramType} diagram`)}</span>
    ${typeBadge}
  </div>
  ${svg}
  <div class="seldia-diagram__caption">
    ${escapeHtml(captionFor(n, title))}
    ${stats ? `<span style="float:right;font-size:8pt;color:#a8a29e;">${stats.nodeCount} nodes · ${stats.edgeCount} edges</span>` : ''}
  </div>
</div>`;
    } else {
      // Render error block
      const errors = compileResult.errors || [];
      errorCount++;
      const errResult = renderErrorBlock(block.index, block.dslSource, errors as Diagnostic[], block.diagramType);
      injectedHtml = errResult.html;

      diagrams.push({
        index: block.index,
        title: '',
        type: block.diagramType,
        hasError: true,
      });
    }

    resultHtml = resultHtml.replace(placeholder, injectedHtml);
  }

  return {
    html: resultHtml,
    diagramCount: blocks.length,
    errorCount,
    diagrams,
  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
