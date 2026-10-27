import { describe, it, expect } from 'vitest';
import { createEngine, measureLayout } from '../src/index.js';

async function laid(src: string) {
  const e = createEngine({});
  const ir = e.transform(e.analyze(e.parse(src).value as any).value as any).value as any;
  return (await e.layoutAsync(ir)).value!.diagram as any;
}

describe('S1 sankey ordering', () => {
  const src = 'sankey "E" {\n s "Solar"\n w "Wind"\n c "Coal"\n g "Grid"\n st "Storage"\n l "Loss"\n s -> g: "110"\n s -> st: "10"\n w -> g: "75"\n c -> g: "190"\n c -> l: "10"\n}';
  it('orders nodes so ribbons do not cross or overlap', async () => {
    const m = measureLayout(await laid(src));
    expect(m.crossings).toBe(0);
    expect(m.edgeOverlaps).toBe(0);
  });
  it('is deterministic', async () => {
    const a = await laid(src), b = await laid(src);
    expect(JSON.stringify(a.nodes.map((n: any) => n.position))).toBe(JSON.stringify(b.nodes.map((n: any) => n.position)));
  });
  it('incoming links at a node are ordered by source y', async () => {
    const d = await laid(src);
    const y = new Map(d.nodes.map((n: any) => [n.id, n.position.y]));
    const ins = d.edges.filter((e: any) => e.targetId === 'g').sort((a: any, b: any) => a.waypoints[1].y - b.waypoints[1].y);
    const srcY = ins.map((e: any) => y.get(e.sourceId) as number);
    expect([...srcY].sort((a, b) => a - b)).toEqual(srcY);
  });
});

describe('S2 sequence participant boxes', () => {
  it('sizes a cylinder participant from its text box', async () => {
    const d = await laid('sequence "S" {\n a "User"\n db "Token Store Database" [shape: cylinder]\n a -> db: "go"\n}');
    const m = measureLayout(d);
    expect(m.nodeTextOverflow).toBe(0);
    const hs = new Set(d.nodes.map((n: any) => n.size.height));
    expect(hs.size).toBe(1);
  });
});
