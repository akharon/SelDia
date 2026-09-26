// =============================================================================
// SelDiA — EditSession (pure undo/redo + edit-intent bookkeeping)
// =============================================================================
// Holds the state that used to live directly on SelDiAInteractiveProvider as
// `_undoStack`/`_redoStack`/`_currentSource`: no vscode API here, so it can be
// unit-tested without an extension host. provider.ts owns translating
// TextEdit[] into a vscode.WorkspaceEdit and reading the live document; this
// class owns deciding WHAT the undo/redo stacks contain and WHEN a foreign
// edit (typing in the text editor, an edit from another tool) invalidates
// them.
//
// Each entry is the pre-edit source plus the document version it was
// captured at (see docs/next_steps.md §3.2 step 1.2). A foreign edit bumps
// the version; entries captured at a stale version are dropped rather than
// replayed, since replaying them would silently discard whatever the user
// just typed by hand.
// =============================================================================

export interface EditSessionEntry {
  /** Source text to restore to (the state BEFORE the edit this entry undoes). */
  source: string;
  /** Document version at the time this entry was captured. */
  version: number;
}

export class EditSession {
  private _source: string;
  private _version = 0;
  private _undoStack: EditSessionEntry[] = [];
  private _redoStack: EditSessionEntry[] = [];
  private readonly _maxStack = 50;

  constructor(initialSource: string) {
    this._source = initialSource;
  }

  get source(): string {
    return this._source;
  }

  get version(): number {
    return this._version;
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /** Record a visual edit: push the pre-edit source (at the CURRENT version)
   *  onto the undo stack, clear redo, and advance to the new source/version.
   *  Call this right before the WorkspaceEdit that makes `nextSource` real is
   *  applied, using the version the edit was computed against. */
  recordEdit(nextSource: string): void {
    this._undoStack.push({ source: this._source, version: this._version });
    if (this._undoStack.length > this._maxStack) this._undoStack.shift();
    this._redoStack = [];
    this._source = nextSource;
    this._version++;
  }

  /** A change landed on the document that this session did NOT produce
   *  (hand typing, another extension, a foreign WorkspaceEdit). Adopt the
   *  new ground truth and drop any undo/redo entries — they were captured
   *  against a version that no longer exists, and restoring one now would
   *  overwrite the hand edit that just happened. This is the fix for
   *  "undo after typing replaces the whole source with a stale snapshot and
   *  silently discards the typing" (next_steps.md §3.2 step 1.2). */
  onForeignEdit(newSource: string): void {
    this._source = newSource;
    this._version++;
    this._undoStack = [];
    this._redoStack = [];
  }

  /** Pop the undo stack and return the source to restore to, or undefined if
   *  there's nothing to undo. Pushes the current state onto redo. */
  undo(): string | undefined {
    const entry = this._undoStack.pop();
    if (!entry) return undefined;
    this._redoStack.push({ source: this._source, version: this._version });
    this._source = entry.source;
    this._version++;
    return entry.source;
  }

  /** Pop the redo stack and return the source to restore to, or undefined if
   *  there's nothing to redo. Pushes the current state onto undo. */
  redo(): string | undefined {
    const entry = this._redoStack.pop();
    if (!entry) return undefined;
    this._undoStack.push({ source: this._source, version: this._version });
    this._source = entry.source;
    this._version++;
    return entry.source;
  }
}
