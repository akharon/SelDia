// =============================================================================
// SelDiA — Serial async queue
// =============================================================================
// Two quick drags used to interleave: `groundTruth()` reads the document,
// then `applyEdit` writes it, and a second gesture's read could land between
// another gesture's read and write, pushing an undo snapshot that was
// already stale by the time it landed. Every edit-producing message handler
// runs through `run()` so each intent (drag, label, add, delete, undo, redo)
// completes before the next one starts reading ground truth.
// =============================================================================

export class SerialQueue {
  private _tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this._tail.then(task);
    this._tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
