// =============================================================================
// SelDiA — Markdown Inline Diagram Decorator
// =============================================================================
// Renders SelDiA code blocks inline as diagrams. Each fenced ```seldia block
// is replaced visually with a compact header + the rendered diagram SVG.
// Hover shows a full-size preview; CodeLens provides "View Diagram" / "Edit".

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import type { SelDiABlock } from './detector.js';
import { ICON_SPRITE, icon } from '../shared/icons.js';

export class SelDiADecorator {
  /**
   * Decoration that overlays the entire fenced code block with a styled
   * container showing the rendered diagram inline.
   */
  private decorationType: vscode.TextEditorDecorationType;
  private engine: CoreEngine;
  private decorationMap = new Map<string, vscode.DecorationOptions[]>();

  constructor(engine: CoreEngine) {
    this.engine = engine;

    this.decorationType = vscode.window.createTextEditorDecorationType({
      // ── Before: rendered diagram header + SVG ────────────────────────
      before: {
        contentText: '',
        margin: '0',
        backgroundColor: 'transparent',
      },
      // ── After: spacer ────────────────────────────────────────────────
      after: {
        contentText: '',
        margin: '0 0 8px 0',
      },
      overviewRulerColor: '#3498db',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      light: {
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
      },
      dark: {
        backgroundColor: '#0f172a66',
        border: '1px solid #334155',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }

  /**
   * Update decorations for the given editor with detected SelDiA blocks.
   * Each block gets an inline rendered diagram shown in its place.
   */
  async updateDecorations(editor: vscode.TextEditor, blocks: SelDiABlock[]): Promise<void> {
    const options: vscode.DecorationOptions[] = [];

    for (const block of blocks) {
      const result = await this.engine.compile(block.source);

      // ── Build the rendered SVG (or error message) ────────────────────
      let svgContent: string;
      let statusIcon: string;
      let statsLine: string;

      if (result.ok) {
        svgContent = result.value.svg;
        // `contentText` on a TextEditorDecorationType only supports plain
        // text (no HTML/SVG — see the comment below), so this stays a
        // plain-text status marker rather than the icon sprite used
        // elsewhere; deliberately not an emoji either.
        statusIcon = '[OK]';
        statsLine = `Nodes: ${result.value.stats?.nodeCount ?? '?'} · Edges: ${result.value.stats?.edgeCount ?? '?'}`;
      } else {
        const msgs = result.errors.map(e => e.message).join('; ');
        // This whole string is base64-encoded and rendered via an <img
        // src="data:image/svg+xml;..."> — i.e. parsed as a standalone SVG
        // document with no access to the sprite defined elsewhere, so the
        // error icon must be a fully self-contained inline <svg>, not a
        // `$(codicon)` (HTML-only) or a `<use>` sprite reference.
        const errorIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" style="vertical-align:-2px"><circle cx="12" cy="12" r="9" fill="none" stroke="#e53e3e" stroke-width="2"/><path d="M12 7v6" stroke="#e53e3e" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.1" fill="#e53e3e"/></svg>';
        svgContent = `<div xmlns="http://www.w3.org/1999/xhtml" style="color:#e53e3e;padding:12px;background:#fff5f5;border-radius:6px;font-family:monospace;font-size:12px;white-space:pre-wrap">${errorIconSvg} ${msgs}</div>`;
        statusIcon = '[ERR]';
        statsLine = 'Compilation failed';
      }

      // SVG needs to be base64-encoded so it can be used as a data-URI in
      // the hover markdown (allows full-size viewing on hover).
      const svgBase64 = Buffer.from(svgContent).toString('base64');
      const dataUri = `data:image/svg+xml;base64,${svgBase64}`;

      // ── Hover: full-size diagram in a tooltip ────────────────────────
      const hoverMd = new vscode.MarkdownString();
      hoverMd.supportHtml = true;
      hoverMd.isTrusted = true;
      hoverMd.supportThemeIcons = true;
      // Hover tooltips render through VS Code's Markdown hover widget, not a
      // full webview — <svg>/<use> support there is unreliable, so this
      // uses a Codicon (natively supported in hover Markdown via
      // `$(icon-id)`) rather than the SVG icon sprite used in webviews.
      hoverMd.value = [
        `<div style="min-width:480px;max-width:800px;padding:12px">`,
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;color:#666;border-bottom:1px solid #e2e8f0;padding-bottom:8px">`,
        `<span><b>$(type-hierarchy) ${block.diagramType}</b> · #${block.index + 1}</span>`,
        `<span>${statsLine}</span>`,
        `</div>`,
        `<div style="background:#fff;border-radius:6px;overflow:auto;text-align:center">`,
        `<img src="${dataUri}" style="max-width:100%;height:auto" alt="SelDiA diagram" />`,
        `</div>`,
        `</div>`,
      ].join('\n');

      // ── Decoration: render a visual diagram card inline ──────────────
      // We use the `before` content of the first line to show a rendered
      // diagram card, and the block's background highlights it.
      const startPos = new vscode.Position(block.startLine, 0);
      const singleLineRange = new vscode.Range(startPos, startPos);

      // Build the "before" content as a textual representation that
      // mimics a mini diagram card (VS Code decorations can only show
      // plain text, not HTML — so we use Unicode art + the hover for
      // the real rendered view).
      const nodeCount = result.ok ? (result.value.stats?.nodeCount ?? '?') : '—';
      const edgeCount = result.ok ? (result.value.stats?.edgeCount ?? '?') : '—';

      options.push({
        range: singleLineRange,
        hoverMessage: hoverMd,
        renderOptions: {
          before: {
            contentText: [
              `┌─ ${statusIcon} ${block.diagramType} — ${statsLine} ─────────────────────────────┐`,
              `│  Hover to preview · Ctrl+click to open                  │`,
              `└──────────────────────────────────────────────────────────┘`,
            ].join('\n'),
            backgroundColor: 'transparent',
            margin: '4px 0 2px 0',
            fontWeight: 'normal',
            color: '#888',
          },
        },
      });
    }

    editor.setDecorations(this.decorationType, options);
    this.decorationMap.set(editor.document.uri.toString(), options);
  }

  /**
   * Clear decorations for the given editor.
   */
  clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
    this.decorationMap.delete(editor.document.uri.toString());
  }

  /**
   * Dispose the decorator.
   */
  dispose(): void {
    this.decorationType.dispose();
    this.decorationMap.clear();
  }
}
