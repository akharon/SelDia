# SelDiA — Next Steps

**Date:** 2026-07-16
**Purpose:** The single actionable roadmap. Supersedes the old `docs/plan.md` (24-week build plan, now complete) and `docs/improvement_request.md` / `docs/review-2026-07-14.md` (rendering-quality pass, now mostly resolved — see §3). Strategic reasoning behind the priorities lives in [market.md](market.md).

---

## 1. The strategic bet (from market.md)

> **Mermaid is the format AI writes. SelDiA should be the format AI maintains.**

Generation is commodity — every frontier LLM already knows Mermaid syntax, none know SelDiA's. Competing there is unwinnable head-on (see D2's four years of losing to Mermaid on pure capability). The unclaimed ground is **maintenance**: keeping a diagram true as the system it describes drifts, which requires an IR, diagnostics, and round-tripping — the one set of assets SelDiA has that Mermaid structurally doesn't.

Everything in Tier 1 below serves that bet directly. Tier 2/3 are real but should wait.

---

## 2. Roadmap

### Tier 1 — do these next, in order

**1. Mermaid import.** Highest leverage item in the project. Parse Mermaid syntax into SelDiA's IR (`packages/core/src/ir/types.ts`) and render it through SelDiA's engine. This neutralizes the training-data gap (any LLM writes Mermaid → SelDiA ingests and renders it better) and removes the adoption cliff (no rewrite required to try SelDiA). Export back to Mermaid where the IR maps cleanly, so output can still ride GitHub's native rendering.

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

> "Diagrams your agents can maintain. Generate with any AI, keep them true in your repo."

Target: teams whose architecture docs/ADRs/runbooks drift out of date faster than anyone hand-fixes them. That's a problem Mermaid can't solve (no IR, no diagnostics, no sync) and PlantUML won't (no markdown-native path, no agent story). The wedge is drift, not drawing — see [market.md §5](market.md#5-positioning) for the full reasoning and the risk that comes with it.
