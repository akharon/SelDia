// =============================================================================
// SelDiA — InteractionManager lifecycle tests
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionManager } from '../src/manager.js';

describe('InteractionManager attach/detach lifecycle', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('detach() removes the same keydown listener that attach() registered', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const mgr = new InteractionManager();
    mgr.attach(container);

    const keydownAddCall = addSpy.mock.calls.find((c) => c[0] === 'keydown');
    expect(keydownAddCall).toBeDefined();
    const registeredHandler = keydownAddCall![1];

    mgr.detach();

    const keydownRemoveCall = removeSpy.mock.calls.find((c) => c[0] === 'keydown');
    expect(keydownRemoveCall).toBeDefined();
    expect(keydownRemoveCall![1]).toBe(registeredHandler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('attach() called twice without detach() does not register a second listener', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');

    const mgr = new InteractionManager();
    mgr.attach(container);
    const countAfterFirst = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;

    mgr.attach(container);
    const countAfterSecond = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;

    expect(countAfterSecond).toBe(countAfterFirst);

    mgr.detach();
    addSpy.mockRestore();
  });
});
