// =============================================================================
// SelDiA VS Code — SKILL.md examples must compile
// =============================================================================
// The seldia-dsl skill (packages/vscode-ext/resources/skills/seldia-dsl/
// SKILL.md, deployed to ~/.claude/skills and ~/.copilot/skills by
// install-vscode.sh) is the grammar reference AI assistants author diagrams
// from. Every ```seldia fence in it is extracted here and compiled with the
// real engine, so the skill can never drift from the parser again — the
// 2026-07 skill documented an aspirational grammar the engine rejected.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEngine } from '@seldia/core';

const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'resources', 'skills', 'seldia-dsl', 'SKILL.md',
);

interface Fence { title: string; source: string; line: number }

function extractSeldiaFences(md: string): Fence[] {
  const fences: Fence[] = [];
  const lines = md.split('\n');
  let heading = '(top)';
  let open = -1;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (open === -1 && /^#{2,3}\s+/.test(l)) heading = l.replace(/^#+\s+/, '');
    if (open === -1 && l.trim() === '```seldia') { open = i + 1; buf = []; continue; }
    if (open !== -1) {
      if (l.trim() === '```') {
        fences.push({ title: heading, source: buf.join('\n'), line: open + 1 });
        open = -1;
      } else buf.push(l);
    }
  }
  return fences;
}

const fences = extractSeldiaFences(readFileSync(SKILL_PATH, 'utf8'));

describe('SKILL.md seldia examples', () => {
  it('the committed .github/skills copy matches the canonical source', () => {
    // packages/vscode-ext/resources/skills/… is canonical (the installer
    // reads it); .github/skills/… is the committed workspace-scope copy.
    const githubCopy = join(dirname(SKILL_PATH), '..', '..', '..', '..', '..', '.github', 'skills', 'seldia-dsl', 'SKILL.md');
    expect(readFileSync(githubCopy, 'utf8')).toBe(readFileSync(SKILL_PATH, 'utf8'));
  });

  it('covers every diagram section (sanity: extraction found the corpus)', () => {
    // 24 fences today (two C4 levels, three chart variants). A drop below 20
    // means the extractor or the doc structure broke, not the grammar.
    expect(fences.length).toBeGreaterThanOrEqual(20);
  });

  const engine = createEngine();

  for (const f of fences) {
    it(`compiles: ${f.title} (line ${f.line})`, async () => {
      const result = await engine.compile(f.source, 'SKILL.md');
      if (!result.ok) {
        const msgs = result.errors.map((e) => `[${e.severity}] L${e.source.startLine}: ${e.message}`).join('\n');
        throw new Error(`SKILL.md example "${f.title}" does not compile:\n${msgs}\n---\n${f.source}`);
      }
      // A "successful" compile that dropped the whole body is the silent-drop
      // failure mode (old mindmap example: 4 nodes, 0 edges, structure gone).
      expect(result.value.svg).toContain('<svg');
      expect(result.value.stats.nodeCount).toBeGreaterThan(0);
    });
  }
});
