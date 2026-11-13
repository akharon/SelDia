import { describe, it, expect } from 'vitest';
import { createEngine, checkDiagramQuality, formatCheckReport } from './index.js';

describe('checkDiagramQuality', () => {
  it('reports a simple diagram', async () => {
    const r = await checkDiagramQuality(createEngine(), 'seldia', 'diagram flowchart "T" {\n  a: [A]\n  b: [B]\n  a --> b\n}\n');
    expect(r.error).toBeUndefined();
    expect(r.type).toBe('flowchart');
    expect(formatCheckReport(r)).toContain('flowchart');
  });
  it('reports errors for unsupported language', async () => {
    const r = await checkDiagramQuality(createEngine(), 'nope', 'x');
    expect(r.error).toBeDefined();
    expect(formatCheckReport(r)).toMatch(/^Error:/);
  });
});
