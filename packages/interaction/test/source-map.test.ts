// =============================================================================
// SelDiA — Source map builder tests
// =============================================================================
import { describe, it, expect } from 'vitest';
import { buildSourceMap } from '../src/source-map-builder.js';

describe('buildSourceMap', () => {
  it('maps a node id to the correct source line', () => {
    const src = `a: (Start)\nb --> a\n`;
    const map = buildSourceMap(src, 'test.sld');
    const entry = map.entries.get('a');
    expect(entry).toBeDefined();
    expect(entry!.elementType).toBe('node');
    expect(entry!.declarationLoc.startLine).toBe(1);
  });

  it('maps edges to their declaration lines', () => {
    const src = `a: (Start)\nb: [End]\na --> b\n`;
    const map = buildSourceMap(src, 'test.sld');
    const edgeEntry = [...map.entries.values()].find((e) => e.elementType === 'edge');
    expect(edgeEntry).toBeDefined();
    expect(edgeEntry!.declarationLoc.startLine).toBe(3);
  });

  it('a source with no matching declarations still returns a well-formed empty map', () => {
    const src = `// just a comment\nnothing structural here\n`;
    const map = buildSourceMap(src, 'test.sld');
    expect(map.entries.size).toBe(0);
    expect(map.offsetToId.size).toBe(0);
    expect(map.filePath).toBe('test.sld');
    expect(map.sourceText).toBe(src);
  });
});
