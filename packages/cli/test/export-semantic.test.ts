// =============================================================================
// SelDiA CLI — `export --to bpmn` / `export --to sql-ddl` tests
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

describe('seldia export --to bpmn / sql-ddl', () => {
  let dir: string;
  let bpmnFile: string;
  let erFile: string;
  let flowchartFile: string;

  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`CLI not built: ${CLI} does not exist. Run "npm run build" in packages/cli first.`);
    }
    dir = mkdtempSync(join(tmpdir(), 'seldia-cli-export-sem-'));

    bpmnFile = join(dir, 'proc.sld');
    writeFileSync(
      bpmnFile,
      // Shape syntax per resources/templates/bpmn.sld: (event) [task] {gateway}.
      `diagram bpmn "Vacation Request" {\n    start: (Request Submitted)\n    approve: [Manager Approves]\n    done: (Approved)\n\n    start --> approve --> done\n}\n`
    );

    erFile = join(dir, 'schema.sld');
    writeFileSync(
      erFile,
      `diagram er "Shop" {\n    user: "User\\nid: UUID PK\\nname: string"\n    order: "Order\\nid: UUID PK\\nuserId: UUID FK"\n\n    user -->|"1 : *"| order\n}\n`
    );

    flowchartFile = join(dir, 'flow.sld');
    writeFileSync(flowchartFile, `diagram flowchart "F" {\n    a --> b\n}\n`);
  });

  it('exports a BPMN diagram to BPMN 2.0 XML', () => {
    const { stdout, status } = run(['export', bpmnFile, '--to', 'bpmn']);
    expect(status).toBe(0);
    expect(stdout).toContain('<bpmn:definitions');
    expect(stdout).toContain('<bpmn:startEvent');
  });

  it('rejects a non-BPMN diagram for --to bpmn', () => {
    const { stderr, status } = run(['export', flowchartFile, '--to', 'bpmn']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/cannot be exported to bpmn/i);
  });

  it('exports an ER diagram to SQL DDL', () => {
    const { stdout, status } = run(['export', erFile, '--to', 'sql-ddl']);
    expect(status).toBe(0);
    expect(stdout).toContain('CREATE TABLE User');
    expect(stdout).toContain('CREATE TABLE Order');
  });

  it('rejects a non-ER diagram for --to sql-ddl', () => {
    const { stderr, status } = run(['export', flowchartFile, '--to', 'sql-ddl']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/cannot be exported to sql-ddl/i);
  });

  it('writes BPMN XML to -o/--output', () => {
    const outPath = join(dir, 'proc.bpmn.xml');
    const { status } = run(['export', bpmnFile, '--to', 'bpmn', '-o', outPath]);
    expect(status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, 'utf-8')).toContain('<bpmn:definitions');
  });

  it('lists all three supported targets on an unsupported --to', () => {
    const { stderr, status } = run(['export', flowchartFile, '--to', 'graphml']);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/mermaid, bpmn, sql-ddl/);
  });
});
