// =============================================================================
// SelDiA CLI — `diff` command tests
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
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

describe('seldia diff', () => {
  let dir: string;
  let oldFile: string;
  let newFile: string;
  let sameFile: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`CLI not built: ${CLI} does not exist. Run "npm run build" in packages/cli first.`);
    }
    dir = mkdtempSync(join(tmpdir(), 'seldia-cli-diff-'));

    oldFile = join(dir, 'old.sld');
    writeFileSync(oldFile, `diagram flowchart "F" {\n    a: [A]\n    b: [B]\n    a --> b\n}\n`);

    newFile = join(dir, 'new.sld');
    writeFileSync(newFile, `diagram flowchart "F" {\n    a: [A]\n    b: [B]\n    c: [C]\n    a --> b\n    b --> c\n}\n`);

    sameFile = join(dir, 'same.sld');
    writeFileSync(sameFile, `diagram flowchart "F" {\n    a: [A]\n    b: [B]\n    a --> b\n}\n`);
  });

  it('exits 0 with "no structural changes" for identical diagrams', () => {
    const { stdout, status } = run(['diff', oldFile, sameFile]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/no structural changes/i);
  });

  it('exits non-zero and reports added node/edge for a changed diagram', () => {
    const { stdout, status } = run(['diff', oldFile, newFile]);
    expect(status).not.toBe(0);
    expect(stdout).toContain('+ node c');
    expect(stdout).toMatch(/\+ edge .*b -> c/);
  });

  it('supports --format json', () => {
    const { stdout, status } = run(['diff', oldFile, newFile, '--format', 'json']);
    expect(status).not.toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.identical).toBe(false);
    expect(parsed.summary.nodesAdded).toBe(1);
    expect(parsed.summary.edgesAdded).toBe(1);
  });

  it('exits non-zero when a file does not exist', () => {
    const { stderr, status } = run(['diff', join(dir, 'nope.sld'), newFile]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/File not found/i);
  });
});
