// =============================================================================
// SelDiA — Language Server Entry Point
// =============================================================================
// Registers all LSP providers for the `sld` language.

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';
import { SelDiADiagnosticsProvider } from './diagnostics.js';
import { SelDiACompletionProvider } from './completion.js';
import { SelDiAHoverProvider } from './hover.js';
import { SelDiADefinitionProvider } from './definition.js';
import { SelDiADocumentSymbolProvider } from './symbols.js';

export function registerLanguageServer(
  context: vscode.ExtensionContext,
  engine: CoreEngine
): void {
  // ── Diagnostics ──────────────────────────────────────────────────────────
  const diagnosticsProvider = new SelDiADiagnosticsProvider(engine);
  diagnosticsProvider.register(context);

  // ── Completion ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'seldia', scheme: 'file' },
      new SelDiACompletionProvider(engine),
      '.', ' ', ':', '"', "'", '(', ')', '[', ']', '{', '}', '<', '>', '-'
    )
  );

  // ── Hover ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'seldia', scheme: 'file' },
      new SelDiAHoverProvider(engine)
    )
  );

  // ── Go-to-Definition ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'seldia', scheme: 'file' },
      new SelDiADefinitionProvider(engine)
    )
  );

  // ── Document Symbols ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'seldia', scheme: 'file' },
      new SelDiADocumentSymbolProvider(engine)
    )
  );

  console.log('SelDiA language server registered (sld)');
}


