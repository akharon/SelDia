import { describe, it, expect } from 'vitest';
import { createEngine, importCircuit, importPlantUml } from '../src/index.js';
import { fanPorts } from '../src/render/edge-layer.js';
import { mosfetSymbol } from '../src/circuit/symbols.js';

const P = (x: number, y: number) => ({ x, y });
const box = (id: string, x: number, y: number, w: number, h: number): any => ({ id, shape: 'rectangle', position: P(x, y), size: { width: w, height: h } });

describe('E1 rank hints never fail a render', () => {
  it('two connected parts both hinted: renders with a warning', () => {
    const src = 'T\nV2 src 0 AC 10m\nC1 src b1 10u\nR1 b1 0 1k\nRL b1 0 1k\n* @seldia rank in V2 C1\n* @seldia rank out R1 RL\n.end';
    const { ir } = importCircuit(src);
    const l = createEngine().layout(ir!);
    expect(l.ok).toBe(true);
    expect(JSON.stringify((l as any).value.warnings ?? [])).toMatch(/rank in/);
  });
});

describe('E2 port fanning', () => {
  it('spreads two ends on one side and keeps them ordered by approach', () => {
    const hub = box('hub', 200, 150, 100, 50);
    const routes = new Map([
      ['a', [P(129, 45), P(189, 45), P(189, 85), P(250, 85), P(250, 147)]],
      ['b', [P(250, 73), P(250, 147)]],
    ]);
    const out = fanPorts(routes, [hub]);
    const xa = out.get('a')!.at(-1)!.x, xb = out.get('b')!.at(-1)!.x;
    expect(xa).toBeCloseTo(233.3, 0);
    expect(xb).toBeCloseTo(266.7, 0);
    expect(out.get('a')!.at(-1)!.y).toBe(147);
  });
  it('leaves a lone end alone', () => {
    const r = new Map([['a', [P(250, 73), P(250, 147)]]]);
    expect(fanPorts(r, [box('hub', 200, 150, 100, 50)])).toEqual(r);
  });
  it('fan-in no longer overlaps in a rendered flowchart', () => {
    const r = createEngine().compileSync('fl "F" {\n    a [A]\n    b [B]\n    h [Hub]\n    a -> h\n    b -> h\n}');
    expect(r.ok).toBe(true);
  });
});

describe('E3 MOSFET symbols', () => {
  it('PMOS has source on top and drain on bottom, NMOS the reverse', () => {
    const pins = (s: any) => Object.fromEntries(s.pins.map((p: any) => [p.name, p.y ?? p.position?.y]));
    const n = pins(mosfetSymbol(false)), p = pins(mosfetSymbol(true));
    expect(n.D).toBeLessThan(n.S);
    expect(p.S).toBeLessThan(p.D);
  });
  it('body tied to source drops the B pin', () => {
    const names = (s: any) => s.pins.map((p: any) => p.name);
    expect(names(mosfetSymbol(false, true))).not.toContain('B');
    expect(names(mosfetSymbol(false, false))).toContain('B');
  });
});

describe('E4 in-fence edges directive', () => {
  const mk = (d: string) => `fl "E" {\n${d}    a [A]\n    b [B]\n    c [C]\n    a -> b\n    a -> c\n    b -> c\n}`;
  const body = mk('');
  const svg = (s: string) => { const r = createEngine().compileSync(s); expect(r.ok).toBe(true); return (r as any).value.svg as string; };
  it('edges sketch changes the output vs default', () => {
    expect(svg(mk('    edges sketch\n'))).not.toBe(svg(body));
  });
  it('edges clean equals the default', () => {
    expect(svg(mk('    edges clean\n'))).toBe(svg(body));
  });
  it('edges is still usable as a node id', () => {
    const r = createEngine().compileSync('fl "N" {\n    edges [Edges]\n    x [X]\n    edges -> x\n}');
    expect(r.ok).toBe(true);
  });
});

describe('E5 non-diagram PlantUML blocks degrade gracefully', () => {
  it('@startjson returns no IR and a diagnostic', () => {
    const r = importPlantUml('@startjson\n{"a":1}\n@endjson');
    expect(r.ir).toBeUndefined();
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
});
