// =============================================================================
// SelDiA — Bidirectional Sync Controller
// =============================================================================
// Manages the round-trip between visual edits (in the webview) and DSL source
// code (in the VS Code editor). Uses the source map to track element locations,
// the code generator to produce DSL patches, and the diff patcher for minimal edits.
//
// Phase 9d: S1–S6

import * as vscode from 'vscode';
import type { CoreEngine, DiagramIR, ID, SourceLocation, Point } from '@seldia/core';
import {
  buildSourceMap, SelDiACodeGenerator, SelDiADiffPatcher, type DslPatch,
} from '@seldia/interaction';
import type { SourceMap, TextEdit } from '@seldia/interaction';
import type { EditTransaction, EditOperation } from '@seldia/interaction';

export interface SyncControllerOptions {
  engine: CoreEngine;
  /** Debounce delay for re-sync after source edits (ms) */
  debounceMs?: number;
}

export interface SyncControllerCallbacks {
  /** Called when DSL patches should be applied to the editor */
  onApplyEdits?: (uri: vscode.Uri, edits: TextEdit[]) => void;
  /** Called when the diagram should be re-rendered after sync */
  onRequestReRender?: () => void;
  /** Called when sync state changes (e.g., conflict detected) */
  onSyncStateChange?: (state: SyncState) => void;
}

export interface SyncState {
  /** Whether the source map is in sync with the current DSL source */
  isInSync: boolean;
  /** Whether a conflict is currently detected */
  hasConflict: boolean;
  /** Conflicting element IDs (if any) */
  conflictingIds: ID[];
  /** Timestamp of last sync */
  lastSyncAt: number;
}

export class SyncController {
  private engine: CoreEngine;
  private codeGenerator: SelDiACodeGenerator;
  private diffPatcher: SelDiADiffPatcher;
  private callbacks: SyncControllerCallbacks;
  private debounceMs: number;

  private _sourceMap: SourceMap | null = null;
  private _currentSource: string = '';
  private _currentIr: DiagramIR | null = null;
  private _sourceUri: vscode.Uri | null = null;
  private _state: SyncState = {
    isInSync: true,
    hasConflict: false,
    conflictingIds: [],
    lastSyncAt: Date.now(),
  };
  private _disposables: vscode.Disposable[] = [];

  // Debounce timer for re-sync after source changes
  private _syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SyncControllerOptions, callbacks: SyncControllerCallbacks = {}) {
    this.engine = options.engine;
    this.codeGenerator = new SelDiACodeGenerator();
    this.diffPatcher = new SelDiADiffPatcher();
    this.callbacks = callbacks;
    this.debounceMs = options.debounceMs || 300;
  }

  // ── Properties ──────────────────────────────────────────────────────

  get sourceMap(): SourceMap | null {
    return this._sourceMap;
  }

  get state(): SyncState {
    return { ...this._state };
  }

  get isInSync(): boolean {
    return this._state.isInSync;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Initialize the sync controller with source text and its URI.
   * Rebuilds the source map from the DSL source.
   */
  async initialize(source: string, sourceUri: vscode.Uri): Promise<void> {
    this._currentSource = source;
    this._sourceUri = sourceUri;

    // Compile to get the latest IR
    const result = await this.engine.compile(source, sourceUri.fsPath);
    if (result.ok) {
      this._currentIr = result.value as any;
    }

    // Build source map from the DSL text
    this._sourceMap = buildSourceMap(source, sourceUri.fsPath, this._currentIr || undefined);
    this._state = {
      isInSync: true,
      hasConflict: false,
      conflictingIds: [],
      lastSyncAt: Date.now(),
    };
    this.notifyState();
  }

  /**
   * Update the DSL source (e.g., after manual editing in the code editor).
   * Rebuilds the source map and detects conflicts with any pending visual edits.
   */
  async updateSource(source: string): Promise<void> {
    this._currentSource = source;

    // Rebuild source map from new source
    if (this._sourceUri) {
      const result = await this.engine.compile(source, this._sourceUri.fsPath);
      if (result.ok) {
        this._currentIr = result.value as any;
      }
      this._sourceMap = buildSourceMap(source, this._sourceUri.fsPath, this._currentIr || undefined);
    }

    this._state.lastSyncAt = Date.now();
    this._state.isInSync = true;
    this.notifyState();
  }

  // ── Visual → Source Sync (S1) ───────────────────────────────────────

  /**
   * Handle a visual edit transaction: convert it to DSL patches
   * and compute text edits to apply to the source.
   *
   * @returns The computed text edits
   */
  visualToSource(transaction: EditTransaction): TextEdit[] {
    const patches = this.transactionToPatches(transaction);
    if (patches.length === 0) return [];

    const edits = this.diffPatcher.computeEdits(this._currentSource, patches);

    // Update source map snapshot after the edits
    if (edits.length > 0) {
      this._state.isInSync = false;
      this._state.lastSyncAt = Date.now();
      this.notifyState();
    }

    return edits;
  }

  /**
   * Apply text edits to the VS Code document.
   */
  applyEditsToDocument(uri: vscode.Uri, edits: TextEdit[]): void {
    if (edits.length === 0) return;

    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const edit of edits) {
      const startPos = this._sourceMap
        ? this.offsetToPosition(edit.offset)
        : new vscode.Position(0, 0);

      if (edit.deleteCount > 0) {
        const endPos = this.offsetToPosition(edit.offset + edit.deleteCount);
        workspaceEdit.replace(
          uri,
          new vscode.Range(startPos, endPos),
          edit.insert
        );
      } else {
        workspaceEdit.insert(uri, startPos, edit.insert);
      }
    }

    vscode.workspace.applyEdit(workspaceEdit).then(() => {
      this._state.isInSync = true;
      this.notifyState();
    });
  }

  // ── Source → Visual Sync (S4) ───────────────────────────────────────

  /**
   * Start watching for document changes to trigger re-render.
   */
  watchDocument(document: vscode.TextDocument): void {
    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        // Debounce re-sync
        if (this._syncTimer) clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(async () => {
          await this.updateSource(e.document.getText());
          this.callbacks.onRequestReRender?.();
        }, this.debounceMs);
      }
    });
    this._disposables.push(sub);
  }

  /**
   * Stop watching and clean up.
   */
  dispose(): void {
    if (this._syncTimer) clearTimeout(this._syncTimer);
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }

  // ── Conflict Detection & Resolution (S6) ────────────────────────────

  /**
   * Detect conflicts between a visual edit and concurrent source edits.
   */
  detectConflicts(visualEdit: EditOperation, sourceEdits: TextEdit[]): ID[] {
    const conflicts: ID[] = [];
    if (!this._sourceMap) return conflicts;

    // For each source edit, check if it overlaps with the visual edit's target
    let affectedId: ID | undefined;

    switch (visualEdit.type) {
      case 'move-node':
      case 'edit-label':
      case 'resize-node':
      case 'change-shape':
        affectedId = visualEdit.nodeId;
        break;
      case 'edit-edge-label':
      case 'reroute-edge':
        affectedId = visualEdit.edgeId;
        break;
      case 'delete-node':
        affectedId = visualEdit.nodeId;
        break;
      case 'delete-edge':
        affectedId = visualEdit.edgeId;
        break;
    }

    if (!affectedId) return conflicts;

    const entry = this._sourceMap.entries.get(affectedId);
    if (!entry) return conflicts;

    // Narrow to element types that have declarationLoc
    if (entry.elementType === 'style' || entry.elementType === 'layout') return conflicts;
    const declLoc = (entry as any).declarationLoc;
    if (!declLoc) return conflicts;

    // Check if any source edit overlaps the declaration range
    for (const srcEdit of sourceEdits) {
      const editEnd = srcEdit.offset + srcEdit.deleteCount;
      const declEnd = declLoc.offset + (this._currentSource.length - declLoc.offset);
      // Simple overlap check
      if (srcEdit.offset < declEnd && editEnd > declLoc.offset) {
        conflicts.push(affectedId);
        break;
      }
    }

    return conflicts;
  }

  /**
   * Resolve conflicts by preferring one side.
   */
  resolveConflicts(
    conflicts: ID[],
    strategy: 'prefer-visual' | 'prefer-source'
  ): TextEdit[] {
    // When preferring source, no action needed — the source is already applied
    // When preferring visual, we'd re-apply the visual edits
    if (strategy === 'prefer-visual') {
      // Placeholder: in a full implementation, re-queue visual edits
      this._state.hasConflict = false;
      this._state.conflictingIds = [];
    } else {
      // Accept source version, update source map
      this._state.hasConflict = false;
      this._state.conflictingIds = [];
    }

    this._state.isInSync = true;
    this.notifyState();
    return [];
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  /**
   * Convert an EditTransaction to a list of DSL patches.
   */
  private transactionToPatches(transaction: EditTransaction): DslPatch[] {
    const patches: DslPatch[] = [];
    const sourceLines = this._currentSource.split('\n');

    for (const op of transaction.operations) {
      const patch = this.operationToPatch(op, sourceLines);
      if (patch) patches.push(patch);
    }

    return patches;
  }

  /**
   * Convert a single EditOperation to a DslPatch.
   */
  private operationToPatch(op: EditOperation, sourceLines: string[]): DslPatch | null {
    switch (op.type) {
      case 'move-node': {
        // Add/update layout hint on the node line
        const lineIdx = this.findLineForNode(op.nodeId, sourceLines);
        if (lineIdx < 0) return null;

        const line = sourceLines[lineIdx];
        const offset = this.lineToOffset(lineIdx);

        // Check if there's already a layout hint
        const layoutIdx = line.search(/\blayout\s*:/);
        if (layoutIdx >= 0) {
          // Replace existing layout hint
          const layoutEnd = line.indexOf('}', layoutIdx) + 1;
          return {
            type: 'replace',
            startOffset: offset + layoutIdx,
            endOffset: offset + (layoutEnd > layoutIdx ? layoutEnd : line.length),
            newText: `layout: { x: ${Math.round(op.newPosition.x)}, y: ${Math.round(op.newPosition.y)} }`,
            description: `Move '${op.nodeId}' to (${Math.round(op.newPosition.x)}, ${Math.round(op.newPosition.y)})`,
            sourceOperation: op,
          };
        } else {
          // Add layout hint at the end of the line
          return {
            type: 'insert',
            startOffset: offset + line.length,
            endOffset: offset + line.length,
            newText: ` layout: { x: ${Math.round(op.newPosition.x)}, y: ${Math.round(op.newPosition.y)} }`,
            description: `Move '${op.nodeId}' to (${Math.round(op.newPosition.x)}, ${Math.round(op.newPosition.y)})`,
            sourceOperation: op,
          };
        }
      }

      case 'edit-label': {
        const lineIdx = this.findLineForNode(op.nodeId, sourceLines);
        if (lineIdx < 0) return null;

        const line = sourceLines[lineIdx];
        const offset = this.lineToOffset(lineIdx);

        // Find the quoted label
        const quoteMatch = line.match(/"([^"]*)"/);
        if (quoteMatch) {
          const start = offset + quoteMatch.index!;
          const end = start + quoteMatch[0].length;
          return {
            type: 'replace',
            startOffset: start,
            endOffset: end,
            newText: `"${op.newLabel}"`,
            description: `Edit label of '${op.nodeId}'`,
            sourceOperation: op,
          };
        } else {
          // No existing label — add one after the shape
          const shapeEnd = line.indexOf(':', line.indexOf(':' + 1)) + 1;
          const afterShape = line.indexOf(' ', shapeEnd);
          const insertPos = afterShape > shapeEnd ? afterShape + 1 : line.length;
          return {
            type: 'insert',
            startOffset: offset + insertPos,
            endOffset: offset + insertPos,
            newText: ` "${op.newLabel}"`,
            description: `Add label to '${op.nodeId}'`,
            sourceOperation: op,
          };
        }
      }

      case 'add-node': {
        // Find the diagram closing brace and insert before it
        const closeBraceIdx = this._currentSource.lastIndexOf('}');
        if (closeBraceIdx < 0) return null;
        const connectLine = op.connectFromId
          ? `    ${op.connectFromId} --> ${op.nodeId}\n`
          : '';
        return {
          type: 'insert',
          startOffset: closeBraceIdx,
          endOffset: closeBraceIdx,
          newText: `${op.generatedDsl}\n${connectLine}`,
          description: `Add node '${op.nodeId}'`,
          sourceOperation: op,
        };
      }

      case 'delete-node': {
        const lineIdx = this.findLineForNode(op.nodeId, sourceLines);
        if (lineIdx < 0) return null;
        const offset = this.lineToOffset(lineIdx);
        const lineLen = sourceLines[lineIdx].length + 1; // +1 for \n
        return {
          type: 'delete',
          startOffset: offset,
          endOffset: offset + lineLen,
          description: `Delete node '${op.nodeId}'`,
          sourceOperation: op,
        };
      }

      case 'add-edge': {
        const closeBraceIdx = this._currentSource.lastIndexOf('}');
        if (closeBraceIdx < 0) return null;
        return {
          type: 'insert',
          startOffset: closeBraceIdx,
          endOffset: closeBraceIdx,
          newText: `    ${op.generatedDsl}\n`,
          description: `Add edge '${op.sourceId} → ${op.targetId}'`,
          sourceOperation: op,
        };
      }

      case 'delete-edge': {
        // Find the edge declaration line
        for (let i = 0; i < sourceLines.length; i++) {
          if (sourceLines[i].includes(op.edgeId) ||
              (this._currentIr?.edges.find(e => e.id === op.edgeId) && sourceLines[i].includes('-->'))) {
            const offset = this.lineToOffset(i);
            const lineLen = sourceLines[i].length + 1;
            return {
              type: 'delete',
              startOffset: offset,
              endOffset: offset + lineLen,
              description: `Delete edge '${op.edgeId}'`,
              sourceOperation: op,
            };
          }
        }
        return null;
      }

      case 'reroute-edge': {
        // Find and update the edge line
        for (let i = 0; i < sourceLines.length; i++) {
          const line = sourceLines[i];
          if (line.includes(op.oldSourceId) && line.includes(op.oldTargetId) && line.includes('-->')) {
            const offset = this.lineToOffset(i);
            const oldRef = `${op.oldSourceId} --> ${op.oldTargetId}`;
            const newRef = `${op.newSourceId} --> ${op.newTargetId}`;
            const startIdx = line.indexOf(oldRef);
            if (startIdx >= 0) {
              return {
                type: 'replace',
                startOffset: offset + startIdx,
                endOffset: offset + startIdx + oldRef.length,
                newText: newRef,
                description: `Reroute edge to '${op.newSourceId} → ${op.newTargetId}'`,
                sourceOperation: op,
              };
            }
            break;
          }
        }
        return null;
      }

      case 'resize-node': {
        const lineIdx = this.findLineForNode(op.nodeId, sourceLines);
        if (lineIdx < 0) return null;
        const line = sourceLines[lineIdx];
        const offset = this.lineToOffset(lineIdx);

        // Add minWidth/minHeight to node style
        const styleBlock = `minWidth: ${Math.round(op.newSize.width)}, minHeight: ${Math.round(op.newSize.height)}`;
        const styleBlockMatch = line.match(/\{([^}]*)\}/);
        if (styleBlockMatch) {
          // Replace entire style block
          return {
            type: 'replace',
            startOffset: offset + styleBlockMatch.index!,
            endOffset: offset + styleBlockMatch.index! + styleBlockMatch[0].length,
            newText: `{ ${styleBlock} }`,
            description: `Resize '${op.nodeId}'`,
            sourceOperation: op,
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Find the source line index for a node ID.
   */
  private findLineForNode(nodeId: string, lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith(nodeId + ':') || trimmed.startsWith(nodeId + ' ')) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Convert a line number (0-based) to a source offset.
   */
  private lineToOffset(lineIdx: number): number {
    const lines = this._currentSource.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(lineIdx, lines.length); i++) {
      offset += lines[i].length + 1;
    }
    return offset;
  }

  /**
   * Convert a source offset to a VS Code Position.
   */
  private offsetToPosition(offset: number): vscode.Position {
    const text = this._currentSource;
    let line = 0;
    let col = 0;
    for (let i = 0; i < Math.min(offset, text.length); i++) {
      if (text[i] === '\n') {
        line++;
        col = 0;
      } else {
        col++;
      }
    }
    return new vscode.Position(line, col);
  }

  private notifyState(): void {
    this.callbacks.onSyncStateChange?.(this._state);
  }
}
