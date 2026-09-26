// =============================================================================
// SelDiA VS Code — EditSession tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { EditSession } from '../src/edit/session.js';

describe('EditSession', () => {
  it('drag x2 -> undo x2 -> redo replays in order', () => {
    const s = new EditSession('v0');
    s.recordEdit('v1');
    s.recordEdit('v2');
    expect(s.source).toBe('v2');

    expect(s.undo()).toBe('v1');
    expect(s.source).toBe('v1');
    expect(s.undo()).toBe('v0');
    expect(s.source).toBe('v0');
    expect(s.canUndo).toBe(false);

    expect(s.redo()).toBe('v1');
    expect(s.source).toBe('v1');
  });

  it('undo with nothing on the stack is a no-op', () => {
    const s = new EditSession('v0');
    expect(s.undo()).toBeUndefined();
    expect(s.source).toBe('v0');
  });

  it('a new edit clears the redo stack', () => {
    const s = new EditSession('v0');
    s.recordEdit('v1');
    s.undo();
    expect(s.canRedo).toBe(true);
    s.recordEdit('v1b');
    expect(s.canRedo).toBe(false);
    expect(s.redo()).toBeUndefined();
  });

  it('a hand edit (foreign edit) must not be destroyed by a later undo', () => {
    const s = new EditSession('v0');
    s.recordEdit('v1'); // visual drag
    // User hand-types in the text editor; the document is now 'v1-typed'.
    s.onForeignEdit('v1-typed');
    expect(s.canUndo).toBe(false); // stale entries dropped, not replayed
    expect(s.undo()).toBeUndefined();
    expect(s.source).toBe('v1-typed'); // typing survives
  });

  it('a foreign edit also clears any pending redo', () => {
    const s = new EditSession('v0');
    s.recordEdit('v1');
    s.undo();
    expect(s.canRedo).toBe(true);
    s.onForeignEdit('v0-typed');
    expect(s.canRedo).toBe(false);
  });

  it('rapid concurrent drags each get their own undo entry', () => {
    const s = new EditSession('start');
    s.recordEdit('drag1');
    s.recordEdit('drag2');
    s.recordEdit('drag3');
    expect(s.undo()).toBe('drag2');
    expect(s.undo()).toBe('drag1');
    expect(s.undo()).toBe('start');
    expect(s.canUndo).toBe(false);
  });

  it('version increments on every edit, undo, redo and foreign edit', () => {
    const s = new EditSession('v0');
    expect(s.version).toBe(0);
    s.recordEdit('v1');
    expect(s.version).toBe(1);
    s.undo();
    expect(s.version).toBe(2);
    s.redo();
    expect(s.version).toBe(3);
    s.onForeignEdit('v1-typed');
    expect(s.version).toBe(4);
  });
});
