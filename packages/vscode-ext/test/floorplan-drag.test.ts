// =============================================================================
// SelDiA VS Code — Floorplan drag write-back tests
// =============================================================================
// The generic x/y write-back is a no-op for floorplans (the plugin reads
// `at:` in metres and `in:` for furniture), so these tests go through the real
// engine: compile → drag a laid-out node → patch the source → recompile, and
// assert the piece actually landed where it was dropped.
import { describe, it, expect } from 'vitest';
import { createEngine } from '@seldia/core';
import { computeFloorplanDragPatch } from '../src/edit/floorplan-drag.js';
import { computeAttrEdit, applyTextEdit } from '../src/edit/position-patch.js';

const SRC = `floorplan "T" {
  Living  "Living Room" { type: "room", at: "0,0",   size: "5.4x4.2" }
  Kitchen "Kitchen"     { type: "room", at: "5.4,0", size: "3.6x4.2" }

  d1 "door" { type: "door", at: "Living.east", offset: 1.4, width: 0.9 }
  sofa "sofa" { type: "furniture", item: "sofa", in: "Living", at: "0.4,0.4" }
}`;

async function layout(src: string) {
  const eng = createEngine();
  const r1 = eng.parse(src);
  if (!r1.ok) throw new Error('parse failed');
  const r2 = eng.analyze(r1.value);
  if (!r2.ok) throw new Error('analyze failed');
  const r3 = eng.transform(r2.value);
  if (!r3.ok) throw new Error('transform failed');
  const r4 = await eng.layoutAsync(r3.value);
  if (!r4.ok) throw new Error('layout failed');
  return r4.value.diagram;
}

function node(ir: any, id: string) {
  const n = ir.nodes.find((x: any) => x.id === id);
  expect(n, `node ${id}`).toBeDefined();
  return n;
}

/** Drag `id` by a pixel delta and return the rewritten source. */
async function drag(src: string, id: string, dx: number, dy: number): Promise<string> {
  const ir = await layout(src);
  const scale = ir.metadata!.floorplanScale as number;
  const n = node(ir, id);
  const patch = computeFloorplanDragPatch(ir.nodes as any, id, n.position.x + dx, n.position.y + dy, scale);
  expect(patch, 'drag patch').toBeDefined();
  const edit = computeAttrEdit(src, id, patch!.attrs);
  expect(edit, 'attr edit').toBeDefined();
  return applyTextEdit(src, edit!);
}

describe('floorplan drag write-back', () => {
  it('rewrites furniture `at` in room-relative metres, not pixel x/y', async () => {
    const out = await drag(SRC, 'sofa', 60, 120); // 1m right, 2m down at 60px/m
    expect(out).toContain('at: "1.4,2.4"');
    expect(out).not.toMatch(/sofa[^\n]*\bx:/);
    // The move survives a recompile — the whole point of the write-back.
    const ir = await layout(out);
    const living = node(ir, 'Living');
    const sofa = node(ir, 'sofa');
    expect(sofa.position.x - living.position.x).toBeCloseTo(1.4 * 60, 3);
    expect(sofa.position.y - living.position.y).toBeCloseTo(2.4 * 60, 3);
  });

  it('re-parents furniture dragged into another room and rebases its offset', async () => {
    // Living is 5.4m wide, so +6m lands the sofa's centre inside Kitchen.
    const out = await drag(SRC, 'sofa', 6 * 60, 0);
    expect(out).toContain('in: "Kitchen"');
    expect(out).toContain('at: "1,0.4"');
    const ir = await layout(out);
    const kitchen = node(ir, 'Kitchen');
    const sofa = node(ir, 'sofa');
    expect(sofa.position.x - kitchen.position.x).toBeCloseTo(1 * 60, 3);
  });

  it('keeps the current room when furniture is dropped outside every room', async () => {
    const out = await drag(SRC, 'sofa', 0, 40 * 60); // far below the building
    expect(out).toContain('in: "Living"');
    expect(out).not.toContain('in: "Kitchen"');
  });

  it('moves a room by rewriting its absolute `at`', async () => {
    const out = await drag(SRC, 'Kitchen', 0, 60);
    expect(out).toContain('at: "5.4,1"');
  });

  it('snaps a dragged door to the nearest wall of the room it lands on', async () => {
    // d1 sits on Living.east; drag it well inside Living, near the north wall.
    const ir = await layout(SRC);
    const scale = ir.metadata!.floorplanScale as number;
    const living = node(ir, 'Living');
    const patch = computeFloorplanDragPatch(
      ir.nodes as any, 'd1',
      living.position.x + 2 * scale, living.position.y + 0.1 * scale, scale
    );
    expect(patch!.attrs.at).toBe('Living.north');
    expect(Number(patch!.attrs.offset)).toBeGreaterThan(0);
  });

  it('returns nothing for a non-floorplan diagram node', async () => {
    const ir = await layout(SRC);
    const scale = ir.metadata!.floorplanScale as number;
    expect(computeFloorplanDragPatch(ir.nodes as any, 'nope', 0, 0, scale)).toBeUndefined();
  });
});
