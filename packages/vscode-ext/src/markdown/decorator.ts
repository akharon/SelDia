// =============================================================================
// SelDiA — Markdown Inline SVG Decorator
// =============================================================================
// Replaces discovered SelDiA code blocks with rendered SVG decorations.

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import type { SelDiABlock } from './detector.js';

export class SelDiADecorator {
  private decorationType: vscode.TextEditorDecorationType;
  private engine: CoreEngine;
  private decorationMap = new Map<string, vscode.DecorationOptions[]>();

  constructor(engine: CoreEngine) {
    this.engine = engine;
    this.decorationType = vscode.window.createTextEditorDecorationType({
      before: {
        contentText: '🔄 SelDiA',
        margin: '4px',
        fontWeight: 'bold',
      },
      after: {
        margin: '4px',
      },
      overviewRulerColor: '#3498db',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      light: {
        backgroundColor: '#f0f9ff',
        border: '1px solid #bae6fd',
      },
      dark: {
        backgroundColor: '#0c4a6e33',
        border: '1px solid #0c4a6e',
      },
    });
  }

  /**
   * Update decorations for the given editor with detected SelDiA blocks.
   */
  async updateDecorations(editor: vscode.TextEditor, blocks: SelDiABlock[]): Promise<void> {
    const options: vscode.DecorationOptions[] = [];

    for (const block of blocks) {
      const result = await this.engine.compile(block.source);
      const svgContent = result.ok
        ? result.value.svg
        : `<div style="color:#e53e3e;padding:12px;background:#fff5f5;border-radius:8px;font-family:monospace">❌ ${result.errors.map(e => e.message).join('; ')}</div>`;

      // Create a hover message showing the rendered diagram
      const hoverMarkdown = new vscode.MarkdownString();
      hoverMarkdown.supportHtml = true;
      hoverMarkdown.value = [
        `<div style="min-width:400px;padding:8px">`,
        `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;color:#666">`,
        `<span>📐 ${block.diagramType}</span>`,
        `<span>#${block.index + 1}</span>`,
        `</div>`,
        svgContent,
        `</div>`,
      ].join('\n');

      options.push({
        range: block.range,
        hoverMessage: hoverMarkdown,
        renderOptions: {
          before: {
            contentText: `📐 SelDiA [${block.diagramType}]`,
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
