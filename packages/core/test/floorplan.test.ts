import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';
import type { DiagramIR } from '../src/ir/types.js';

const engine = createEngine();

function irOf(src: string): DiagramIR {
  const parsed = engine.parse(src);
  expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.errors).slice(0, 300)).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  const analyzed = engine.analyze(parsed.value);
  expect(analyzed.ok).toBe(true);
  if (!analyzed.ok) throw new Error('unreachable');
  const ir = engine.transform(analyzed.value);
  expect(ir.ok, ir.ok ? '' : JSON.stringify(ir.errors).slice(0, 300)).toBe(true);
  if (!ir.ok) throw new Error('unreachable');
  return ir.value;
}

function layoutOf(src: string) {
  const ir = irOf(src);
  const layout = engine.layout(ir);
  expect(layout.ok, layout.ok ? '' : JSON.stringify(layout.errors).slice(0, 300)).toBe(true);
  if (!layout.ok) throw new Error('unreachable');
  return layout.value;
}

function renderOf(src: string): string {
  const rendered = engine.render(layoutOf(src));
  expect(rendered.ok).toBe(true);
  if (!rendered.ok) throw new Error('unreachable');
  return rendered.value.svg;
}

function warningsOf(src: string): string[] {
  const parsed = engine.parse(src);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  return engine.validateSemantics(parsed.value).map((d) => d.message);
}

const SAMPLE = `
floorplan "Apartment 4B" {
  meta [sheet] { type: "sheet", scale: "1:100", author: "M. Kaya", date: "2026-09-08" }

  Kitchen "Kitchen" { type: "room", at: "0,0", size: "4x3" }
  Living "Living" { type: "room", at: "4,0", size: "6x3" }
  Bedroom "Bedroom" { type: "room", at: "0,3", size: "4x5" }
  Bathroom "Bathroom" { type: "room", at: "4,3", size: "3x2" }

  d1 "door" { type: "door", at: "Kitchen.east", offset: 1.5, width: 0.9 }
  w1 "window" { type: "window", at: "Bedroom.west", offset: 2, width: 1.2 }

  f1 "sink" { type: "furniture", item: "sink", in: "Kitchen", at: "0.3,0.3" }
  f2 "bed" { type: "furniture", item: "bed-queen", in: "Bedroom", at: "1,1" }
  f3 "sofa" { type: "furniture", item: "sofa", in: "Living", at: "1,1", size: "2.4x0.9" }
}
`;

describe('floorplan diagram', () => {
  it('compiles to IR with rooms, openings and furniture as nodes', () => {
    const ir = irOf(SAMPLE);
    expect(ir.type).toBe('floorplan');
    const rooms = ir.nodes.filter((n) => (n.data as any)?.fpKind === 'room');
    expect(rooms.map((r) => r.id).sort()).toEqual(['Bathroom', 'Bedroom', 'Kitchen', 'Living']);

    const kitchen = rooms.find((r) => r.id === 'Kitchen')!;
    expect(kitchen.position).toEqual({ x: 0, y: 0 });
    expect(kitchen.size).toEqual({ width: 4, height: 3 });

    const door = ir.nodes.find((n) => (n.data as any)?.fpKind === 'door');
    expect(door?.data).toMatchObject({ roomId: 'Kitchen', edge: 'east', offset: 1.5, width: 0.9 });

    const furniture = ir.nodes.filter((n) => (n.data as any)?.fpKind === 'furniture');
    expect(furniture).toHaveLength(3);
    const sofa = furniture.find((f) => f.id === 'f3')!;
    expect(sofa.size).toEqual({ width: 2.4, height: 0.9 }); // size override wins over catalog default
    const sink = furniture.find((f) => f.id === 'f1')!;
    expect(sink.size).toEqual({ width: 0.6, height: 0.55 }); // catalog default, no override
  });

  it('falls back to a 1x1 box for an unknown furniture key rather than erroring', () => {
    const ir = irOf(`
      floorplan "T" {
        R "Room" { type: "room", at: "0,0", size: "3x3" }
        f1 "gizmo" { type: "furniture", item: "unobtainium-gizmo", in: "R", at: "0,0" }
      }
    `);
    const f = ir.nodes.find((n) => (n.data as any)?.fpKind === 'furniture')!;
    expect(f.size).toEqual({ width: 1, height: 1 });
    expect(f.label).toBe('unobtainium-gizmo');
  });

  it('resolves radiator and floor-heating catalog items and renders them as furniture', () => {
    const svg = renderOf(`
      floorplan "T" {
        R "Room" { type: "room", at: "0,0", size: "3x3" }
        f1 "rad" { type: "furniture", item: "radiator", in: "R", at: "0.1,0.1" }
        f2 "ufh" { type: "furniture", item: "floor-heating", in: "R", at: "0.5,0.5", size: "2x2" }
      }
    `);
    const ir = irOf(`
      floorplan "T" {
        R "Room" { type: "room", at: "0,0", size: "3x3" }
        f1 "rad" { type: "furniture", item: "radiator", in: "R", at: "0.1,0.1" }
        f2 "ufh" { type: "furniture", item: "floor-heating", in: "R", at: "0.5,0.5", size: "2x2" }
      }
    `);
    const furniture = ir.nodes.filter((n) => (n.data as any)?.fpKind === 'furniture');
    const rad = furniture.find((f) => f.id === 'f1')!;
    expect(rad.size).toEqual({ width: 0.8, height: 0.12 }); // catalog default
    expect((rad.data as any).symbol).toBe('radiator');
    const ufh = furniture.find((f) => f.id === 'f2')!;
    expect((ufh.data as any).symbol).toBe('floor-heating');
    expect(svg).toContain('seldia-node');
  });

  it('derives walls (exterior vs interior) and openings at layout time', () => {
    const parsed = engine.parse(SAMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    const analyzed = engine.analyze(parsed.value);
    if (!analyzed.ok) throw new Error('unreachable');
    const ir = engine.transform(analyzed.value);
    if (!ir.ok) throw new Error('unreachable');
    const layout = engine.layout(ir.value);
    expect(layout.ok).toBe(true);
    if (!layout.ok) throw new Error('unreachable');

    const meta = layout.value.diagram.metadata as any;
    expect(Array.isArray(meta.floorplanWalls)).toBe(true);
    expect(meta.floorplanWalls.length).toBeGreaterThan(0);
    const kinds = new Set(meta.floorplanWalls.map((w: any) => w.kind));
    expect(kinds.has('exterior')).toBe(true);
    expect(kinds.has('interior')).toBe(true); // Kitchen/Living share an edge, Kitchen/Bedroom share an edge
    expect(meta.floorplanOpenings.length).toBe(2); // one door, one window

    // Rooms positioned in pixels, scaled from their metre coordinates.
    const kitchen = layout.value.diagram.nodes.find((n) => n.id === 'Kitchen')!;
    const living = layout.value.diagram.nodes.find((n) => n.id === 'Living')!;
    expect(living.position.x).toBeGreaterThan(kitchen.position.x + kitchen.size.width - 1);
  });

  it('renders to SVG with crisp (non-sketchy) walls, frame and title block', () => {
    const parsed = engine.parse(SAMPLE);
    if (!parsed.ok) throw new Error('unreachable');
    const analyzed = engine.analyze(parsed.value);
    if (!analyzed.ok) throw new Error('unreachable');
    const ir = engine.transform(analyzed.value);
    if (!ir.ok) throw new Error('unreachable');
    const layout = engine.layout(ir.value);
    if (!layout.ok) throw new Error('unreachable');
    const rendered = engine.render(layout.value);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) throw new Error('unreachable');

    expect(rendered.value.svg).toContain('seldia-floorplan-frame');
    expect(rendered.value.svg).toContain('seldia-floorplan-walls');
    expect(rendered.value.svg).toContain('seldia-floorplan-titleblock');
    expect(rendered.value.svg).toContain('Apartment 4B');
    expect(rendered.value.svg).toContain('1:100');
    expect(rendered.value.svg).toContain('M. Kaya');
    // No rough.js path jitter markers — plain <line>/<rect> geometry.
    expect(rendered.value.svg).toContain('<line');
  });

  it('renders automatic exterior wall dimensions, outside the building only', () => {
    const layout = layoutOf(SAMPLE);
    const meta = layout.diagram.metadata as any;
    const dims = meta.floorplanDimensions as any[];
    expect(dims.length).toBeGreaterThan(0);

    // Every automatic dimension must sit outside the walls it measures.
    const walls = meta.floorplanWalls as any[];
    const minX = Math.min(...walls.flatMap((w) => [w.x1, w.x2]));
    const maxX = Math.max(...walls.flatMap((w) => [w.x1, w.x2]));
    const minY = Math.min(...walls.flatMap((w) => [w.y1, w.y2]));
    const maxY = Math.max(...walls.flatMap((w) => [w.y1, w.y2]));
    for (const d of dims) {
      const outside = d.side === 'top' ? d.y1 < minY : d.side === 'bottom' ? d.y1 > maxY
        : d.side === 'left' ? d.x1 < minX : d.x1 > maxX;
      expect(outside, `${d.side} dimension is inside the plan`).toBe(true);
    }
  });

  it('sheet dimensions:"off" suppresses the automatic wall strings', () => {
    const layout = layoutOf(`
      fp "T" {
        meta [sheet] { type: "sheet", dimensions: "off" }
        R "Room" { type: "room", at: "0,0", size: "3x3" }
      }
    `);
    expect((layout.diagram.metadata as any).floorplanDimensions).toEqual([]);
  });

  it('resolves a measure between two furniture items to their clear gap', () => {
    // Two 1x1 boxes at x=0 and x=2 inside a 5x3 room: a 1 m clear gap.
    const layout = layoutOf(`
      fp "T" {
        R "Room" { type: "room", at: "0,0", size: "5x3" }
        a "boxa" { type: "furniture", item: "unknown-a", in: "R", at: "0,0" }
        b "boxb" { type: "furniture", item: "unknown-b", in: "R", at: "2,0" }
        m1 "gap" { type: "measure", from: "a", to: "b" }
      }
    `);
    const measures = (layout.diagram.metadata as any).floorplanMeasures as any[];
    expect(measures).toHaveLength(1);
    expect(measures[0].text).toBe('1.00 m');
  });

  it('measures from a room wall to an object, using the Room.edge spelling', () => {
    const layout = layoutOf(`
      fp "T" {
        R "Room" { type: "room", at: "0,0", size: "5x4" }
        a "boxa" { type: "furniture", item: "unknown-a", in: "R", at: "1,2" }
        m1 "setback" { type: "measure", from: "R.north", to: "a" }
      }
    `);
    const measures = (layout.diagram.metadata as any).floorplanMeasures as any[];
    expect(measures).toHaveLength(1);
    expect(measures[0].text).toBe('2.00 m'); // north wall at y=0 down to the box at y=2
  });

  it('an explicit label overrides the computed measure length', () => {
    const layout = layoutOf(`
      fp "T" {
        R "Room" { type: "room", at: "0,0", size: "5x3" }
        a "boxa" { type: "furniture", item: "unknown-a", in: "R", at: "0,0" }
        b "boxb" { type: "furniture", item: "unknown-b", in: "R", at: "2,0" }
        m1 "gap" { type: "measure", from: "a", to: "b", label: "min. 90" }
      }
    `);
    const measures = (layout.diagram.metadata as any).floorplanMeasures as any[];
    expect(measures[0].text).toBe('min. 90');
  });

  it('warns on a measure referencing an unknown entity', () => {
    const msgs = warningsOf(`
      fp "T" {
        R "Room" { type: "room", at: "0,0", size: "3x3" }
        m1 "gap" { type: "measure", from: "R", to: "nope" }
      }
    `);
    expect(msgs.some((m) => m.includes('unknown to "nope"'))).toBe(true);
  });

  it('renders dimension and measure layers into the SVG', () => {
    const svg = renderOf(`
      fp "T" {
        R "Room" { type: "room", at: "0,0", size: "4x3" }
        a "boxa" { type: "furniture", item: "unknown-a", in: "R", at: "0,0" }
        b "boxb" { type: "furniture", item: "unknown-b", in: "R", at: "2,0" }
        m1 "gap" { type: "measure", from: "a", to: "b" }
      }
    `);
    expect(svg).toContain('seldia-floorplan-dimensions');
    expect(svg).toContain('seldia-floorplan-measures');
    expect(svg).toContain('seldia-floorplan-scalebar');
    expect(svg).toContain('seldia-floorplan-floors');
    expect(svg).toContain('4.00 m'); // the room's own wall length
  });

  it('warns on a door referencing an unknown room', () => {
    const msgs = warningsOf(`
      floorplan "T" {
        R "Room" { type: "room", at: "0,0", size: "3x3" }
        d1 "door" { type: "door", at: "Nope.east", width: 0.9 }
      }
    `);
    expect(msgs.some((m) => m.includes('unknown room'))).toBe(true);
  });

  it('accepts the fp/floor aliases', () => {
    const ir = irOf(`
      fp "T" {
        R "Room" { type: "room", at: "0,0", size: "3x3" }
      }
    `);
    expect(ir.type).toBe('floorplan');
  });

  it('sheet block sets title-block scale/author/date', () => {
    const ir = irOf(`
      fp "T" {
        meta [sheet] { type: "sheet", scale: "1:50", author: "A", date: "D" }
        R "Room" { type: "room", at: "0,0", size: "3x3" }
      }
    `);
    expect(ir.metadata.titleBlock).toMatchObject({ title: 'T', scale: '1:50', author: 'A', date: 'D' });
  });
});
