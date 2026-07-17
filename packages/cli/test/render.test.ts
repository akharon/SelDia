// =============================================================================
// SelDiA CLI — `render` command tests
// =============================================================================
// Exercises the built CLI binary end to end: scans a fixture directory tree
// for .sld files and ```seldia fenced Markdown blocks, renders them to SVG,
// and checks the output directory. This is the same command the GitHub
// Action shells out to, so it doubles as the Action's core-logic test since
// GitHub-hosted execution and the commit-back step aren't practical to
// exercise in this environment (see .github/actions/seldia-render/README.md).
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(__dirname, '../dist/index.js');

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf-8' });
    return { stdout, stderr: '', status: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', status: err.status ?? 1 };
  }
}

describe('seldia render', () => {
  let dir: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`CLI not built: ${CLI} does not exist. Run "npm run build" in packages/cli first.`);
    }
    dir = mkdtempSync(join(tmpdir(), 'seldia-cli-render-'));

    writeFileSync(join(dir, 'diagram.sld'), 'diagram flowchart "Test" {\n  a (Start)\n  b [End]\n  a -> b\n}\n');

    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'arch.md'),
      [
        '# Architecture',
        '',
        '```seldia',
        'diagram flowchart "Fenced" {',
        '  a (A)',
        '  b [B]',
        '  a -> b',
        '}',
        '```',
        '',
        'Some prose, no other diagrams.',
      ].join('\n')
    );
  });

  it('renders a standalone .sld file to the output directory', () => {
    const outDir = join(dir, 'out1');
    const { status, stdout } = run(['render', dir, '-o', outDir]);
    expect(status).toBe(0);
    expect(existsSync(join(outDir, 'diagram.svg'))).toBe(true);
    const svg = readFileSync(join(outDir, 'diagram.svg'), 'utf-8');
    expect(svg).toContain('<svg');
    expect(stdout).toContain('diagram.sld');
  });

  it('renders a ```seldia fenced block from a .md file', () => {
    const outDir = join(dir, 'out2');
    const { status } = run(['render', dir, '-o', outDir]);
    expect(status).toBe(0);
    expect(existsSync(join(outDir, 'docs__arch.svg'))).toBe(true);
    const svg = readFileSync(join(outDir, 'docs__arch.svg'), 'utf-8');
    expect(svg).toContain('<svg');
  });

  it('reports how many diagrams were rendered', () => {
    const outDir = join(dir, 'out3');
    const { stdout } = run(['render', dir, '-o', outDir]);
    expect(stdout).toMatch(/Rendered 2\/2 diagram/);
  });

  it('exits non-zero when the target directory does not exist', () => {
    const { status, stderr } = run(['render', join(dir, 'does-not-exist')]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/Directory not found/i);
  });

  it('reports zero diagrams found for a directory with no matches', () => {
    const empty = mkdtempSync(join(tmpdir(), 'seldia-cli-render-empty-'));
    const outDir = join(empty, 'out');
    const { status, stdout } = run(['render', empty, '-o', outDir]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/No \.sld files/i);
  });

  it('exits non-zero and still writes successful outputs when one diagram fails to compile', () => {
    const mixed = mkdtempSync(join(tmpdir(), 'seldia-cli-render-mixed-'));
    writeFileSync(join(mixed, 'good.sld'), 'diagram flowchart "Good" {\n  a (A)\n  b [B]\n  a -> b\n}\n');
    writeFileSync(join(mixed, 'bad.sld'), 'not a valid diagram at all {{{\n');

    const outDir = join(mixed, 'out');
    const { status, stdout, stderr } = run(['render', mixed, '-o', outDir]);
    expect(status).not.toBe(0);
    expect(existsSync(join(outDir, 'good.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'bad.svg'))).toBe(false);
    expect(stdout).toMatch(/Rendered 1\/2/);
    expect(stderr).toMatch(/bad\.sld/);
  });
});
