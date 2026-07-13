// =============================================================================
// SelDiA — Markdown CodeLens Provider
// =============================================================================
// Adds "View Diagram" / "Edit Code" CodeLens actions above SelDiA blocks.

import * as vscode from 'vscode';
import type { SelDiABlock } from './detector.js';

export class SelDiACodeLensProvider implements vscode.CodeLensProvider {
  private blocks: SelDiABlock[] = [];
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /**
   * Update the block list and fire change event.
   */
  updateBlocks(blocks: SelDiABlock[]): void {
    this.blocks = blocks;
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    if (!document.fileName.endsWith('.md') && !document.fileName.endsWith('.mdx') && !document.fileName.endsWith('.rst')) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];

    for (const block of this.blocks) {
      // "View Diagram" lens at the opening fence line
      const startLine = new vscode.Position(block.startLine, 0);
      const startRange = new vscode.Range(startLine, startLine);

      lenses.push(new vscode.CodeLens(startRange, {
        title: '🔍 View Diagram',
        command: 'seldia.openPreview',
        arguments: [block.source],
        tooltip: 'Open this SelDiA diagram in a preview panel',
      }));

      lenses.push(new vscode.CodeLens(startRange, {
        title: block.rendered ? '✏️ Edit Code' : '▶ Render',
        command: block.rendered ? 'seldia.toggleView' : 'seldia.openPreview',
        tooltip: block.rendered ? 'Switch to code view' : 'Render this diagram',
      }));

      // "Export" lens
      lenses.push(new vscode.CodeLens(startRange, {
        title: '📥 Export',
        command: 'seldia.exportDiagram',
        arguments: [block.source],
        tooltip: 'Export this diagram as SVG',
      }));
    }

    return lenses;
  }

  resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.CodeLens {
    return codeLens;
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
