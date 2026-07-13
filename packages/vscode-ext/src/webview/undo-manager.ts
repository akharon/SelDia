// =============================================================================
// SelDiA — Webview Undo/Redo Manager
// =============================================================================
// Manages undo/redo stack for visual edit operations in the webview.
// Each transaction contains one or more edit operations.

import type { EditTransaction } from '@seldia/interaction';

export class WebviewUndoManager {
  private undoStack: EditTransaction[] = [];
  private redoStack: EditTransaction[] = [];
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  /** Push a new transaction onto the undo stack */
  push(transaction: EditTransaction): void {
    this.undoStack.push(transaction);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /** Undo the last transaction */
  undo(): EditTransaction | null {
    const txn = this.undoStack.pop();
    if (txn) {
      this.redoStack.push(txn);
    }
    return txn || null;
  }

  /** Redo the last undone transaction */
  redo(): EditTransaction | null {
    const txn = this.redoStack.pop();
    if (txn) {
      this.undoStack.push(txn);
    }
    return txn || null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoStackSize(): number {
    return this.undoStack.length;
  }

  redoStackSize(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Get a human-readable description of the last undoable action */
  peekUndoDescription(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.description;
  }

  /** Get a human-readable description of the next redoable action */
  peekRedoDescription(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.description;
  }
}
