# Implementation Plan — Auto Table of Contents, Numbered Captions & Stable IDs

**Status:** plan only, nothing implemented.
**Scope:** VS Code built-in Markdown preview (primary), plus numbering parity in
the Marp preview and the MD→PDF pipeline.

> **Revision note.** An earlier draft of this plan covered diagrams, tables and
> images with equal weight. After verifying the code, three items were **cut**
> and one was **narrowed** — see [What was cut, and why](#what-was-cut-and-why)
> at the end. The cuts are the point of this revision, not an afterthought; read
> that section first if you are deciding scope.

## Goal

1. **Stable, citable IDs** on every diagram in a Markdown document — SelDiA,
   Mermaid and PlantUML alike.
2. **Auto-numbered captions** — `Diagram 1`, `Diagram 2` — using the diagram's
   own declared `title` when the DSL has one.
3. **An automatic Table of Contents** at the top of the preview: headings plus a
   "Diagrams" list, each entry linking to the ID from step 1.

Tables and images are **deliberately out of scope**. They were in the first
draft; the verification below is why they are not here.

---

## What already exists (reuse, don't rebuild)

| Thing | Where | Notes |
|---|---|---|
| Per-block stable id (`seldia-<hash>`) | [blocks.ts:38](packages/vscode-ext/src/edit/blocks.ts#L38) `blockIdForSource` | Stamped as `id=` **and** `data-seldia-block=` on every container. Content-derived, so it changes when the block's own source changes. |
| Fence interception for all three formats | [plugin.ts:60](packages/vscode-ext/src/markdown-preview/plugin.ts#L60) | One place where seldia/mermaid/plantuml render. |
| Per-document render `env` | [plugin.ts:71-80](packages/vscode-ext/src/markdown-preview/plugin.ts#L71-L80) | Already the once-per-document flag for `ICON_SPRITE`. This is the counter carrier. |
| Diagram `title` in the IR | [types.ts:61](packages/core/src/ir/types.ts#L61), parsed at [parser.ts:656](packages/core/src/parser/parser.ts#L656) | `diagram flowchart "Payment flow" { … }` already parses. **This is the "diagram name" the request asks for.** |
| A title-extraction regex + `Fig. N:` caption | [diagram-injector.ts:50-51,71](packages/vscode-ext/src/md2pdf/diagram-injector.ts#L50-L71) | **The PDF path already does exactly this feature**, via regex on the DSL source. Precedent and a warning both — see Phase 2a. |
| A TOC generator | [toc-generator.ts](packages/vscode-ext/src/md2pdf/toc-generator.ts) | PDF-only, regex-over-HTML, `seldia-diagram-<index>` anchors. |
| Preview script + style contribution points | [package.json:115-120](packages/vscode-ext/package.json#L115-L120) | New CSS/behavior land in `media/seldia-preview.css` and `markdown-preview/index.ts`. |

---

## The architectural constraint

`extendMarkdownIt` gives us **markdown-it renderer rules**. They fire per token,
in document order, and **cannot see the whole document** or run a pass first.

- **Numbering is a counter on `env`,** incremented as tokens render. `env` is
  per-document-render and already used this way for the icon sprite — a proven
  channel, not a new mechanism. Document order comes for free.
- **The TOC cannot be emitted by a renderer rule** — when the first token
  renders, nothing downstream has been counted. It is injected by the **preview
  script** after the DOM exists. That is also the only approach that survives the
  preview's full-DOM re-render on every keystroke.

Secondary: `blockIdForSource` hashes the block *source*, so editing a diagram
changes its id. The plan adds a **positional** id (`#diagram-3`) as the citable
anchor and keeps the hash id for the existing edit deep links.

---

## Phase 1 — Numbering module

**New file:** `packages/vscode-ext/src/markdown-preview/numbering.ts` — pure, no
`vscode` import, unit-testable, matching the convention of `edit/blocks.ts`.

```ts
export interface NumberedDiagram {
  /** 1-based ordinal in document order. */
  n: number;
  /** Citable anchor, e.g. "diagram-3". */
  anchor: string;
  /** Declared name, when the DSL/import provides one. */
  title?: string;
  /** Content-hash id — kept for the existing edit deep links. */
  blockId: string;
  /** True for a block that failed to compile. */
  hasError?: boolean;
}
```

Exports:

- `nextDiagramNumber(env): number` — reads/increments `env.__seldiaDiagramCount`,
  wrapped in try/catch exactly like the sprite flag, falling back to a
  module-local counter if `env` is unusable.
- `anchorForDiagram(n)` → `` `diagram-${n}` ``.
- `captionFor(n, title?)` → `"Diagram 3"` or `"Diagram 3 — Payment flow"`.
- `registerDiagram(env, item)` — appends to `env.__seldiaDiagrams`, the list the
  **Marp/PDF** TOC builders read. The built-in preview ignores it and reads the
  DOM (Phase 4a).

**One counter for all three formats.** To a reader, a Mermaid block and a SelDiA
block are both just diagrams; do not give Mermaid its own sequence.

**Tests:** `packages/vscode-ext/test/numbering.test.ts` — counter isolation
between two `env` objects, caption formatting with and without a title, the
`env`-throws fallback path.

---

## Phase 2 — IDs and captions for diagrams

**File:** `packages/vscode-ext/src/markdown-preview/plugin.ts`

### 2a. Getting the diagram's declared name

**Verified:** `compileSync` returns `Result<RenderResult>`, and `RenderResult`
carries `svg` and `stats` — **it does not expose the IR or the title.** So the
name has to come from somewhere. Three options, and the choice matters:

| Option | Cost | Verdict |
|---|---|---|
| Add `title?: string` to `RenderResult` in `packages/core/` | Touches core; additive; correct | **Do this** |
| Regex the DSL source: `/^\s*diagram\s+\S+\s+"([^"]+)"/` | Zero core change | **Do this first** |
| Re-parse the source a second time just for the title | Doubles parse cost per block, per keystroke | No |

Take the **regex** for the first increment and the **core field** as a
follow-up. Rationale: [diagram-injector.ts:50-51](packages/vscode-ext/src/md2pdf/diagram-injector.ts#L50-L51)
**already ships that exact regex** on the PDF path. Reusing it keeps the two
paths consistent and unblocks Phase 2 without a cross-package change; promoting
it to a real `RenderResult.title` later fixes both call sites at once. Put the
regex in `numbering.ts` as `titleFromDsl(source)` so there is one copy, not two.

For **Mermaid/PlantUML**, `renderImportedBlock` already holds the `ir` — use
`ir.title` directly. No regex, no core change.

Fallback chain, first hit wins: `ir.title` (imports) → `titleFromDsl(source)` →
no name, caption is a bare `Diagram 3`.

**Cut:** a caption on the fence info string (```` ```seldia "Payment flow" ````).
See the cut list.

### 2b. Emit the anchor and caption

After computing `blockId` in `renderSelDiABlock` and `renderImportedBlock`:

```
const n = nextDiagramNumber(env);
const anchor = anchorForDiagram(n);   // "diagram-3"
```

**Verified — the `id` swap is safe.** A grep of `edit/` and
`markdown-preview/index.ts` found **no reader of the container's DOM `id`**: the
preview script reads `container.dataset.seldiaBlock || container.id` (dataset
wins, and it is always present), and the `revealSource` handler at
[commands.ts:65](packages/vscode-ext/src/edit/commands.ts#L65) resolves blocks
from the deep-link **query string**, never from the DOM. The only
`getElementById` calls in the extension are in `marp/preview-panel.ts` and
target its own chrome (`#slides`, `#notes`), not diagram containers.

So: make the **positional anchor** the element `id`, keep the hash on
`data-seldia-block`. **The alias span from the first draft is unnecessary** —
dropped.

```html
<div class="seldia-diagram" id="diagram-3"
     data-seldia-block="seldia-1x9k2"
     data-seldia-number="3"
     data-seldia-title="Payment flow" …>
```

Caption element, **after** the SVG box and inside the container:

```html
<div class="seldia-caption">
  <span class="seldia-caption-label">Diagram 3</span>
  <span class="seldia-caption-title">Payment flow</span>
</div>
```

It sits outside `.seldia-diagram-svg`, so `exportSvg` (which clones only the
`svg` node) is unaffected, as are zoom and pan.

### 2c. Mode switch

The caption stays visible in **both** preview and code mode — it identifies the
block, not the rendering. One CSS rule; easy to miss.

### 2d. Error blocks

- `renderFatalErrorBlock` — **no number.** It has no block id by design, and a
  block that did not render is not a figure.
- `renderSelDiABlock`'s compile-error box — **number it**, and mark
  `data-seldia-error="1"`. Ordinals then stay stable while the author is
  mid-edit, and the TOC can show the warning icon `toc-generator.ts` already has.

**Tests:** two seldia blocks in one `env` → `diagram-1`, `diagram-2`; a mermaid
block between them takes `diagram-2` (shared counter); a fatal error block does
not increment; `ir.title` beats `titleFromDsl`.

---

## Phase 3 — The Table of Contents

### 3a. Built-in preview — inject from the preview script

**File:** `packages/vscode-ext/src/markdown-preview/index.ts`

A `buildToc()` that runs on load and on the existing
`vscode.markdown.updateContent` event — **reuse that hook** (the script already
listens on it for zoom re-application); do not add a MutationObserver.

It walks the rendered DOM:

- `document.querySelectorAll('h1, h2, h3, h4, h5, h6')` for headings.
  **Verify VS Code's preview assigns heading ids** before relying on it — if any
  heading lacks one, synthesize a slug and set it, since a TOC entry without a
  target is worse than no entry. This is a five-minute check in a running
  preview and should happen before the phase starts, not during.
- `document.querySelectorAll('.seldia-diagram[data-seldia-number]')` for the
  diagram list.

Then inject `<nav class="seldia-toc">` as the first child of `<body>`, **removing
any previously injected one first** — the preview rebuilds the DOM constantly,
so injection must be idempotent.

**Behavior:**

- A `<details>`, open by default. **Cut:** `sessionStorage` persistence of its
  open/closed state — see the cut list.
- Suppressed when the document has fewer than 3 headings **and** fewer than 2
  diagrams. A short note should not grow a TOC.
- Sections: Contents (headings) → Diagrams. Empty sections omitted.
- Native `href="#diagram-3"` anchors; no JS scroll handling.

### 3b. Marp and PDF — numbering parity only

Neither host gets a new TOC in this plan; both get **correct numbering**.

- **Marp** — [render.ts:47-55](packages/vscode-ext/src/marp/render.ts#L47-L55)
  calls `renderSelDiABlock(engine, token.content)` with **no `env` argument**.
  Thread `env` through all three calls, or every slide's diagram is "Diagram 1".
  Cheap, and it fails silently if forgotten.
- **PDF** — the pipeline uses **`marked`, not markdown-it**
  ([markdown-parser.ts](packages/vscode-ext/src/md2pdf/markdown-parser.ts)), so
  it shares **no** renderer-rule code with the preview. It already emits its own
  `Fig. N:` caption from its own regex. The only work here is **alignment, not
  rewriting**: switch its caption wording and anchors to match the preview
  (`Diagram N`, `id="diagram-N"`, 1-based) so a document reads the same in both.
  **Note the off-by-one:** `DetectedBlock.index` is 0-based.
  **Cut:** rewriting `toc-generator.ts` onto the shared registry.

### 3c. Shared TOC markup

`renderTocHtml(headings, diagrams): string`, pure, in `numbering.ts`. Only the
preview script consumes it in this plan. **Verified buildable:**
`scripts/build.mjs` bundles `markdown-preview/index.ts` with esbuild
(`platform: browser`, `bundle: true`), so a cross-directory import resolves —
the same way the script already imports `blockIdForSource`.

---

## Phase 4 — Styles

**File:** `packages/vscode-ext/media/seldia-preview.css` (append two commented
sections; the file is 332 lines and organized by concern).

- `.seldia-toc` — bordered card on `var(--vscode-editorWidget-background)`, plain
  block at the top. **Not** `position: sticky` — it would eat vertical space on
  every scroll. Nested `ul` indent per heading level.
- `.seldia-caption` — smaller than body text,
  `var(--vscode-descriptionForeground)`, centered under the figure.
  `.seldia-caption-label` at `font-weight: 600`; put the em-dash separator in a
  `::after` on the label so it vanishes cleanly when there is no title.
- `@media print` — `break-inside: avoid` to keep a caption with its figure.
- **VS Code CSS variables only, never literal colors** — this must read correctly
  in light and dark. The PDF path is standalone HTML; its equivalents go in
  `md2pdf/print-css.ts`.

---

## Phase 5 — Settings

Add to `contributes.configuration.properties`
([package.json:390](packages/vscode-ext/package.json#L390)):

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `seldia.markdown.toc.enabled` | boolean | `true` | Inject the auto-TOC. |
| `seldia.markdown.captions.enabled` | boolean | `true` | Render numbered captions. |

Two settings, not six. **Cut:** `minEntries`, `includeFigureLists`,
`captions.kinds`, `captions.labels` — see the cut list.

**Reading config from a hot renderer rule is the trap.** The plugin is built once
at activation ([extension.ts:596](packages/vscode-ext/src/extension.ts#L596)).
Read config **once in the plugin factory**, pass it as a second argument to
`createSelDiAMarkdownItPlugin`, and register an `onDidChangeConfiguration`
listener that fires `markdown.preview.refresh`. Never call
`workspace.getConfiguration()` per token.

---

## Phase 6 — Documentation

- `docs/` — a short "Diagram numbering and cross-references" page: naming a
  diagram (`diagram flowchart "Name"`), linking to one
  (`[see Diagram 3](#diagram-3)`), and the renumbering caveat below.
- The `seldia-dsl` skill (canonical copy in `packages/vscode-ext/resources/`) —
  note that a diagram's title becomes its caption. Per the convention there, any
  added example must be compile-tested.
- `README.md` — one bullet under Markdown integration.

---

## What was cut, and why

Each of these was in the first draft. Each is cut because verifying the code
showed the cost was real and the payoff was not.

### Cut 1 — Numbered tables (`Table 1`, `Table 2`)

**Why cut.** GFM has no table-caption syntax, so a name has to be *inferred*.
The draft proposed scanning backwards through the token stream for a
`Table: …` paragraph and then suppressing that paragraph from the output. That
is an invented, undocumented convention that no other Markdown renderer honors —
so a document authored for SelDiA renders with a stray "Table: Foo" line
everywhere else, and the suppression rule silently eats a paragraph an author
might have meant literally. Wrapping every table in a div also changes the DOM
shape for a common element in **every** Markdown file the user opens, which is a
large blast radius for a feature nobody asked to have applied universally.

**Revisit when** there is a concrete request for it, ideally alongside a
caption syntax that already exists in the wild.

### Cut 2 — Numbered figures/images (`Figure 1`, `Figure 2`)

**Why cut.** The whole feature rests on `isBlockLevelImage()` — telling a
standalone figure from an inline badge. Get it wrong and every CI shield and
emoji-sized icon at the top of a README acquires a "Figure 4" caption. The
draft already flagged this as the most likely source of "why does my README look
like that" reports; on reflection, a heuristic that is *usually* right is not a
good foundation for something that rewrites every image in every open Markdown
file. There is no way to be sure without a whole-document pass, which the
renderer-rule API does not give us.

**Revisit when** a `core.ruler` pre-pass is being added for another reason, since
that is where the classification could be done reliably.

**Consequence of Cuts 1 & 2:** the entire `figure-rules.ts` module disappears,
`CaptionKind` collapses to just diagrams, and the three-list TOC becomes one
list. This is most of the plan's complexity, removed.

### Cut 3 — Rewriting the PDF TOC onto the shared registry

**Why cut.** The PDF pipeline uses **`marked`**, not markdown-it. It shares no
renderer-rule machinery with the preview, so "reuse the registry" was never as
cheap as it sounded — it means rewriting `toc-generator.ts` **and**
`diagram-injector.ts`, and the anchor rename breaks the PDF TOC's links if only
one lands (nothing currently tests this). Meanwhile the PDF path **already
produces numbered captions** (`Fig. N:` at
[diagram-injector.ts:71](packages/vscode-ext/src/md2pdf/diagram-injector.ts#L71))
and a working TOC. Rewriting shipped, working code to share an abstraction with
a different renderer is the expensive half of this plan for the smallest gain.

**Kept instead:** align the PDF's caption wording and anchor format with the
preview's. Same reading experience, a fraction of the risk.

### Cut 4 — Fence-info captions (```` ```seldia "My title" ````)

**Why cut.** A second way to name a diagram, when `diagram flowchart "Name"`
already exists and is the documented one. Two mechanisms means a precedence rule
to specify, document and test, for no capability the first one lacks. The only
real gap is naming a Mermaid block that has no title of its own — a narrow case
that does not justify a parallel syntax.

### Cut 5 — TOC collapse-state persistence in `sessionStorage`

**Why cut.** Keying per-document state in a webview that VS Code tears down and
rebuilds constantly is fiddly, and the payoff is remembering one boolean. Ship
the `<details>` open by default; add persistence only if someone complains.

### Cut 6 — Four of the six settings

`minEntries`, `includeFigureLists`, `captions.kinds` and `captions.labels` are
cut. Two of them (`includeFigureLists`, `captions.kinds`) existed only to
configure the tables and images that Cuts 1–2 removed. The other two are
configuration written before a single user has seen the default — the threshold
becomes a constant, and the caption words stay `Diagram N` until someone asks to
change them. Settings are permanent API; adding one later is easy, removing one
is not.

### Narrowed — the DOM `id` swap

Not cut, but **de-risked by verification**. The draft called this the top risk
and proposed a zero-height alias span to protect any existing `#seldia-<hash>`
links. A grep found no reader of the container's DOM `id` anywhere in `edit/` or
the preview script — the script prefers `dataset.seldiaBlock`, and `revealSource`
resolves from the deep-link query string. **The alias span is dropped** and this
comes off the risk list.

---

## Sequencing and remaining risk

Each step leaves the extension shippable:

1. **Phase 1** — numbering module + tests. No user-visible change.
2. **Phase 2** — diagram ids + captions. The highest-value slice standalone, and
   it exercises the `env` counter before anything depends on it.
3. **Phase 3a** — the preview TOC.
4. **Phase 3b** — Marp `env` threading and PDF caption alignment.
5. **Phases 4–6** land alongside 2–3, not after.

**Risks that remain:**

- **Renumbering churn.** Ordinals are positional, so inserting a diagram at the
  top renumbers everything below — correct behavior, but `#diagram-3` links in
  prose can silently retarget. **Document it; do not try to solve it.** The right
  eventual fix is an explicit `id:` in the DSL header, deliberately out of scope.
- **Heading ids in the preview.** Phase 3a assumes VS Code assigns them.
  Unverified — check it before starting that phase, and be ready to synthesize.
- **Marp's missing `env`** — one-line fix, fails quietly if forgotten, and no
  test would currently catch every diagram being numbered 1.
- **Caption regression in the SVG export.** The caption lives inside
  `.seldia-diagram`; `exportSvg` clones only the `svg` node, so it should be
  excluded. Confirm with an actual export once the caption exists.
