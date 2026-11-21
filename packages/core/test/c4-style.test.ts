import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';

/** Colours inside one node's <g>. */
function nodeColours(svg: string, id: string): string[] {
  const i = svg.indexOf(`data-seldia-node-id="${id}"`);
  const j = svg.indexOf('</g>', i);
  return [...new Set(svg.slice(i, j).match(/(?:fill|stroke)="[^"]+"/g) ?? [])];
}

const SRC = (attrs: string) => `diagram c4 context "T" {
    person customer: "Bank Customer" ${attrs}
    system banking: "Banking"
    system_Ext mail: "Mail" ${attrs}
    customer --> banking: "uses"
}`;

describe('C4 explicit styles', () => {
  const engine = createEngine();

  it('a person figure is painted with its explicit fill', () => {
    const r = engine.compileSync(SRC('{ fill: "#ff8800" }'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(nodeColours(r.value.svg, 'customer')).toContain('fill="#ff8800"');
  });

  it('an external system honours an explicit fill instead of the grey default', () => {
    const r = engine.compileSync(SRC('{ fill: "steelblue" }'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(nodeColours(r.value.svg, 'mail')).toContain('fill="steelblue"');
  });
});
