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
}

/** Locate the Markdown document that contains the block with `blockId`. */
function findDocWithBlock(blockId: string): { doc: vscode.TextDocument; block: SelDiABlockLoc } | undefined {
  const candidates = vscode.workspace.textDocuments.filter(
    (d) => d.languageId === 'markdown' || /\.(md|mdx|rst)$/.test(d.fileName)
  );
  // Prefer the active editor's document if it matches.
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
  transform: (source: string) => string
): Promise<boolean> {
  const found = findDocWithBlock(blockId);
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
      await applyBlockTransform(args.blockId, (src) =>
        setNodePosition(src, args.nodeId, args.x, args.y)
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
      await applyBlockTransform(args.blockId, (src) => setNodeLabel(src, args.nodeId, label));
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
      await applyBlockTransform(args.blockId, (src) =>
        setNodeAttributes(src, args.nodeId, { [key]: value })
      );
    }
  );

  // ── Re-enable auto layout (clears all manual x/y overrides) ────────────
  const autoLayout = vscode.commands.registerCommand(
    'seldia.autoLayout',
    async (args: { blockId: string }) => {
      if (!args?.blockId) return;
      await applyBlockTransform(args.blockId, (src) => clearAllPositions(src));
    }
  );

  context.subscriptions.push(moveNode, editNodeLabel, editNodeAttr, autoLayout);
}

// Re-export for tests / callers that want block discovery.
export { findSelDiABlocks };
