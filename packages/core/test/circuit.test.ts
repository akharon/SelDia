import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpice, parseKicadNetlist, parseNetlist, circuitToIR, createEngine, MAX_PARTS } from '../src/index.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'circuits');
const norm = (m: Record<string, string[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));

describe('circuit importers vs fixtures', () => {
  for (const f of readdirSync(dir).filter((x) => /\.(cir|net)$/.test(x))) {
    const base = f.replace(/\.(cir|net)$/, '');
    it(base, () => {
      const src = readFileSync(join(dir, f), 'utf8');
      const exp = JSON.parse(readFileSync(join(dir, base + '.expected.json'), 'utf8'));
      const got = f.endsWith('.net') ? parseKicadNetlist(src) : parseSpice(src);
      expect(got.parts.map((p) => ({ ref: p.ref, kind: p.kind, pins: p.pins }))).toEqual(
        exp.parts.map((p: any) => ({ ref: p.ref, kind: p.kind, pins: p.pins })));
      expect(norm(got.nets)).toEqual(norm(exp.nets));
      expect([...got.powerNets].sort()).toEqual([...exp.powerNets].sort());
    });
  }
});

describe('every pin is connected', () => {
  for (const f of readdirSync(dir).filter((x) => /\.(cir|net)$/.test(x))) {
    it(f, () => {
      const src = readFileSync(join(dir, f), 'utf8');
      const ir = circuitToIR(f.endsWith('.net') ? parseKicadNetlist(src) : parseSpice(src));
      const used = new Set<string>();
      for (const e of ir.edges) { const d = e.data as any; if (d.srcPin) used.add(`${e.sourceId}.${d.srcPin}`); if (d.tgtPin) used.add(`${e.targetId}.${d.tgtPin}`); }
      const open: string[] = [];
      for (const n of ir.nodes) if ((n.data as any).role === 'part') for (const p of (n.data as any).pins) if (!used.has(`${n.id}.${p}`)) open.push(`${n.id}.${p}`);
      expect(open).toEqual([]);
    });
  }
});

describe('circuit pipeline', () => {
  const eng = createEngine();
  it('renders every fixture end-to-end', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.cir'))) {
      const r = eng.compileSync('circuit {\n' + readFileSync(join(dir, f), 'utf8') + '\n}');
      expect(r.ok, f).toBe(true);
      if (r.ok) expect(r.value.svg).toContain('<svg');
    }
  });
  it('2-pin nets are edges, 3+ pin nets get a junction, ground gets per-pin symbols', () => {
    const ir = circuitToIR(parseSpice(readFileSync(join(dir, '02-rc-lowpass.cir'), 'utf8')));
    expect(ir.nodes.some((n) => (n.data as any).role === 'junction')).toBe(false);
    const ir2 = circuitToIR(parseSpice(readFileSync(join(dir, '08-edge-cases.cir'), 'utf8')));
    expect(ir2.nodes.filter((n) => (n.data as any).role === 'junction').length).toBeGreaterThan(0);
    expect(ir2.nodes.filter((n) => (n.data as any).role === 'power').length).toBe(4);
  });
  it('accepts a quoted title and a KiCad body', () => {
    const r = eng.compileSync('circuit "KiCad" {\n' + readFileSync(join(dir, '09-skidl-rc.net'), 'utf8') + '\n}');
    expect(r.ok).toBe(true);
  });
  it('warns above the part budget but still renders', () => {
    let src = 'big\nV1 n0 0 5\n';
    for (let i = 1; i <= MAX_PARTS + 5; i++) src += `R${i} n${i - 1} n${i} 1k\n`;
    src += `Rl n${MAX_PARTS + 5} 0 1k\n`;
    const m = parseNetlist(src);
    expect(m.warnings.join()).toMatch(/exceeds/);
    const r = eng.compileSync('circuit {\n' + src + '}');
    expect(r.ok).toBe(true);
  });
  it('ignores analysis directives', () => {
    const m = parseSpice('t\nR1 a 0 1k\n.model foo D\n.ac dec 10 1 1k\n.tran 1n 1u\n.options x=1\n.print tran v(a)\n.end');
    expect(m.parts.length).toBe(1);
    expect(m.warnings).toEqual([]);
  });
});
