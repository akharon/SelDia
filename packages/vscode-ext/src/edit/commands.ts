// =============================================================================
// SelDiA — Markdown Preview Source Navigation
// =============================================================================
// The built-in Markdown preview is a webview this extension does not own: it
// exposes no postMessage channel to contributed scripts, and it is created
// without `enableCommandUris`, so `command:` links from it are silently
// discarded. The only working preview -> host channel is a
// `vscode://<extension-id>/<action>` deep link routed to a registered
// UriHandler.
//
// That channel is fine for one-shot navigation ("reveal this block in the
// editor") but was not viable for visual editing: a drag had to encode
// coordinates into a URL, correlate them back to a fence by hashing the DSL
// source, and patch the document — after which the re-render changed the
// source, and therefore the hash, invalidating the very block identity the
// edit depended on. Visual editing lives in the custom editor
// (SelDiAInteractiveProvider) instead, whose webview we own and can
// postMessage. In the Markdown preview, layout is automatic and the DSL is
// edited in the raw file.
// =============================================================================

import * as vscode from 'vscode';
import { findSelDiABlocks, findBlockById, type SelDiABlockLoc } from './blocks.js';

/** Locate the Markdown document that contains the block with `blockId`.
 *
 *  `docUri` is authoritative: the markdown-it plugin gets the source document's
 *  Uri from the preview's render env (`env.currentDocument`) and stamps it into
 *  every deep link, so we never have to guess which file the preview is showing.
 *  This matters because when the preview has focus there is no active text
 *  editor, and the document may not be open in any visible editor at all.
 *  `openTextDocument` resolves the file whether or not it has an editor. */
export async function findDocWithBlock(
  blockId: string,
  docUri?: string
): Promise<{ doc: vscode.TextDocument; block: SelDiABlockLoc } | undefined> {
  if (docUri) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(docUri));
      const block = findBlockById(doc.getText(), blockId);
      if (block) return { doc, block };
    } catch {
      // Fall through to the scan below (e.g. untitled doc that was closed).
    }
  }

  // Fallback for blocks rendered before the doc uri was stamped, or when the
  // uri no longer resolves: scan every open Markdown document for the block id.
  const candidates = vscode.workspace.textDocuments.filter(
    (d) => d.languageId === 'markdown' || /\.(md|mdx|rst)$/.test(d.fileName)
  );
  const active = vscode.window.activeTextEditor?.document;
  if (active && !candidates.includes(active) && /\.(md|mdx|rst)$/.test(active.fileName)) {
    candidates.unshift(active);
  }
  for (const doc of candidates) {
    const block = findBlockById(doc.getText(), blockId);
    if (block) return { doc, block };
  }
  return undefined;
}

/** Actions the preview may invoke over the `vscode://` deep-link channel.
 *  `editBlockVisually` opens the block in the custom editor (its own owned
 *  webview) rather than editing through this channel — see the header for
 *  why in-place editing here was never viable. */
export const EDIT_URI_ACTIONS = new Set(['revealSource', 'editBlockVisually']);

export function registerEditCommands(context: vscode.ExtensionContext): void {
  const handler = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri) {
      // uri.path is like "/revealSource"; uri.query is a urlencoded param string.
      const action = uri.path.replace(/^\/+/, '');
      if (!EDIT_URI_ACTIONS.has(action)) return;

      const params = new URLSearchParams(uri.query);
      const args: Record<string, unknown> = {};
      for (const [k, v] of params) args[k] = v;

      void vscode.commands.executeCommand(`seldia.${action}`, args);
    },
  });
  context.subscriptions.push(handler);
}

// Re-export for tests / callers that want block discovery.
export { findSelDiABlocks };
