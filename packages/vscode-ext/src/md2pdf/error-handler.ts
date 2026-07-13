// =============================================================================
// SelDiA — MD→PDF Error Handler
// =============================================================================
// Provides error fallback rendering for diagrams that fail to compile.

import type { Diagnostic } from '@seldia/core';

export interface ErrorBlockResult {
  html: string;
  hasError: boolean;
  errorCount: number;
}

/**
 * Generate an error box HTML for a diagram that failed to compile.
 */
export function renderErrorBlock(
  blockIndex: number,
  source: string,
  errors: Diagnostic[],
  diagramType?: string
): ErrorBlockResult {
  const errorLines = errors.map(e => {
    const loc = e.source
      ? `Line ${e.source.startLine}:${e.source.startColumn}`
      : 'unknown location';
    return `<div class="error-line">[${e.severity}] ${loc}: ${escapeHtml(e.message)}</div>`;
  }).join('\n');

  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warnCount = errors.filter(e => e.severity === 'warning').length;

  return {
    html: `
<div class="seldia-diagram seldia-diagram--error" data-block-idx="${blockIndex}">
  <div class="error-title">❌ Diagram Compilation Failed${diagramType ? ` (${escapeHtml(diagramType)})` : ''}</div>
  <div class="error-summary">${errorCount} error(s), ${warnCount} warning(s)</div>
  ${errorLines}
  <details>
    <summary style="cursor:pointer;margin-top:8px;font-size:9pt;color:#666;">Show DSL source</summary>
    <pre style="margin-top:8px;font-size:8pt;">${escapeHtml(source)}</pre>
  </details>
</div>`,
    hasError: true,
    errorCount: errors.length,
  };
}

/**
 * Render a warning banner for non-critical issues.
 */
export function renderWarningBlock(message: string): string {
  return `<div class="seldia-diagram" style="background:#fffbeb;border-color:#fcd34d;color:#92400e;padding:12px;font-size:10pt;">
  ⚠️ ${escapeHtml(message)}
</div>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
