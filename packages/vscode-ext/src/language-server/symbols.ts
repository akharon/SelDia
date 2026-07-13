// =============================================================================
// SelDiA — LSP Document Symbols Provider
// =============================================================================
// Provides an outline view of the SelDiA document:
//   - Diagram blocks (top-level)
//   - Node declarations
//   - Edge declarations
//   - Groups
//   - Sections
//   - Participants / Entities / Classes

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';

// ── Document Symbols Provider ───────────────────────────────────────────────

export class SelDiADocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  private engine: CoreEngine;

  constructor(engine: CoreEngine) {
    this.engine = engine;
  }

  async provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    const symbols: vscode.DocumentSymbol[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Track diagram blocks for nesting
    const diagramStack: { symbol: vscode.DocumentSymbol; depth: number }[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const trimmed = line.trim();

      // ── Diagram declaration ─────────────────────────────────────────────
      const diagramMatch = trimmed.match(/^diagram\s+(\w+)(?:\s+"([^"]*)")?/);
      if (diagramMatch) {
        const type = diagramMatch[1];
        const title = diagramMatch[2] || type;
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.length);
        const symbol = new vscode.DocumentSymbol(
          title,
          `diagram ${type}`,
          vscode.SymbolKind.Module,
          range,
          range
        );
        symbols.push(symbol);
        diagramStack.push({ symbol, depth: this.getBraceDepth(line) });
        continue;
      }

      // ── Node declaration ────────────────────────────────────────────────
      const nodeMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*:\s*(\S+)(?:\s+"([^"]*)")?/);
      if (nodeMatch && !trimmed.startsWith('//')) {
        const id = nodeMatch[1];
        const label = nodeMatch[3] || id;
        const shape = nodeMatch[2];
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.length);
        const symbol = new vscode.DocumentSymbol(
          label,
          `node (${shape}) — ${id}`,
          vscode.SymbolKind.Variable,
          range,
          range
        );

        // Attach to parent diagram if within one
        const parent = this.findEnclosingDiagram(symbols, diagramStack, lineIdx);
        if (parent) {
          parent.children.push(symbol);
        } else {
          symbols.push(symbol);
        }
        continue;
      }

      // ── Participant declaration (sequence) ──────────────────────────────
      const partMatch = trimmed.match(/^participant\s+(\w+)\s*:\s*"([^"]*)"/);
      if (partMatch) {
        const id = partMatch[1];
        const label = partMatch[2];
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.length);
        const symbol = new vscode.DocumentSymbol(
          label,
          `participant ${id}`,
          vscode.SymbolKind.Interface,
          range,
          range
        );
        const parent = this.findEnclosingDiagram(symbols, diagramStack, lineIdx);
        if (parent) parent.children.push(symbol);
        else symbols.push(symbol);
        continue;
      }

      // ── Entity declaration (ER) ─────────────────────────────────────────
      const entityMatch = trimmed.match(/^entity\s+(\w+)/);
      if (entityMatch) {
        const name = entityMatch[1];
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.length);
        const symbol = new vscode.DocumentSymbol(
          name,
          'entity',
          vscode.SymbolKind.Class,
          range,
          range
        );
        const parent = this.findEnclosingDiagram(symbols, diagramStack, lineIdx);
        if (parent) parent.children.push(symbol);
        else symbols.push(symbol);
        continue;
      }

      // ── Edge declaration ────────────────────────────────────────────────
      const edgeMatch = trimmed.match(/^([\w]+)\s*(-->|<--|<-->|---|\.\.>|==>|\.\.)\s*([\w]+)/);
      if (edgeMatch && !trimmed.startsWith('//') && !trimmed.startsWith('participant')) {
        const src = edgeMatch[1];
        const arrow = edgeMatch[2];
        const tgt = edgeMatch[3];
        const label = `${src} ${arrow} ${tgt}`;
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.length);
        const symbol = new vscode.DocumentSymbol(
          label,
          'edge',
          vscode.SymbolKind.Event,
          range,
          range
        );
        const parent = this.findEnclosingDiagram(symbols, diagramStack, lineIdx);
        if (parent) parent.children.push(symbol);
        else symbols.push(symbol);
        continue;
      }

      // ── Group declaration ───────────────────────────────────────────────
      const groupMatch = trimmed.match(/^group\s+"([^"]*)"\s*{/);
      if (groupMatch) {
        const name = groupMatch[1];
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.length);
        const symbol = new vscode.DocumentSymbol(
          name,
          'group',
          vscode.SymbolKind.Struct,
          range,
          range
        );
        const parent = this.findEnclosingDiagram(symbols, diagramStack, lineIdx);
        if (parent) parent.children.push(symbol);
        else symbols.push(symbol);
        continue;
      }

      // ── Section declaration (gantt/mindmap) ─────────────────────────────
      const sectionMatch = trimmed.match(/^section\s+"([^"]*)"\s*{/);
      if (sectionMatch) {
        const name = sectionMatch[1];
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.length);
        const symbol = new vscode.DocumentSymbol(
          name,
          'section',
          vscode.SymbolKind.Namespace,
          range,
          range
        );
        const parent = this.findEnclosingDiagram(symbols, diagramStack, lineIdx);
        if (parent) parent.children.push(symbol);
        else symbols.push(symbol);
        continue;
      }
    }

    return symbols;
  }

  /**
   * Calculate brace depth from a line (to track diagram nesting).
   */
  private getBraceDepth(line: string): number {
    let depth = 0;
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    return depth;
  }

  /**
   * Find the diagram symbol that contains the given line index.
   */
  private findEnclosingDiagram(
    rootSymbols: vscode.DocumentSymbol[],
    diagramStack: { symbol: vscode.DocumentSymbol; depth: number }[],
    lineIdx: number
  ): vscode.DocumentSymbol | null {
    // Simple approach: find the last diagram whose range contains this line
    for (const diagram of rootSymbols) {
      if (diagram.kind === vscode.SymbolKind.Module) {
        const parentRange = diagram.range;
        if (parentRange.start.line <= lineIdx && parentRange.end.line >= lineIdx) {
          return diagram;
        }
      }
    }
    return null;
  }
}
