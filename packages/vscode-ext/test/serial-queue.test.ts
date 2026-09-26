// =============================================================================
// SelDiA VS Code — SerialQueue tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { SerialQueue } from '../src/edit/serial-queue.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SerialQueue', () => {
  it('runs tasks one at a time in submission order, even when later tasks resolve faster', async () => {
    const q = new SerialQueue();
    const order: number[] = [];

    const p1 = q.run(async () => {
      await delay(20);
      order.push(1);
    });
    const p2 = q.run(async () => {
      await delay(0);
      order.push(2);
    });
    const p3 = q.run(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('a rejected task does not break the queue for later tasks', async () => {
    const q = new SerialQueue();
    const order: string[] = [];

    const p1 = q.run(async () => {
      order.push('a');
      throw new Error('boom');
    });
    const p2 = q.run(async () => {
      order.push('b');
    });

    await expect(p1).rejects.toThrow('boom');
    await p2;
    expect(order).toEqual(['a', 'b']);
  });
});
