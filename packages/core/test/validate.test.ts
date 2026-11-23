import { describe, it, expect } from 'vitest';
import { createEngine, validateDiagram, validateDocument, languageForPath, formatValidationReport } from '../src/index.js';

const engine = createEngine();

describe('validateDiagram', () => {
  it('passes a valid SelDiA diagram', async () => {
    const v = await validateDiagram(engine, 'seldia', 'diagram flowchart "A" {\n  a -> b\n}');
    expect(v.issues).toEqual([]);
    expect(v.type).toBe('flowchart');
  });

  it('reports a SelDiA syntax error with its line', async () => {
    const v = await validateDiagram(engine, 'seldia', 'diagram flowchart "A" {\n  a -> b\n  data { x }\n}');
    expect(v.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(v.issues[0].line).toBeGreaterThan(1);
  });

  it('reports Mermaid statements the importer drops', async () => {
    const v = await validateDiagram(engine, 'mermaid', 'sequenceDiagram\n  A->>B: hi\n  ??? nonsense');
    expect(v.issues).toEqual([expect.objectContaining({ line: 3, severity: 'warning' })]);
  });

  it('reports a failed PlantUML import as an error', async () => {
    const v = await validateDiagram(engine, 'plantuml', '');
    expect(v.issues[0].severity).toBe('error');
  });

  it('rejects an unknown language', async () => {
    const v = await validateDiagram(engine, 'graphviz', 'digraph {}');
    expect(v.issues[0].message).toMatch(/Unsupported/);
  });
});

describe('validateDocument', () => {
  it('maps fence issues to Markdown file lines', async () => {
    const md = ['# T', '', '```mermaid', 'sequenceDiagram', '  A->>B: hi', '  ??? x', '```', '', '```seldia', 'diagram flowchart "A" {', '  a -> b', '}', '```'].join('\n');
    const res = await validateDocument(engine, md, 'markdown');
    expect(res).toHaveLength(2);
    expect(res[0].startLine).toBe(4);
    expect(res[0].issues[0].line).toBe(6);
    expect(res[1].issues).toEqual([]);
    expect(formatValidationReport(res, 'x.md')).toContain('x.md:6 warning');
  });

  it('picks the language from the file extension', () => {
    expect(languageForPath('a/b.sld')).toBe('seldia');
    expect(languageForPath('c.puml')).toBe('plantuml');
    expect(languageForPath('d.MD')).toBe('markdown');
    expect(languageForPath('e.txt')).toBeNull();
  });
});
