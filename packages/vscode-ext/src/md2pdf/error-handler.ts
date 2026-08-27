// =============================================================================
// SelDiA — MD→PDF Error Handler
// =============================================================================
// Provides error fallback rendering for diagrams that fail to compile.

import type { Diagnostic } from '@seldia/core';
import { anchorForDiagram } from '../markdown-preview/numbering.js';

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

  // Self-contained inline SVG — this HTML is rendered standalone by
  // Puppeteer into a printed PDF, with no access to VS Code's Codicon font
  // or the webview icon sprite.
  const errorIcon = '<svg width="12" height="12" viewBox="0 0 24 24" style="vertical-align:-1px"><circle cx="12" cy="12" r="9" fill="none" stroke="#dc2626" stroke-width="2"/><path d="M12 7v6" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.1" fill="#dc2626"/></svg>';

  return {
    html: `
<div class="seldia-diagram seldia-diagram--error" id="${anchorForDiagram(blockIndex + 1)}" data-block-idx="${blockIndex}">
  <div class="error-title">${errorIcon} Diagram Compilation Failed${diagramType ? ` (${escapeHtml(diagramType)})` : ''}</div>
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
  const warningIcon = '<svg width="12" height="12" viewBox="0 0 24 24" style="vertical-align:-1px"><path d="M12 3 2 21h20L12 3Z" fill="none" stroke="#92400e" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4" stroke="#92400e" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1" fill="#92400e"/></svg>';
  return `<div class="seldia-diagram" style="background:#fffbeb;border-color:#fcd34d;color:#92400e;padding:12px;font-size:10pt;">
  ${warningIcon} ${escapeHtml(message)}
</div>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
