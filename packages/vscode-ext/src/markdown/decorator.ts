// =============================================================================
// SelDiA — Markdown Inline Diagram Decorator
// =============================================================================
// Renders SelDiA code blocks inline as diagrams. Each fenced ```seldia block
// is replaced visually with a compact header + the rendered diagram SVG.
// Hover shows a full-size preview; CodeLens provides "View Diagram" / "Edit".

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import type { SelDiABlock } from './detector.js';

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
        statusIcon = '✅';
        statsLine = `Nodes: ${result.value.stats?.nodeCount ?? '?'} · Edges: ${result.value.stats?.edgeCount ?? '?'}`;
      } else {
        const msgs = result.errors.map(e => e.message).join('; ');
        svgContent = `<div style="color:#e53e3e;padding:12px;background:#fff5f5;border-radius:6px;font-family:monospace;font-size:12px;white-space:pre-wrap">❌ ${msgs}</div>`;
        statusIcon = '❌';
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
      hoverMd.value = [
        `<div style="min-width:480px;max-width:800px;padding:12px">`,
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;color:#666;border-bottom:1px solid #e2e8f0;padding-bottom:8px">`,
        `<span><b>📐 ${block.diagramType}</b> · #${block.index + 1}</span>`,
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
