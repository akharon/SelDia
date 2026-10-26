# Plan: Legible by construction (layout round 2)

Decided on 2026-10-26, after the time-boxed research, a visual audit and an architect review. It builds on [plan-layout-circuits.md](plan-layout-circuits.md).

## Problem
Round 1 fixed the geometry (ELK, clipping), but the output still reads as "good, not great":
- labels float away from their edges or cover arrowheads;
- unavoidable parallel runs and crossings give no visual cue;
- nodes paint over edge labels (edges are drawn before nodes, and labels live inside the edge group);
- the corpus SVGs contain 27 distinct stroke widths and 11 font sizes, despite the DS tokens;
- label chip size is computed twice, in engine.ts and in edge-label-placement.ts, and the two drift apart.

Output is already byte-identical across runs. Declaration-order sensitivity is intended: it is the user's way to steer the layout.

## Principles
1. **Every edge stays traceable**, even where overlap is unavoidable. Edges are clean (not sketchy) and get a background-colour casing, rounded bends, line jumps at crossings, separated parallel runs, and hover highlighting.
2. **A label is always on its own edge**, on a background chip. It never covers an arrowhead, a node or a group title. If it has to move away, a leader line ties it back.
3. **Tokens are law.** Every stroke width, font size, radius and arrow size comes from `DS`, and a lint test enforces this over the corpus.
4. **Measured.** The metrics gain new readability measures before the features land, and the baseline gate stays on.

## Z-order (new)
groups → edge casings → edges → nodes → arrowheads → label chips and labels.

## Token contract (landed in render/design-system.ts)
- `DS.stroke`: `{hairline 1, divider 1, edge 1.5, node 1.75, emphasis 2.5, casing 3}`
- `DS.arrowScale`: 4.5 (arrow length = 4.5 × edge stroke)
- `DS.chip`: `{padX 6, padY 3, rx 3}`
- `DS.bendRadius`: 6
- `DS.portStub`: 12
- Font sizes: `DS.fontSize` (`title 15`, `label 14`, `meta 12`, `small 11`). Edge labels use **meta (12)**.

## Features and tasks (priority order, S/M/L cost)

| # | Task | Owner | Cost |
|---|---|---|---|
| L1 | Metrics: labelDetached (> 16px from own edge), labelOnArrowhead (last 14px), parallelRunLength, labelEdgeHits (chip vs. other edges and group title bands), tokenViolations (from the SVG). Add them to the gate. | Tester | S |
| L2 | One text measure: `chipRect`/`chipSize` built on `layout/text-measure.ts` `measureLabel` plus `DS.chip`, exported and used by engine, placement and metrics | A | S |
| L3 | Layer split: renderEdge → path / arrowhead / label emitted in separate layers in the z-order above | B | M |
| L4 | Clean edges by default (`edgeStyle: clean|sketch`), casing in `DS.surface`, rounded orthogonal bends (`DS.bendRadius`) | B | S |
| L5 | Labels v2: longest-segment first; hard rejects for node, glyph, arrowhead zone (14px) or source zone (8px), other chip, other edge, and group title band; consistent side (above horizontals, right of verticals); dashed hairline leader beyond 16px; dominant-baseline central | A | M |
| L6 | Node text boxes per shape (cylinder body, diamond inscribed rect, hexagon, network label always below icon), with balanced line wrapping | A | M |
| L7 | Tokens: replace literal stroke, radius and font values in engine (B) and in custom-renderers/floorplan (A); rough.ts defaults to DS.roughness, with `bowing 0` and `disableMultiStroke` on lines | A + B | M |
| L8 | Arrowheads: size from tokens, hollow fill = surface (not white), usecase association has no head, port stubs before the first bend | B | S |
| L9 | Nudge pass: collinear overlaps over 8px are separated ±6px with ports fixed, then edge-node hits are rechecked; ELK spacing.edgeEdge raised to 14 | B | M |
| L10 | Line jumps: a 5px hop on the later edge's horizontal segment at a crossing; only for clean edges | B | M |
| L11 | Hover CSS: `data-src`/`data-tgt` on edges; hovering an edge or node thickens it and dims the rest (pure CSS `<style>`) | B | S |
| L12 | Seeds: edge seed = seedFor(type + ':' + edge.id); pin ELK `randomSeed` | B | S |
| L13 | `seldia check <file.sld|file.md>`: per-fence readability report, non-zero exit above a threshold, `--json` output; plus `seldia render --png` (resvg-js) | Tester → A | S–M |
| L14 | Canvas trim to the content bbox plus padding (also fixes left/top label clipping) | B | S |
| — | ELK post-compaction | deferred | L |
| — | Width quantisation | rejected (breaks custom layouts) | |

The nudge and jump passes run between routing and label placement (engine.ts ~:753 → :755). metrics.ts must call the same passes, so it measures what is drawn.

## File ownership (parallel without conflicts)
- **A:** render/edge-label-placement.ts, render/design-system.ts, render/node-label-geometry.ts, render/custom-renderers.ts, render/floorplan-render.ts, layout/text-measure.ts
- **B:** engine.ts, render/edge-routing.ts, render/rough.ts, render/edge-layer.ts (new), layout/engines.ts
- **Tester:** layout/metrics.ts, scripts/layout-metrics*.mjs, tests, packages/cli (`check`)
