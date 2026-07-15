// =============================================================================
// SelDiA — Markdown Preview Edit Commands
// =============================================================================
// Command handlers invoked from the built-in Markdown preview (via command:
// URIs) to apply visual edits back to the ```seldia block in the underlying
// Markdown document. All DSL manipulation is delegated to the pure functions
// in ./dsl-edit so the host layer stays thin and the logic stays testable.
// =============================================================================

import * as vscode from 'vscode';
import {
  findSelDiABlocks,
  findBlockById,
  setNodePosition,
  setNodeLabel,
  setNodeAttributes,
  clearAllPositions,
  type SelDiABlockLoc,
} from './dsl-edit.js';

interface NodeRef {
  blockId: string;
  nodeId: string;
  /** Serialized Uri of the Markdown document the preview rendered this block
   *  from. Stamped into every deep link by the markdown-it plugin. */
  doc?: string;
}

/** Locate the Markdown document that contains the block with `blockId`.
 *
 *  `docUri` is authoritative: the markdown-it plugin gets the source document's
 *  Uri from the preview's render env (`env.currentDocument`) and stamps it into
 *  every deep link, so we never have to guess which file the preview is showing.
 *  This matters because when the preview has focus there is no active text
 *  editor, and the document may not be open in any visible editor at all — the
 *  old guess-from-the-editor approach failed in exactly that (very common) case.
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

/** Apply a pure DSL transform to the block, writing a minimal edit that
 *  replaces only the source lines between the fences. */
async function applyBlockTransform(
  blockId: string,
  transform: (source: string) => string,
  docUri?: string
): Promise<boolean> {
  const found = await findDocWithBlock(blockId, docUri);
  if (!found) {
    vscode.window.showWarningMessage('SelDiA: could not locate the diagram source for this edit.');
    return false;
  }
  const { doc, block } = found;
  const newSource = transform(block.source);
  if (newSource === block.source) return false;

  const start = new vscode.Position(block.sourceStartLine, 0);
  // Replace up to the start of the closing fence line (exclusive).
  const end = new vscode.Position(block.sourceEndLine, 0);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(start, end), newSource + '\n');
  // Deliberately does NOT call doc.save(): saving forces VS Code to re-run
  // the whole Markdown preview (every fence block), causing a full-document
  // flicker/blank on every single drag. applyEdit() alone already updates
  // the live document, which the preview picks up via its own file-change
  // listener without a disk write.
  return vscode.workspace.applyEdit(edit);
}

export function registerEditCommands(context: vscode.ExtensionContext): void {
  // ── Move a node (drag in preview) ──────────────────────────────────────
  const moveNode = vscode.commands.registerCommand(
    'seldia.moveNode',
    async (args: NodeRef & { x: number; y: number }) => {
      if (!args?.blockId || !args?.nodeId) return;
      await applyBlockTransform(
        args.blockId,
        (src) => setNodePosition(src, args.nodeId, args.x, args.y),
        args.doc
      );
    }
  );

  // ── Rename a node (double-click in preview) ────────────────────────────
  const editNodeLabel = vscode.commands.registerCommand(
    'seldia.editNodeLabel',
    async (args: NodeRef & { current?: string }) => {
      if (!args?.blockId || !args?.nodeId) return;
      const label = await vscode.window.showInputBox({
        prompt: `Rename node "${args.nodeId}"`,
        value: args.current ?? '',
        ignoreFocusOut: true,
      });
      if (label === undefined) return;
      await applyBlockTransform(
        args.blockId,
        (src) => setNodeLabel(src, args.nodeId, label),
        args.doc
      );
    }
  );

  // ── Edit an arbitrary node attribute (context action) ──────────────────
  const editNodeAttr = vscode.commands.registerCommand(
    'seldia.editNodeAttr',
    async (args: NodeRef) => {
      if (!args?.blockId || !args?.nodeId) return;
      const key = await vscode.window.showQuickPick(
        ['fill', 'stroke', 'strokeWidth', 'roughness', 'fontSize', 'textColor'],
        { placeHolder: `Attribute to set on "${args.nodeId}"`, ignoreFocusOut: true }
      );
      if (!key) return;
      const raw = await vscode.window.showInputBox({
        prompt: `Value for ${key}`,
        ignoreFocusOut: true,
      });
      if (raw === undefined) return;
      // Quote non-numeric values so the DSL stays valid.
      const value = /^-?\d+(\.\d+)?$/.test(raw.trim()) ? raw.trim() : `"${raw.replace(/"/g, '\\"')}"`;
      await applyBlockTransform(
        args.blockId,
        (src) => setNodeAttributes(src, args.nodeId, { [key]: value }),
        args.doc
      );
    }
  );

  // ── Re-enable auto layout (clears all manual x/y overrides) ────────────
  const autoLayout = vscode.commands.registerCommand(
    'seldia.autoLayout',
    async (args: { blockId: string; doc?: string }) => {
      if (!args?.blockId) return;
      await applyBlockTransform(args.blockId, (src) => clearAllPositions(src), args.doc);
    }
  );

  // ── Replace a block's entire DSL source (live edit from Code mode) ──────
  // The preview's editable source textarea sends the full new source; we swap
  // it in wholesale so the diagram re-renders. Matched by the block's original
  // id (the transform ignores its `src` argument and returns the new source).
  const replaceBlockSource = vscode.commands.registerCommand(
    'seldia.replaceBlockSource',
    async (args: { blockId: string; source: string; doc?: string }) => {
      if (!args?.blockId || typeof args.source !== 'string') return;
      await applyBlockTransform(args.blockId, () => args.source, args.doc);
    }
  );

  context.subscriptions.push(moveNode, editNodeLabel, editNodeAttr, autoLayout, replaceBlockSource);

  registerEditUriHandler(context);
}

// ── Deep-link channel from the built-in Markdown preview ────────────────────
// Verified against the VS Code 1.124 application bundle:
//
//   • mainThreadWebviews gates links clicked inside a webview on
//     `standardSupportedLinkSchemes = new Set([http, https, mailto, vscode,
//     "vscode-insider"])`. A `vscode:` link is therefore handed to the opener
//     service; anything else is dropped unless it is `command:` AND the webview
//     set `enableCommandUris`.
//   • markdown-language-features never sets `enableCommandUris` (zero
//     occurrences in its bundle), so `command:` links from the built-in preview
//     are silently discarded — they can never invoke a command.
//   • The preview exposes no custom postMessage channel to contributed scripts
//     (its host understands a fixed set: openLink / revealLine / didClick / …).
//
// So `vscode://<extension-id>/<action>?<query>` routed to a registered
// UriHandler is the only working preview -> extension-host channel. VS Code asks
// the user to trust the extension the first time (with a "don't ask again"
// checkbox); after that these edits apply silently. See the preview script's
// `runCommand` (markdown-preview/index.ts) and the plugin's `deepLink`.
//
// Every action also carries a `doc` param — the source document's Uri, taken
// from the preview render env — because the handlers must not guess which file
// the preview is showing (see findDocWithBlock).
export const EDIT_URI_ACTIONS = new Set([
  'moveNode',
  'editNodeLabel',
  'editNodeAttr',
  'autoLayout',
  'replaceBlockSource',
  'revealSource',
]);

function registerEditUriHandler(context: vscode.ExtensionContext): void {
  const handler = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri) {
      // uri.path is like "/moveNode"; uri.query is a urlencoded param string.
      const action = uri.path.replace(/^\/+/, '');
      if (!EDIT_URI_ACTIONS.has(action)) return;

      const params = new URLSearchParams(uri.query);
      const args: Record<string, unknown> = {};
      for (const [k, v] of params) args[k] = v;
      // Numeric coercion for the fields the commands expect as numbers.
      if (params.has('x')) args.x = Number(params.get('x'));
      if (params.has('y')) args.y = Number(params.get('y'));

      void vscode.commands.executeCommand(`seldia.${action}`, args);
    },
  });
  context.subscriptions.push(handler);
}

// Re-export for tests / callers that want block discovery.
export { findSelDiABlocks };
