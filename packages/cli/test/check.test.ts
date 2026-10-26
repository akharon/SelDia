// =============================================================================
// SelDiA CLI — `check` command tests
// =============================================================================
// Runs the built CLI on a small Markdown file with two diagram fences and
// checks the per-diagram report, --json output and the --max exit code.
// Thresholds are chosen so the assertions do not depend on exact layout numbers.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(__dirname, '../dist/index.js');

function run(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { stdout, status: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? '', status: err.status ?? 1 };
  }
}

describe('seldia check', () => {
  let dir: string;
  let md: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`CLI not built: ${CLI} does not exist. Run "npm run build" in packages/cli first.`);
    }
    dir = mkdtempSync(join(tmpdir(), 'seldia-cli-check-'));
    md = join(dir, 'doc.md');
    writeFileSync(md, [
      '# Doc',
      '',
      '```seldia',
      'diagram flowchart "A" {',
      '  a (Start)',
      '  b [End]',
      '  a -> b',
      '}',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  x --> y',
      '```',
      '',
      '```js',
      'const not = "a diagram";',
      '```',
      '',
    ].join('\n'));
  });

  it('prints one line per diagram fence, skipping other languages', () => {
    const { stdout, status } = run(['check', md]);
    expect(status).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^#1 flowchart\s/);
    expect(lines[1]).toMatch(/^#2 flowchart\s/);
  });

  it('emits JSON with per-diagram problems when --json is given', () => {
    const { stdout, status } = run(['check', md, '--json']);
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.diagrams.map((d: any) => [d.index, d.lang, d.type])).toEqual([[1, 'seldia', 'flowchart'], [2, 'mermaid', 'flowchart']]);
    expect(typeof out.diagrams[0].total).toBe('number');
    expect(out.failing).toBe(false);
  });

  it('exits 1 when a diagram exceeds --max', () => {
    // A negative threshold is exceeded by any diagram, however clean.
    expect(run(['check', md, '--max', '-1']).status).toBe(1);
  });

  it('exits 0 when every diagram is within a generous --max', () => {
    expect(run(['check', md, '--max', '1000']).status).toBe(0);
  });

  it('rejects unsupported file types', () => {
    const txt = join(dir, 'notes.txt');
    writeFileSync(txt, 'hello');
    expect(run(['check', txt]).status).toBe(1);
  });
});

describe('seldia check: raw-body fences', () => {
  it('checks ```spice (circuit) and ```kicad board (pcb) fences', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seldia-cli-check-raw-'));
    const md = join(dir, 'raw.md');
    writeFileSync(md, [
      '```spice',
      '* divider',
      'V1 in 0 DC 5',
      'R1 in out 1k',
      'R2 out 0 1k',
      '.end',
      '```',
      '',
      '```kicad',
      '(kicad_pcb (version 20221018) (generator pcbnew)',
      '  (footprint "R_0603" (layer "F.Cu") (at 10 10)',
      '    (pad "1" smd rect (at -0.8 0) (size 0.8 0.8) (layers "F.Cu"))))',
      '```',
      '',
    ].join('\n'));
    const { stdout, status } = run(['check', md, '--json']);
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.diagrams.map((d: any) => [d.index, d.lang, d.type])).toEqual([[1, 'spice', 'circuit'], [2, 'kicad', 'pcb']]);
    expect(out.diagrams.every((d: any) => d.error === undefined)).toBe(true);
  });
});

