// =============================================================================
// SelDiA — LSP Diagnostics Provider
// =============================================================================
// Provides real-time error/warning diagnostics for .sld files
// and ```seldia code blocks in Markdown.

import * as vscode from 'vscode';
import type { CoreEngine, Diagnostic as SelDiADiagnostic } from '@seldia/core';
import { DiagnosticSeverity as SelDiASeverity } from '@seldia/core';

/**
 * Provides live diagnostics for SelDiA DSL files.
 * Runs validation on document change (debounced).
 */
export class SelDiADiagnosticsProvider {
  private engine: CoreEngine;
  private diagnosticCollection: vscode.DiagnosticCollection;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(engine: CoreEngine) {
    this.engine = engine;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('seldia');
  }

  /**
   * Register document change listeners for .sld files.
   */
  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.diagnosticCollection);

    // Listen for document changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId !== 'seldia') return;
        this.scheduleValidate(event.document);
      })
    );

    // Listen for document saves
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId !== 'seldia') return;
        this.validateDocument(document);
      })
    );

    // Validate open .sld documents on activation
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === 'seldia') {
        this.validateDocument(editor.document);
      }
    }

    // Also validate when active editor changes to a .sld file
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'seldia') {
          this.validateDocument(editor.document);
        }
      })
    );
  }

  /**
   * Debounced validation — waits 400ms after the last edit.
   */
  private scheduleValidate(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.validateDocument(document);
      }, 400)
    );
  }

  /**
   * Run validation on a document and publish diagnostics.
   */
  private validateDocument(document: vscode.TextDocument): void {
    const source = document.getText();
    const filePath = document.uri.fsPath;

    // Run validation through the engine
    const diagnostics = this.engine.validate(source, filePath);

    // Convert to VS Code diagnostics
    const vscodeDiagnostics: vscode.Diagnostic[] = diagnostics.map((d) =>
      this.toVSCodeDiagnostic(d, document)
    );

    // Syntax is clean → add the diagram type's own semantic checks (e.g. a
    // `table`'s invalid `^`/`<` merges). These degrade at render time rather
    // than failing the compile, so they are warnings on the offending line.
    if (!diagnostics.length) {
      const ast = this.engine.parse(source, filePath);
      if (ast.ok) {
        for (const d of this.engine.validateSemantics(ast.value)) {
          if (d.line === undefined) continue; // no location to point at
          const line = Math.min(Math.max(0, (d.line ?? 1) - 1), document.lineCount - 1);
          const diag = new vscode.Diagnostic(
            document.lineAt(line).range,
            d.message,
            d.severity === 'error' ? vscode.DiagnosticSeverity.Error
              : d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Information,
          );
          diag.source = 'seldia';
          vscodeDiagnostics.push(diag);
        }
      }
    }

    this.diagnosticCollection.set(document.uri, vscodeDiagnostics);
  }

  /**
   * Convert a SelDiA Diagnostic to a VS Code Diagnostic.
   */
  private toVSCodeDiagnostic(
    d: SelDiADiagnostic,
    document: vscode.TextDocument
  ): vscode.Diagnostic {
    let range: vscode.Range;

    if (d.source) {
      // Use source location from the parser
      const startLine = Math.max(0, (d.source.startLine || 1) - 1);
      const startCol = Math.max(0, (d.source.startColumn || 1) - 1);
      const endLine = Math.max(startLine, (d.source.endLine || startLine + 1) - 1);
      const endCol = d.source.endColumn
        ? Math.max(startCol, d.source.endColumn - 1)
        : startCol + 10;

      range = new vscode.Range(startLine, startCol, endLine, endCol);
    } else {
      // Fallback: highlight the first line
      range = new vscode.Range(0, 0, 0, document.lineAt(0).text.length);
    }

    const severity =
      d.severity === SelDiASeverity.ERROR
        ? vscode.DiagnosticSeverity.Error
        : d.severity === SelDiASeverity.WARNING
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

    const diagnostic = new vscode.Diagnostic(range, d.message, severity);
    diagnostic.source = 'seldia';
    diagnostic.code = d.code;

    return diagnostic;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.diagnosticCollection.dispose();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
