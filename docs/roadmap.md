# Marp → PPTX Export

Implementation plan. Every step is concrete; follow them in order.

---

## 1. Background — why not just shell out to `marp-cli`

The obvious idea is `npx @marp-team/marp-cli --pptx slides.md -o out.pptx`. It was
investigated and rejected. Findings, all verified against `@marp-team/marp-cli@4.5.1`:

**Marp CLI's default `--pptx` is *not* a native PowerPoint export.** Its bundle
(`package/lib/pptxgen.es-*.js`) uses `pptxgenjs` to build a deck where **each slide is one
full-slide PNG screenshot** taken with Puppeteer. There is no text, no shapes — just a
picture per slide. So the "gap" is not that marp-cli loses our diagrams and we would gain
something by pre-rasterizing them; **marp-cli rasterizes everything anyway.**

**`--pptx-editable` exists but is worse for us.** It is flagged `[EXPERIMENTAL]`, and it
works by rendering to PDF and shelling out to a **local LibreOffice install** (`soffice`)
to convert PDF→PPTX. marp-cli's own warning string says "slide reproducibility is not
fully guaranteed." Requiring users to install LibreOffice is a non-starter for a VS Code
extension.

**Shelling out to marp-cli would also break diagrams.** marp-cli runs its *own* Marp Core
instance in its own process. It has no knowledge of SelDiA's fence renderer, so
` ```seldia `/` ```mermaid `/` ```plantuml ` fences would render as **plain code blocks**.
Recovering them would require the "pre-render diagrams to PNG + write a temp deck" dance
from the original idea — plus a new ~250MB `puppeteer-core`+CLI dependency, a subprocess,
and a temp-file lifecycle.

### Decision: do it in-process

We already have every piece:

| Piece | Where it already lives |
| --- | --- |
| Marp render + SelDiA/Mermaid/PlantUML fences | `src/marp/render.ts` → `renderMarpDeck()` |
| Full standalone HTML doc | `src/marp/render.ts` → `assembleMarpDocument()` |
| Headless Chrome | `puppeteer`, already a dependency, used by `src/md2pdf/pdf-renderer.ts` |
| Per-slide speaker notes | `renderMarpDeck()` already returns `notes: string[]` |
| Slide pixel size | Marp's own emitted CSS: `@page {size:1280px 720px;margin:0}` |

So: render the deck exactly as the preview already does, screenshot each `<section>`, and
place one image per slide with `pptxgenjs`. This is **the same output shape marp-cli's
default `--pptx` produces**, but with our diagrams rendered and with zero new heavy deps
(`pptxgenjs` is ~3MB, pure JS, no binaries) and no subprocess.

**This approach is verified working.** A probe rendered a 2-slide deck, read `1280x720`
out of the `@page` rule, screenshotted both top-level slide elements at
`deviceScaleFactor: 2`, and produced valid PNGs; a slide containing an inline `<svg>`
rasterized correctly with Marp theme typography intact.

Two known, accepted limitations — state them in the docs, do not try to solve them:
- Text in the PPTX is not selectable/editable (each slide is an image). Identical to
  marp-cli's default behavior.
- Speaker notes *are* carried over as real notes (step 5), so the deck is still useful.

---

## 2. Add the dependency

In `packages/vscode-ext/package.json`, add to `dependencies` (keep alphabetical order,
so it goes after `marked`):

```json
"pptxgenjs": "^4.0.1"
```

Then from the repo root run `npm install`.

**Do not** add it to the esbuild `external` list. Unlike `marp-core`/`puppeteer` it is
small and pure-JS, so it should be bundled straight into `extension.cjs`. Confirm
`packages/vscode-ext/scripts/build.mjs` does not need editing — only touch it if
`pptxgenjs` appears in an `external:` array, which it should not.

---

## 3. New file: `packages/vscode-ext/src/marp/pptx.ts`

Create this file. It is pure except for `writeFile`, so it is unit-testable without
VS Code.

```ts
// =============================================================================
// SelDiA — Marp Deck Export (PPTX)
// =============================================================================
// One slide-sized PNG per slide, placed edge-to-edge in a pptxgenjs deck.
//
// This mirrors what `marp-cli --pptx` does by default (it also screenshots each
// slide with Puppeteer and lays the images out with pptxgenjs), with one
// difference that is the whole point: we render through SelDiA's own Marp
// pipeline, so ```seldia / ```mermaid / ```plantuml fences come out as real
// diagrams instead of code blocks. marp-cli runs its own Marp Core in a
// separate process and has never heard of our fence renderer.
//
// marp-cli's `--pptx-editable` produces text-based slides, but only by shelling
// out to a local LibreOffice install, which we can't require of users.
// =============================================================================

import type { CoreEngine } from '@seldia/core';
import { renderMarpDeck, assembleMarpDocument } from './render.js';

export interface MarpPptxResult {
  success: boolean;
  outputPath?: string;
  slideCount?: number;
  errorMessage?: string;
}

export interface MarpPptxOptions {
  /** Rasterization scale. 2 = retina-sharp on projectors. */
  scale?: number;
  /** Include per-slide speaker notes. Default true. */
  includeNotes?: boolean;
  timeout?: number;
}

/** Marp writes its slide size into its own stylesheet as
 *  `@page {size:1280px 720px;margin:0}`. Read it rather than hardcoding, so
 *  4:3 decks and `size: 4K` directives produce correctly-shaped PPTX slides. */
export function readSlideSize(css: string): { width: number; height: number } {
  const m = /@page\s*{[^}]*\bsize:\s*([0-9.]+)px\s+([0-9.]+)px/.exec(css);
  if (!m) return { width: 1280, height: 720 };
  return { width: Number(m[1]), height: Number(m[2]) };
}
```

Then add the main function in the same file:

```ts
export async function exportMarpToPptx(
  engine: CoreEngine,
  markdown: string,
  outputPath: string,
  title?: string,
  options: MarpPptxOptions = {}
): Promise<MarpPptxResult> {
  let rendered;
  try {
    rendered = renderMarpDeck(engine, markdown);
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }

  const { width, height } = readSlideSize(rendered.css);
  const doc = assembleMarpDocument(rendered.html, rendered.css, title);

  let shots: string[];
  try {
    shots = await captureSlides(doc, width, height, options);
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }

  if (shots.length === 0) {
    return { success: false, errorMessage: 'No slides were found in this deck.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PptxGenJS = require('pptxgenjs');
    const pptx = new PptxGenJS();

    // PPTX geometry is in inches. Pin a custom layout matching the deck's own
    // aspect ratio at 96dpi so images fill the slide with no letterboxing.
    const wIn = width / 96;
    const hIn = height / 96;
    pptx.defineLayout({ name: 'SELDIA', width: wIn, height: hIn });
    pptx.layout = 'SELDIA';
    if (title) pptx.title = title;

    const includeNotes = options.includeNotes !== false;
    shots.forEach((data, i) => {
      const slide = pptx.addSlide();
      slide.addImage({ data, x: 0, y: 0, w: wIn, h: hIn });
      const note = includeNotes ? rendered.notes[i] : '';
      if (note) slide.addNotes(note);
    });

    await pptx.writeFile({ fileName: outputPath });
    return { success: true, outputPath, slideCount: shots.length };
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || String(err) };
  }
}
```

And the Puppeteer capture helper, also in the same file:

```ts
/** Screenshot each top-level slide, returning base64 PNG data URIs. */
async function captureSlides(
  html: string,
  width: number,
  height: number,
  options: MarpPptxOptions
): Promise<string[]> {
  let puppeteer: any;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    throw new Error('Puppeteer is not installed. Run: npm install puppeteer');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: options.scale ?? 2,
    });
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: options.timeout ?? 60000,
    });

    // Marp emits either <svg data-marpit-svg> wrappers or bare <section>s
    // depending on the `inlineSVG` setting, always as direct children of the
    // single outer div.marpit. Selecting on those direct children avoids
    // counting <svg>/<section> markup *inside* a rendered diagram.
    const slides = await page.$$(
      'div.marpit > svg[data-marpit-svg], div.marpit > section'
    );

    const out: string[] = [];
    for (const el of slides) {
      const buf = await el.screenshot({ type: 'png' });
      out.push(`image/png;base64,${Buffer.from(buf).toString('base64')}`);
    }
    return out;
  } finally {
    await browser.close();
  }
}
```

Note on the `data` string: pptxgenjs expects the `image/png;base64,<...>` form
**without** a leading `data:`. Do not add one.

---

## 4. Wire the command

### 4a. `packages/vscode-ext/src/extension.ts`

Line ~21 currently reads:

```ts
import { exportMarpToHtml, exportMarpToPdf } from './marp/export.js';
```

Add below it:

```ts
import { exportMarpToPptx } from './marp/pptx.js';
```

Then in the `seldia.exportMarp` command (~line 299), change the save dialog filters to
offer PPTX, and branch on the chosen extension. Replace:

```ts
    const uri = await vscode.window.showSaveDialog({
      filters: { 'PDF': ['pdf'], 'HTML': ['html'] },
      defaultUri: vscode.Uri.file(editor.document.fileName.replace(/\.(md|mdx)$/, '.pdf')),
    });
    if (!uri) return;

    const asPdf = uri.fsPath.endsWith('.pdf');
    const result = asPdf
      ? await exportMarpToPdf(engine, markdown, uri.fsPath, title)
      : exportMarpToHtml(engine, markdown, uri.fsPath, title);
```

with:

```ts
    const uri = await vscode.window.showSaveDialog({
      filters: { 'PDF': ['pdf'], 'PowerPoint': ['pptx'], 'HTML': ['html'] },
      defaultUri: vscode.Uri.file(editor.document.fileName.replace(/\.(md|mdx)$/, '.pdf')),
    });
    if (!uri) return;

    // PPTX and PDF both drive headless Chrome and can take a while on a long
    // deck, so they run under a progress notification; HTML is a direct write.
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting Marp deck…',
        cancellable: false,
      },
      async () => {
        if (uri.fsPath.endsWith('.pptx')) {
          return exportMarpToPptx(engine, markdown, uri.fsPath, title);
        }
        if (uri.fsPath.endsWith('.pdf')) {
          return exportMarpToPdf(engine, markdown, uri.fsPath, title);
        }
        return exportMarpToHtml(engine, markdown, uri.fsPath, title);
      }
    );
```

Leave the `if (!result.success)` / success-message block below it unchanged — it already
reports `result.slideCount` and `uri.fsPath`.

### 4b. `packages/vscode-ext/package.json`

Update the command title so the new format is discoverable. Find:

```json
        "command": "seldia.exportMarp",
        "title": "SelDiA: Export Marp Deck (PDF/HTML)"
```

and change the title to:

```json
        "title": "SelDiA: Export Marp Deck (PDF/PPTX/HTML)"
```

Leave the `menus` entry (`when: editorLangId == markdown`) alone.

### 4c. `packages/vscode-ext/src/markdown/codelens.ts`

Search for the CodeLens whose title mentions exporting the Marp deck. If its title
string says `PDF/HTML`, update it to `PDF/PPTX/HTML`. If it is just
`"Export Marp Deck"`, leave it as is. Change nothing else in this file.

---

## 5. Tests

Append to `packages/vscode-ext/test/marp.test.ts`. Import `readSlideSize` and
`exportMarpToPptx` from `../src/marp/pptx.js`.

Add these three tests. **Do not** write a test that launches Puppeteer — the existing
suite is Chrome-free and must stay fast.

```ts
describe('readSlideSize', () => {
  it('reads the slide size out of Marp @page CSS', () => {
    expect(readSlideSize('@page {size:1280px 720px;margin:0}'))
      .toEqual({ width: 1280, height: 720 });
  });

  it('reads a 4:3 deck size', () => {
    expect(readSlideSize('@page {size:960px 720px;margin:0}'))
      .toEqual({ width: 960, height: 720 });
  });

  it('falls back to 16:9 when no @page rule is present', () => {
    expect(readSlideSize('section { color: red }'))
      .toEqual({ width: 1280, height: 720 });
  });
});
```

Also add one failure-path test that needs no browser:

```ts
it('reports an error for markdown that cannot be rendered', async () => {
  const result = await exportMarpToPptx(
    null as any, // engine is only touched by fence rendering
    '---\nmarp: true\n---\n\n# Hi\n',
    '/nonexistent-dir-xyz/out.pptx'
  );
  expect(result.success).toBe(false);
  expect(result.errorMessage).toBeTruthy();
});
```

Run: `cd packages/vscode-ext && npm test`. All previously-passing tests must still pass.

---

## 6. Manual verification

```bash
cd packages/vscode-ext && npm run build
```

Then in the Extension Development Host:

1. Open `demo_marp.md` (repo root — it has real ` ```seldia ` fences).
2. Run **SelDiA: Export Marp Deck (PDF/PPTX/HTML)** from the command palette.
3. Save as `demo_marp.pptx`.
4. Open the result. Check, in order:
   - slide count matches the deck;
   - **the SelDiA diagram slides show rendered diagrams, not code blocks** — this is the
     entire reason for the feature, so verify it explicitly;
   - slides are 16:9 with no letterboxing or white margin;
   - speaker notes appear in the notes pane on slides that have `<!-- ... -->` comments.

If LibreOffice is available, `soffice --headless --convert-to pdf demo_marp.pptx` is a
quick way to eyeball every slide at once without PowerPoint.

---

## 7. Docs

- `README.md` and `docs/user_guide.md`: wherever Marp export is described as PDF/HTML,
  add PPTX. State plainly that **slides are exported as high-resolution images, so text
  is not editable in PowerPoint, but speaker notes are preserved** — and that this
  matches the behavior of `marp-cli --pptx`.
- `packages/vscode-ext/package.json` `description`: optional; only touch it if it
  enumerates export formats.

---

## Files touched

| File | Change |
| --- | --- |
| `packages/vscode-ext/package.json` | add `pptxgenjs` dep; command title |
| `packages/vscode-ext/src/marp/pptx.ts` | **new** — the whole feature |
| `packages/vscode-ext/src/extension.ts` | import + save-dialog/branch in `seldia.exportMarp` |
| `packages/vscode-ext/src/markdown/codelens.ts` | CodeLens title only, if it lists formats |
| `packages/vscode-ext/test/marp.test.ts` | 4 new tests |
| `README.md`, `docs/user_guide.md` | document PPTX + its image-based caveat |

No changes to `render.ts`, `export.ts`, `preview-panel.ts`, `detect.ts`, or the build and
vendor scripts.
