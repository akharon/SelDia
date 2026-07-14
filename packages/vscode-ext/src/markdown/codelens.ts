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

      // CodeLens titles render VS Code's own Codicon set via `$(icon-id)` —
      // the native mechanism here (not the SVG sprite used in HTML
      // webviews), so these already match VS Code's chrome without any
      // vendored assets. docs/improvement_request.md items 1 and 5.
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(eye) Preview Diagram',
        command: 'markdown.showPreviewToSide',
        tooltip: 'Open the Markdown preview to see this diagram rendered inline',
      }));

      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(play) Render',
        command: 'markdown.showPreview',
        tooltip: 'Render this diagram in the Markdown preview',
      }));

      // "Export" lens
      lenses.push(new vscode.CodeLens(startRange, {
        title: '$(desktop-download) Export',
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
