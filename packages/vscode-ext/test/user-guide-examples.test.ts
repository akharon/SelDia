// docs/user_guide.md examples must compile. Every ```seldia fence, and every
// untagged fence that opens with a complete `diagram <type> "..." {` header, is
// compiled with the real engine (same harness as skill-examples.test.ts).
// Intentional fragments belong in ```text fences.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEngine } from '@seldia/core';

const GUIDE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'user_guide.md');

interface Fence { title: string; source: string; line: number }

function extract(md: string): Fence[] {
  const out: Fence[] = [];
  const lines = md.split('\n');
  let heading = '(top)';
  let open = -1;
  let tag = '';
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (open === -1) {
      if (/^#{2,4}\s+/.test(l)) heading = l.replace(/^#+\s+/, '');
      const m = /^```(\w*)\s*$/.exec(l);
      if (m) { open = i + 1; tag = m[1]; buf = []; }
      continue;
    }
    if (l.trim() === '```') {
      const src = buf.join('\n');
      const complete = /^\s*(diagram\s+[\w-]+|fl)\s+"[^"]*"\s*\{/.test(src);
      if (tag === 'seldia' || (tag === '' && complete)) out.push({ title: heading, source: src, line: open + 1 });
      open = -1;
    } else buf.push(l);
  }
  return out;
}

const fences = extract(readFileSync(GUIDE, 'utf8'));

describe('user_guide.md seldia examples', () => {
  it('extraction found the corpus', () => {
    expect(fences.length).toBeGreaterThanOrEqual(20);
  });
  const engine = createEngine();
  for (const f of fences) {
    it(`compiles: ${f.title} (line ${f.line})`, async () => {
      const r = await engine.compile(f.source, 'user_guide.md');
      if (!r.ok) {
        const msgs = r.errors.map((e) => `[${e.severity}] L${e.source.startLine}: ${e.message}`).join('\n');
        throw new Error(`example "${f.title}" does not compile:\n${msgs}\n---\n${f.source}`);
      }
      expect(r.value.svg).toContain('<svg');
      expect(r.value.stats.nodeCount).toBeGreaterThan(0);
    });
  }
});
