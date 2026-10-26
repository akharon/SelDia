// =============================================================================
// SelDiA — fenceToSource: the one map from Markdown fence language to source
// =============================================================================
import { describe, it, expect } from 'vitest';
import { fenceToSource } from '../src/import/fence.js';
import { createEngine } from '../src/index.js';

describe('fenceToSource', () => {
  it('maps spice, circuit and netlist to a circuit header plus the raw body', () => {
    for (const lang of ['spice', 'circuit', 'netlist']) {
      expect(fenceToSource(lang, 'R1 a b 1k')).toEqual({ kind: 'circuit', source: 'circuit\nR1 a b 1k' });
    }
  });
  it('maps kicad to pcb when the body is a board, else to circuit', () => {
    expect(fenceToSource('kicad', '(kicad_pcb (version 1))')?.kind).toBe('pcb');
    expect(fenceToSource('kicad', '  (kicad_pcb (version 1))')?.kind).toBe('pcb');
    expect(fenceToSource('kicad', 'R1 a b 1k')?.kind).toBe('circuit');
  });
  it('maps pcb to pcb', () => {
    expect(fenceToSource('pcb', '(kicad_pcb)')).toEqual({ kind: 'pcb', source: 'pcb\n(kicad_pcb)' });
  });
  it('keeps seldia, mermaid and plantuml as their own kinds', () => {
    expect(fenceToSource('seldia', 'diagram flowchart "A" {}')).toEqual({ kind: 'seldia', source: 'diagram flowchart "A" {}' });
    expect(fenceToSource('mermaid', 'flowchart LR')?.kind).toBe('mermaid');
    expect(fenceToSource('puml', '@startuml')?.kind).toBe('plantuml');
  });
  it('returns null for unknown languages and is case-insensitive', () => {
    expect(fenceToSource('js', 'const a = 1;')).toBeNull();
    expect(fenceToSource('text', '')).toBeNull();
    expect(fenceToSource('SPICE', 'R1 a b 1k')?.kind).toBe('circuit');
  });
  it('wrapped raw-body sources compile through the engine parser', () => {
    const engine = createEngine();
    const f = fenceToSource('spice', 'V1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n.end');
    const p: any = engine.parse(f!.source);
    expect(p.ok).toBe(true);
    expect(p.value.type).toBe('circuit');
  });
});
