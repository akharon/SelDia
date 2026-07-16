# SelDiA — Next Steps

**Date:** 2026-07-16
**Purpose:** The single actionable roadmap. Supersedes the old `docs/plan.md` (24-week build plan, now complete) and `docs/improvement_request.md` / `docs/review-2026-07-14.md` (rendering-quality pass, now mostly resolved — see §3). Strategic reasoning behind the priorities lives in [market.md](market.md).

---

## 1. The strategic bet (from market.md)

> **SelDiA is not a third diagram format. It is the diagram *engine* that runs everyone's — Mermaid and PlantUML included.**

The category change, not a feature fight: a format war against Mermaid (native GitHub rendering, total LLM training coverage) is unwinnable — it's D2's four-year losing script. Instead, demote the competition to input formats. Users keep their Mermaid; SelDiA sits underneath as the engine that parses, validates, queries, and keeps diagrams true as the system drifts. That layer requires an IR, diagnostics, and round-tripping — the one set of assets SelDiA has that neither competitor's architecture can grow.

The pitch: **"Keep your Mermaid. SelDiA keeps it true."** Mermaid is a format, PlantUML is a tool, SelDiA is the engine. The SelDiA DSL remains the engine's native format for those who want its full power — not the price of admission.

Everything in Tier 1 below serves that bet directly. Tier 2/3 are real but should wait.

---

## 2. Roadmap

### Tier 1 — do these next, in order

**1. Mermaid import — foundation landed, not finished.** This is the engine positioning made executable, and it must be excellent rather than demo-grade (a leaky bridge re-opens the format war).

*Shipped:* a Mermaid→IR frontend ([`core/src/import/mermaid.ts`](../packages/core/src/import/mermaid.ts)) covering **flowchart, sequence, class, and ER** — the bulk of real-world Mermaid. It's a true frontend (source→IR directly, not a translation through SelDiA DSL text), joined to the pipeline by `engine.compileIRSync(ir)`. Reachable two ways: ` ```mermaid ` fences now render through SelDiA in the Markdown preview, and `seldia mermaid <file.mmd>` renders from the CLI. Covered by 27 importer tests + 9 preview tests.

*The safety property to preserve:* an unimportable block **falls back to the default fence**, so installing SelDiA can never make a Mermaid document render worse than not having it. Never replace that fallback with a SelDiA error box in a document whose author never asked for SelDiA.

*Shipped since:* **Subgraphs** — the Mermaid importer now parses `subgraph`/`end` (including nesting) into `IRGroup`s, and the engine gained group support end-to-end: a bounding-box layout post-pass over each group's member nodes (`engine.ts` `layoutGroups()`), inclusion in viewBox bounds, and a renderer (`renderGroup()` in `custom-renderers.ts`) that draws a background box + label behind the member nodes. This was bigger than it looked — `groups` existed on the IR type but nothing in the layout engine or renderer consumed it, for *any* diagram type, DSL included. It's now general engine capability, not Mermaid-specific.

*Still open, in rough priority order:*
- **State, gantt, pie, gitgraph, mindmap, journey** — all have IR equivalents already; each is an importer function, not new engine work.
- **Styling directives** — `style`/`classDef`/`linkStyle` are skipped; they map onto `IRNode.style`.
- **Mermaid export** — the return leg. Emit Mermaid from IR where it maps cleanly, so output still rides GitHub's native rendering. Nothing exists yet.
- **A fidelity corpus** — pull real Mermaid from public repos and diff imported-vs-expected structure. "Excellent, not demo-grade" needs evidence, and unit tests on hand-written samples aren't it. Note the two bugs found only by rendering to SVG and *looking* (class members and ER attributes silently dropped, because both renderers read structure from the newline-joined label rather than a `data` bag) — the class of bug that unit tests on IR shape cannot catch.

**2. Rendering-distribution path.** SelDiA cannot beat GitHub's native Mermaid rendering, so route around it instead of competing with it: a GitHub Action that renders `.seldia`/` ```seldia ` blocks to committed SVG on push, and promotion of the existing `<seldia-viewer>` web component as the embeddable answer. A diagram that only renders inside one editor's preview pane isn't solving the maintenance problem for a team.

**3. Agent-facing diagram interface.** An MCP server or CLI surface over the IR: query a diagram ("what depends on auth-service?"), mutate it structurally, validate it, get diagnostics, write it back. This is the actual "AI maintains it" bet — no competitor can copy it quickly because it requires the IR they don't have.

**4. Persistent manual positions.** Drag-to-edit currently loses hand-placed positions on re-render. Carried over from the prior internal review — still correct, still a precondition for edit mode being trustworthy rather than a liability.

### Tier 2 — real, but after Tier 1

- Theme/palette swapping without a fork
- Edge editing in Edit mode (currently node drag/rename only; edges require Code mode)
- Macro/include system for composing diagrams from fragments
- Export to semantic formats (BPMN XML, SQL DDL) for non-visual consumers
- Diagram diffing for PR review

### Tier 3 — resist for now

**More diagram types.** The IR already has 30 `DiagramType` variants and SelDiA is still losing to tools with half that. Breadth is not the constraint; distribution is. Adding type 31 is the most comfortable and least useful thing to do next — don't.

---

## 3. Known technical debt (carried from prior internal review)

Most items from the rendering-quality pass (per-type visual grammar, `\n`→`<tspan>` line breaks, class compartments, zoom clipping, emoji→icon toolbar) are **done** — verified against current code, not assumed. What's still open:

- **Tokenizer can't parse nested object values.** `{ layout: { x, y } }`, palette blocks, and chart `data { … }` mis-tokenize because any `{` after `:` is read as a diamond-shape token, not an object value. Current workaround is the flat form (`a: (Start) { x: 300, y: 200 }`), which is what the Edit-mode writer emits — but the documented nested syntax in places doesn't actually parse. Fix requires a context-aware tokenizer (track body vs. attribute-block context on a brace stack), or the docs need to be corrected to the flat form throughout.
- **`.sld` vs `.seldia` extension mismatch.** Some docs/examples say `.seldia`; the extension and `examples/` actually use `.sld`. Pick one, fix the docs.
- **`@seldia/render`, `@seldia/layout`, `@seldia/interaction` are unused.** `@seldia/core`'s `engine.ts` reimplements layout and SVG rendering inline and imports none of these packages — they're dead code from the shipped product's point of view. Either wire the engine through them or delete them; carrying unused packages in the monorepo is pure confusion for contributors.
- **Diagram container chrome vs. native VS Code look.** Toolbar icons were fixed (emoji → real icons), but the `.seldia-diagram` block's card-style border/toolbar-band styling still reads as a bolted-on widget next to native Markdown elements (tables, code fences). Reducing that visual weight to match native chrome is still open — this was previously flagged as spec-only, not yet implemented.
- **Blank-preview-on-drag risk.** A prior review found a plausible failure path where dragging a node in Edit mode could blank the entire Markdown preview (full-document re-render triggered by `doc.save()`, racing with in-flight state keyed on a content-hashed block id). Not confirmed fixed — needs a repro test with a multi-block `.md` file before Tier 1 item 4 (persistent positions) is built on top of it.

---

## 4. Positioning (from market.md)

> "Keep your Mermaid. SelDiA keeps it true."
> The diagram engine agents use to render, validate, and maintain any diagram-as-code format in your repo.

Target: teams whose architecture docs/ADRs/runbooks drift out of date faster than anyone hand-fixes them. That's a problem Mermaid can't solve (no IR, no diagnostics, no sync) and PlantUML won't (no markdown-native path, no agent story). The wedge is drift, not drawing; the category is *engine*, not *format* — see [market.md §5](market.md#5-positioning--the-category-change) for the full reasoning and the risk that comes with it.
