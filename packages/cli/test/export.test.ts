// =============================================================================
// SelDiA CLI — `export` command tests
// =============================================================================
// Exercises the built CLI binary end to end (spawned as a child process),
// since the command's job is wiring stdin/stdout/exit-codes together rather
// than logic worth unit-testing in isolation. Requires `npm run build` to
// have produced packages/cli/dist/index.js first.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

describe('seldia export', () => {
  let dir: string;
  let flowchartFile: string;
  let c4File: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`CLI not built: ${CLI} does not exist. Run "npm run build" in packages/cli first.`);
    }
    dir = mkdtempSync(join(tmpdir(), 'seldia-cli-export-'));

    flowchartFile = join(dir, 'flow.sld');
    writeFileSync(
      flowchartFile,
      `diagram flowchart "Test" {\n    start (Start)\n    proc [Process]\n    endx (End)\n\n    start --> proc\n    proc --> endx\n}\n`
    );

    c4File = join(dir, 'c4.sld');
    writeFileSync(
      c4File,
      `diagram c4 context "Test" {\n    person user "User"\n    system sys "System"\n\n    user --> sys\n}\n`
    );
  });

  it('prints Mermaid text to stdout for a supported diagram type', () => {
    const { stdout, status } = run(['export', flowchartFile, '--to', 'mermaid']);
    expect(status).toBe(0);
    expect(stdout).toContain('flowchart TD');
    expect(stdout).toContain('start');
    expect(stdout).toContain('proc');
  });

  it('writes to -o/--output instead of stdout when given', () => {
    const outPath = join(dir, 'flow.mmd');
    const { status, stdout } = run(['export', flowchartFile, '--to', 'mermaid', '-o', outPath]);
    expect(status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const written = readFileSync(outPath, 'utf-8');
    expect(written).toContain('flowchart TD');
    // The success message goes to stdout, not the diagram itself.
    expect(stdout).not.toContain('flowchart TD');
  });

  it('exits non-zero with a clear message for an unsupported diagram type', () => {
    const { stderr, status } = run(['export', c4File, '--to', 'mermaid']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/cannot be exported to Mermaid/i);
  });

  it('exports a flowchart to PlantUML', () => {
    const outPath = join(dir, 'flow.puml');
    const { status } = run(['export', flowchartFile, '--to', 'plantuml', '-o', outPath]);
    expect(status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const puml = readFileSync(outPath, 'utf-8');
    expect(puml).toContain('@startuml');
    expect(puml).toContain('@enduml');
  });

  it('accepts "puml" as an alias for the plantuml target', () => {
    const outPath = join(dir, 'flow-alias.puml');
    const { status } = run(['export', flowchartFile, '--to', 'puml', '-o', outPath]);
    expect(status).toBe(0);
    expect(readFileSync(outPath, 'utf-8')).toContain('@startuml');
  });

  it('exits non-zero for an unsupported --to target', () => {
    const { stderr, status } = run(['export', flowchartFile, '--to', 'graphml']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/Unsupported export target/i);
  });

  it('exits non-zero when the input file does not exist', () => {
    const { stderr, status } = run(['export', join(dir, 'nope.sld'), '--to', 'mermaid']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/File not found/i);
  });

  it('exits non-zero when --to is omitted (required option)', () => {
    const { status } = run(['export', flowchartFile]);
    expect(status).not.toBe(0);
  });
});
