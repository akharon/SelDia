# SelDiA — Code Review Findings & Implementation Instructions

Review date: 2026-08-27 · Branch: `pivot` · Baseline: all 10 packages green (`npm test` → 343 core + 35 CLI tests passing).

These are ordered by impact. Each item is self-contained: it states the problem, the
evidence, the exact fix, and how to verify. **Do not change behaviour beyond what each
item describes.** Re-run `npm test` after every item; every item must leave the suite green.

---

## P1 — Every edge is routed twice (A* pathfinding run 2× per edge)

**File:** `packages/core/src/engine.ts`, `renderToSvg`, lines ~617–631

### Problem

The code already has a comment explaining that routing must happen **once** and be reused:

```
// Label placement must see the SAME polylines that get drawn.
// renderEdge re-routes each edge (clip-to-border, fanning, obstacle
// detours), so placing labels against the raw layout waypoints strands
// them far from the visible line. Route once here and reuse.
```

It then builds `routedWps` / `routedEdges` correctly — and **throws the result away**:

```ts
const routedEdges = edges.map((e) => routedWps.has(e.id) ? { ...e, waypoints: routedWps.get(e.id) } : e);
const labelPos = computeEdgeLabelPositions(routedEdges, nodeById, pad);
for (const e of edges) svg += `...${this.renderEdge(e, pad, ...)}...`;
//            ^^^^^ raw `edges`, not `routedEdges`
```

`renderEdge` receives the **raw** edge, reads `edge.waypoints` (unrouted), and calls
`this.routedWaypoints(...)` again — re-running the full grid-based Manhattan A* search
(`routeBetween` → `manhattanRoute`) for every orthogonal edge. Flowchart edges default to
`routing: 'orthogonal'` (`packages/core/src/diagrams/flowchart.ts:48`), so this is the
common path, not an edge case.

Beyond the 2× cost, this is a latent **correctness** risk: the comment's stated invariant
("label placement must see the SAME polylines that get drawn") holds today only because
`routeBetween` happens to be deterministic. Any future non-determinism or state in the
router silently desynchronises labels from lines.

### Fix

Iterate `routedEdges` instead of `edges`, and make `renderEdge` use the waypoints it is
given rather than re-routing.

1. Change the render loop to iterate the routed edges:

```ts
for (const e of routedEdges) svg += `  <g class="seldia-edge" data-seldia-edge-id="${this.esc(e.id)}">\n${this.renderEdge(e, pad, sketchy, typeAccent, diagramType, nodeById, fans.get(e.id), labelPos.get(e.id), true)}  </g>\n`;
```

2. Add a trailing `preRouted = false` parameter to `renderEdge`:

```ts
private renderEdge(edge: IREdge, pad: number, sketchy: boolean, typeAccent: Swatch, diagramType?: DiagramType, byId?: Map<string, IRNode>, fan?: Fan, labelPos?: LabelPlacement, preRouted = false): string {
```

3. In the generic (non-special-cased) tail of `renderEdge`, skip re-routing when
   `preRouted` is true:

```ts
const rawWps = edge.waypoints || [];
if (rawWps.length < 2) return '';
let wps: Point[];
if (preRouted) {
  wps = rawWps;
} else {
  const allNodes = byId ? [...byId.values()] : undefined;
  wps = this.routedWaypoints(edge, rawWps, byId?.get(edge.sourceId), byId?.get(edge.targetId), fan, allNodes);
}
```

4. The `DiagramType.ER` branch near the top of `renderEdge` does its own routing for
   `renderErRelationship`. Apply the same guard there:

```ts
if (diagramType === DiagramType.ER) {
  const raw = edge.waypoints || [];
  const src = byId?.get(edge.sourceId), tgt = byId?.get(edge.targetId);
  const routed = preRouted
    ? raw
    : (raw.length >= 2
        ? this.routedWaypoints(edge, raw, src, tgt, fan, byId ? [...byId.values()] : undefined)
        : raw);
  return renderErRelationship(edge, pad, sketchy, typeAccent.stroke, routed);
}
```

**Leave the other early-return branches alone** (SEQUENCE / GANTT / MINDMAP / GITGRAPH) —
they do not call `routedWaypoints`, so `preRouted` is irrelevant to them.

**Important:** keep `renderEdge`'s existing non-`preRouted` code path working. It is still
reachable from the `preRouted = false` default, and removing it would be a wider change
than this item authorises.

### Verify

- `npm test` stays green — in particular `packages/core/test/edge-routing.test.ts`.
- Add a regression test in `packages/core/test/edge-routing.test.ts` asserting that for a
  flowchart with obstacle nodes, the polyline in the emitted `<path>`/`<polyline>` for an
  edge matches the waypoints that `computeEdgeLabelPositions` was given. The simplest
  observable form: compile a diagram twice and assert the SVG is byte-identical (proves
  determinism), and assert the rendered edge geometry is not the raw dagre waypoints.
- Sanity-check timing: compiling a 60-node / ~118-edge flowchart currently takes ~250 ms
  (measured). Expect a meaningful drop. This is a smoke check, not a hard assertion — do
  **not** add a timing-based test.

---

## P2 — `gridLines()` mixes X and Y coordinates into both axis grids

**File:** `packages/core/src/render/edge-routing.ts`, lines ~322–338

### Problem

The doc comment states the function builds coordinates **"for one axis"**:

```
/** Build the sorted set of "interesting" coordinates for one axis: all obstacle
 *  edges (inflated by `gap`), plus source and target anchor coordinates. */
function gridLines(obstacles: IRNode[], gap: number, extra: number[]): number[] {
  const s = new Set<number>();
  for (const o of obstacles) {
    const r = nodeRect(o, gap);
    s.add(r.x);
    s.add(r.x + r.width);
    s.add(r.y);              // ← Y coordinate added to the X grid
    s.add(r.y + r.height);   // ← Y coordinate added to the X grid
  }
  for (const v of extra) s.add(v);
  return [...s].sort((p, q) => p - q);
}
```

It is called once per axis:

```ts
const xs = gridLines(obstacles, gap, [src.x, tgt.x]);
const ys = gridLines(obstacles, gap, [src.y, tgt.y]);
```

Both calls receive the same `obstacles`, so **both grids contain every node's x *and* y
boundaries**. Each axis grid is roughly 2× larger than it should be, which makes the A*
search space roughly **4×** larger (the grid is the cross product `xs × ys`). Every one of
those extra vertices is explored with `hClear`/`vClear` obstacle scans.

This is pure waste: a Y-boundary value is not a meaningful gridline for the X axis. It does
not change the *set of reachable* routes in a way that improves them — it just adds
candidate gridlines at arbitrary coordinates, inflating the search.

### Fix

Give the function an axis parameter and add only that axis's boundaries.

```ts
/** Build the sorted set of "interesting" coordinates for one axis: the obstacle
 *  edges on that axis (inflated by `gap`), plus the source and target anchor
 *  coordinates. Only the requested axis's boundaries are included — mixing in
 *  the other axis's coordinates inflates the A* search space without adding
 *  any route the correct grid cannot express. */
function gridLines(
  obstacles: IRNode[],
  gap: number,
  extra: number[],
  axis: 'x' | 'y'
): number[] {
  const s = new Set<number>();
  for (const o of obstacles) {
    const r = nodeRect(o, gap);
    if (axis === 'x') {
      s.add(r.x);
      s.add(r.x + r.width);
    } else {
      s.add(r.y);
      s.add(r.y + r.height);
    }
  }
  for (const v of extra) s.add(v);
  return [...s].sort((p, q) => p - q);
}
```

Update the two call sites in `manhattanRoute`:

```ts
const xs = gridLines(obstacles, gap, [src.x, tgt.x], 'x');
const ys = gridLines(obstacles, gap, [src.y, tgt.y], 'y');
```

### Verify

- `npm test` must stay green. `packages/core/test/edge-routing.test.ts` is the relevant
  suite — it asserts routing properties (orthogonality, obstacle avoidance, endpoint
  clipping) rather than exact pixel paths, so a correct narrowing of the grid should pass.
- **If any test fails**, do not paper over it by reverting to the mixed grid. Report which
  assertion broke and the before/after waypoints — a genuine behaviour change here needs a
  human decision, because some routes may shift slightly (they remain valid orthogonal
  obstacle-avoiding routes, just chosen from a smaller candidate set).

---

## P3 — A* open set is re-sorted on every pop instead of using a heap

**File:** `packages/core/src/render/edge-routing.ts`, `manhattanRoute`, lines ~432–435

### Problem

```ts
while (open.length > 0) {
  // Pick lowest f-score.
  open.sort((p, q) => p.f - q.f);
  const cur = open.shift()!;
```

Two compounding costs per iteration: a full `O(V log V)` sort, then `Array.shift()`, which
is `O(V)` because it reindexes the whole array. Total is `O(V² log V)` where a binary heap
gives `O(V log V)`.

Combined with P2 (which inflates `V` ~4×), this is the dominant cost of routing a dense
diagram.

### Fix

Replace the sorted array with a minimal binary min-heap keyed on `f`. Add this helper
alongside `manhattanRoute` (module-private, no new dependency):

```ts
/** Minimal binary min-heap over A* nodes, keyed on `f`. Replaces the previous
 *  sort-then-shift open set, which was O(V² log V) overall. */
class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly key: (t: T) => number) {}
  get size(): number { return this.items.length; }
  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key(a[p]) <= this.key(a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.key(a[l]) < this.key(a[m])) m = l;
        if (r < a.length && this.key(a[r]) < this.key(a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
```

Then in `manhattanRoute`, replace the open-set declaration and the pop:

```ts
// was: const open: AStarNode[] = [{ v: srcV, g: 0, f: manhattan(src, tgt), parent: null }];
const open = new MinHeap<AStarNode>((n) => n.f);
open.push({ v: srcV, g: 0, f: manhattan(src, tgt), parent: null });
```

```ts
// was: while (open.length > 0) { open.sort(...); const cur = open.shift()!;
while (open.size > 0) {
  const cur = open.pop()!;
```

Every other `open.push(...)` in the loop body works unchanged (the existing code already
uses `open.push`). **Verify that assumption before editing** — if the body uses
`open.push(...)` the swap is mechanical; if it assigns into the array by index, convert
those to `push` as well.

Do **not** change the `closed` set logic, the direction vectors, the `bendBias` handling,
or the path reconstruction. This item is a data-structure swap only; A* with an unchanged
admissible heuristic explores the same nodes and returns an equal-cost path.

### Verify

- `npm test` green, `edge-routing.test.ts` in particular.
- Because ties in `f` may now break differently than a stable sort did, an equal-cost but
  *different* path is possible. If a test asserting an exact path breaks, report it rather
  than adjusting the test — that is a signal worth a human look.

---

## P4 — `[...byId.values()]` re-materialised inside the per-edge loop

**File:** `packages/core/src/engine.ts`, `renderEdge` (generic tail) and the `ER` branch

### Problem

```ts
const allNodes = byId ? [...byId.values()] : undefined;
```

appears inside `renderEdge`, which runs once per edge. For a diagram with `N` nodes and `E`
edges this allocates `E` arrays of `N` elements — `O(N·E)` allocation churn on top of the
routing work, purely to hand the same node list to the router each time.

Note that `renderToSvg` **already** computes exactly this list once as `allNodes` before the
loop; the duplicate is inside the callee.

### Fix

After P1 is applied, the generic tail and the ER branch only build `allNodes` on the
`preRouted === false` path, so the hot path no longer allocates at all. That resolves most
of it.

For the remaining non-`preRouted` path, hoist the array to a per-render cached value rather
than rebuilding it per call. The cleanest form given the existing signature: pass the
already-computed list down.

Add an optional trailing parameter to `renderEdge`:

```ts
private renderEdge(edge: IREdge, pad: number, sketchy: boolean, typeAccent: Swatch, diagramType?: DiagramType, byId?: Map<string, IRNode>, fan?: Fan, labelPos?: LabelPlacement, preRouted = false, allNodesIn?: IRNode[]): string {
```

and inside, replace both `const allNodes = byId ? [...byId.values()] : undefined;`
occurrences with:

```ts
const allNodes = allNodesIn ?? (byId ? [...byId.values()] : undefined);
```

`renderToSvg` already has `allNodes` in scope at the render loop — pass it through.

**Do not** change `routeBetween`'s contract. It distinguishes `undefined` (legacy elbow
routing) from an array (obstacle-aware routing); preserve that exactly. In particular,
`allNodesIn ?? (...)` must not turn an intentional `undefined` into `[]`.

### Verify

`npm test` green. This is a pure refactor with no behaviour change; any test failure means
the `undefined` vs `[]` distinction was broken — recheck step by step.

---

## P5 — Marp preview re-renders the entire deck on every keystroke

**File:** `packages/vscode-ext/src/marp/preview-panel.ts`, `resolveCustomTextEditor`

### Problem

The file header comment claims:

```
// shows one slide at a time with prev/next navigation, and re-renders on save
```

But the subscription fires on every document change:

```ts
const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
  if (e.document.uri.toString() === doc.uri.toString()) {
    updatePanel(panel, this.engine, doc);
  }
});
```

`updatePanel` runs `renderMarpDeck` — a full Marp render **plus** a full SelDiA/Mermaid/
PlantUML compile of every fenced diagram in the deck — and then reassigns
`panel.webview.html`, which tears down and rebuilds the entire webview DOM. On every
keystroke. This also resets the viewer's current slide and scroll position mid-typing.

The main interactive provider (`packages/vscode-ext/src/webview/provider.ts`) already gets
this right with a `_renderTimer` debounce; the Marp panel was not given the same treatment.

### Fix

Debounce the re-render, matching the existing provider's approach.

```ts
export class MarpPreviewProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly engine: CoreEngine) {}

  resolveCustomTextEditor(
    doc: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    panel.webview.options = { enableScripts: true };
    panels.set(doc.uri.toString(), panel);

    updatePanel(panel, this.engine, doc);

    // Re-rendering a deck means a full Marp render plus a compile of every
    // fenced diagram in it, and reassigning webview.html rebuilds the whole
    // DOM (losing the current slide). Debounce so that only lands once the
    // author pauses, rather than on every keystroke.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== doc.uri.toString()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        updatePanel(panel, this.engine, doc);
      }, 300);
    });

    panel.onDidDispose(() => {
      if (timer) clearTimeout(timer);
      changeSub.dispose();
      panels.delete(doc.uri.toString());
    });
  }
}
```

Use `300` ms to match `SyncController`'s default (`packages/vscode-ext/src/utils/sync-controller.ts:71`).

Note this consolidates the **two separate** `panel.onDidDispose(...)` registrations in the
current code into one, and makes the pending timer get cleared on dispose — without that,
a timer can fire after disposal and assign `webview.html` on a disposed panel, which throws.

Also fix the stale header comment: change "re-renders on save" to "re-renders as you type
(debounced)".

### Verify

- `npm test` green (`packages/vscode-ext/test/marp.test.ts`).
- The tests exercise `renderMarpDeck` / `isMarpDocument`, not the provider wiring, so this
  change is unlikely to be covered. Confirm by inspection that: (a) the timer is cleared on
  dispose, (b) `panels.delete` still runs on dispose, (c) `changeSub.dispose()` still runs.

---

## P6 — Marp webview has no Content-Security-Policy and unrestricted resource roots

**File:** `packages/vscode-ext/src/marp/preview-panel.ts`

### Problem

```ts
panel.webview.options = { enableScripts: true };
```

Two gaps versus the main provider (`webview/provider.ts:66-67`), which sets both
`enableScripts` **and** `localResourceRoots`:

1. **No `localResourceRoots`.** Left unset, the webview may load local resources from
   anywhere the extension can reach, rather than a declared allowlist.
2. **No CSP `<meta>` tag** in `shellHtml()` / `notMarpHtml()`. VS Code's webview docs
   recommend a restrictive CSP on every webview; without one, content injected through the
   rendered deck runs with fewer constraints than intended.

The content here is user-authored Markdown compiled through Marp, which emits HTML by
design — so this is a hardening gap rather than a demonstrated exploit. It is still the
right thing to close, and it makes the Marp panel consistent with the main provider.

### Fix

1. Restrict resource roots, mirroring the main provider. The provider uses the extension's
   `media` directory; `MarpPreviewProvider` currently has no `extensionUri`, so thread it
   in through the constructor:

```ts
export class MarpPreviewProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly engine: CoreEngine,
    private readonly extensionUri: vscode.Uri
  ) {}
```

```ts
panel.webview.options = {
  enableScripts: true,
  localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
};
```

Update the registration site to pass `context.extensionUri`. Find it with:

```
grep -rn "new MarpPreviewProvider" packages/vscode-ext/src
```

2. Add a CSP meta tag to `shellHtml()`. The deck's inline `<style>` and the inline
   `<script>` in the shell both need `'unsafe-inline'`; keep everything else closed:

```ts
const csp = [
  `default-src 'none'`,
  `img-src ${panelCspSource} https: data:`,
  `style-src ${panelCspSource} 'unsafe-inline'`,
  `font-src ${panelCspSource} data:`,
  `script-src 'unsafe-inline'`,
].join('; ');
```

`shellHtml` is currently a free function with no access to the webview, so pass
`panel.webview.cspSource` in as a new parameter (`panelCspSource`) from `updatePanel`,
which does have the panel. Insert into the `<head>`, immediately after `<meta charset>`:

```html
<meta http-equiv="Content-Security-Policy" content="${csp}">
```

Apply the same meta tag to `notMarpHtml()` (it has no script or image needs — use
`default-src 'none'; style-src 'unsafe-inline'`) and to the error-path HTML in
`updatePanel`'s `catch`.

3. Preferred follow-up, only if it does not require restructuring the inline script: move
   the shell's `<script>` to a nonce (`script-src 'nonce-...'`) instead of
   `'unsafe-inline'`. Generate a fresh random nonce per render and put it on the `<script>`
   tag. **If this turns out to need broader changes, skip it and leave `'unsafe-inline'`
   with a `// TODO` comment** — the resource-root and CSP additions above are the substance
   of this item.

### Verify

- `npm test` green.
- Confirm the Marp preview still renders a deck (styles present, prev/next buttons work).
  If the CSP is too tight the slides will render unstyled or the buttons will go dead —
  that means a directive needs widening, not removing the CSP.

---

## P7 — `render()` has no error guard, unlike every other pipeline stage

**File:** `packages/core/src/engine.ts`

### Problem

`transform()` and `validate()` both wrap their plugin calls:

```ts
catch (err: any) { return { ok: false, errors: [{ severity: DiagnosticSeverity.ERROR, message: `Transform error: ${err.message}`, ... , code: 'E0005' }] }; }
```

`render()` does not. It calls into `renderToSvg`, which dispatches to per-type plugin
`renderNode` hooks and a large body of custom renderers (`custom-renderers.ts`, 1904
lines) that index into `node.data` with `as any` casts throughout. A malformed IR — from a
third-party plugin, or from a Mermaid/PlantUML importer producing an unexpected shape —
throws out of `compileSync` instead of returning `{ ok: false, errors }`.

This matters most in `packages/vscode-ext/src/markdown-preview/plugin.ts:134`, where
`renderSelDiABlock` calls `engine.compileSync(code)` with no try/catch inside a markdown-it
fence rule. A throw there propagates into VS Code's Markdown renderer and can break the
rendering of **the whole document**, not just the one bad diagram — even though the
function already has a well-designed error-box path for `!result.ok`.

### Fix

Two independent guards. Apply both.

**1. Wrap the render body in `engine.ts`.** Keep the existing
`setPaletteOverride` / `finally { clearPaletteOverride(); }` structure intact — the palette
must still be cleared on the error path. Wrap the `renderToSvg` call and its result
assembly:

```ts
const override = resolvePalette(this.config.render.palette ?? this.config.render.theme);
setPaletteOverride(override);
try {
  const fragmentBoxes = (layoutResult.diagram.metadata?.sequenceFragmentBoxes as any[]) ?? [];
  const svg = this.renderToSvg(nodes, edges, finalBounds, layoutResult.diagram.type, groups, fragmentBoxes);
  return { ok: true, value: { /* unchanged */ } };
} catch (err: any) {
  // A renderer (plugin renderNode hook, or a custom whole-canvas grammar)
  // threw on malformed IR. Report it as a normal pipeline error so hosts get
  // an error box for this one diagram instead of an exception that takes down
  // the surrounding document render.
  return {
    ok: false,
    errors: [{
      severity: DiagnosticSeverity.ERROR,
      message: `Render error: ${err?.message ?? err}`,
      code: 'E0006',
    }],
  };
} finally {
  clearPaletteOverride();
}
```

Check that `E0006` is not already taken — `grep -rn "E000[0-9]\|E00[0-9][0-9]" packages/core/src`
— and pick the next free code if it is.

**2. Defensive try/catch at the markdown-preview call site.** In
`packages/vscode-ext/src/markdown-preview/plugin.ts`, `renderSelDiABlock`:

```ts
let result;
try {
  result = engine.compileSync(code);
} catch (err: any) {
  result = { ok: false as const, errors: [{ message: `Internal error: ${err?.message ?? err}` }] };
}
```

so the existing `if (!result.ok)` error-box branch handles it. This keeps one bad fence
from breaking the document even if a future code path bypasses guard 1.

### Verify

- `npm test` green.
- Add a core test: build a `DiagramIR` whose node `data` is deliberately malformed for a
  type with a custom renderer, call `compileIRSync`, and assert it returns
  `{ ok: false }` with a `Render error:` message rather than throwing.

---

## P8 — `esc()` does not escape single quotes, and is duplicated four times

**Files:** `packages/core/src/engine.ts` (`private esc`), `packages/core/src/render/custom-renderers.ts:22`,
`packages/core/src/render/workitem-render.ts:19`, `packages/core/src/export/bpmn.ts:29`

### Problem

Four separate implementations of the same XML-escape helper. The two main ones are
character-identical:

```ts
private esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
```

Two issues:

1. **`'` is not escaped.** Every current interpolation into an SVG attribute in this
   codebase uses double quotes, so this is not exploitable today — but it makes the helper
   unsafe for any single-quoted attribute a future edit introduces, and that failure would
   be silent.
2. **The engine's version has no null guard.** `custom-renderers.ts` uses `(s || '')`;
   `engine.ts` uses a bare `s.replace(...)`, which throws on `undefined`. Given that node
   labels and ids flow in from importers, the guarded form is the correct one.

### Fix

1. Create `packages/core/src/render/escape.ts`:

```ts
// =============================================================================
// SelDiA — XML/SVG text escaping
// =============================================================================
// One shared implementation. Escapes both quote characters so the result is
// safe in single- and double-quoted attribute values alike, and tolerates
// null/undefined because labels and ids reach the renderers from importers.
// =============================================================================

/** Escape a string for safe interpolation into SVG/XML text or an attribute
 *  value (either quoting style). */
export function escapeXml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

2. In `engine.ts`, import it and make the private method delegate (keeping `this.esc(...)`
   call sites unchanged — there are many):

```ts
import { escapeXml } from './render/escape.js';
// ...
private esc(s: string): string { return escapeXml(s); }
```

3. In `custom-renderers.ts`, replace the local `function esc(...)` with
   `import { escapeXml as esc } from './escape.js';` — the local name stays `esc`, so its
   call sites are untouched.

4. `workitem-render.ts:19` (`const esc = ...`): same treatment. **Read it first** — confirm
   it is the same transformation before replacing it; if it differs (e.g. escapes newlines),
   leave it alone and note that in your summary.

5. **Leave `export/bpmn.ts:29` alone unless it is character-identical.** BPMN is an XML
   export format, not SVG, and may have deliberately different escaping requirements. Read
   it and decide; if identical, migrate it too.

6. Export `escapeXml` from `packages/core/src/index.ts` under the existing render section:

```ts
export { escapeXml } from './render/escape.js';
```

### Verify

- `npm test` green. The added `'` → `&#39;` escaping changes SVG output for any label
  containing an apostrophe. If a snapshot/fidelity test (`mermaid-fidelity.test.ts`,
  `plantuml-fidelity.test.ts`) fails on that, **the new output is correct** — update the
  expectation, and say so explicitly in your summary.

---

## P9 — `ICON_SPRITE` duplicated per diagram block, producing duplicate DOM ids

**File:** `packages/vscode-ext/src/markdown-preview/plugin.ts` (lines ~139, 157, 233, 269)

### Problem

`ICON_SPRITE` (a ~7 KB `<svg style="display:none">` block of `<symbol id="seldia-icon-*">`
definitions, from `packages/vscode-ext/src/shared/icons.ts:14`) is emitted **inside every
rendered block**, at four separate sites.

A Markdown document with 10 SelDiA diagrams therefore ships ~70 KB of identical SVG and
declares each `id="seldia-icon-visibility"` (and siblings) **ten times**. Duplicate `id`
attributes are invalid HTML; `<use href="#seldia-icon-...">` resolves to the first match,
so it renders correctly today, but it is invalid markup and pure payload bloat.

The sprite's own doc comment states the contract: *"Callers must also inline `ICON_SPRITE`
**once** somewhere in the same document/webview"* (`icons.ts:44-45`). The current code
violates it.

### Fix

Emit the sprite at most once per rendered document.

markdown-it renderer rules are called per token with a shared `env` object for the
document, and `renderSelDiABlock` already receives document context. Use `env` as the
once-per-document flag.

1. Change `renderSelDiABlock`'s signature to take a flag, defaulting to today's behaviour
   so the existing unit tests (which call it directly) keep passing:

```ts
export function renderSelDiABlock(engine: CoreEngine, code: string, docUri = '', includeSprite = true): string {
```

2. Replace each of the four `${ICON_SPRITE}` interpolations with
   `${includeSprite ? ICON_SPRITE : ''}`.

3. At the markdown-it fence rule that calls `renderSelDiABlock`, track per-`env` state:

```ts
const spriteKey = '__seldiaSpriteEmitted';
const first = !env?.[spriteKey];
if (env && first) env[spriteKey] = true;
return renderSelDiABlock(engine, code, docUriOf(env), first);
```

Guard for a missing/frozen `env`: if `env` is null or assignment throws, fall back to
`includeSprite = true` (correct, just not deduplicated). Wrap the assignment in a
`try { } catch { }` if that is a concern.

4. Apply the same treatment to the other renderer entry point around line 233/269 (the
   imported-format path) so the two share one flag.

### Verify

- `npm test` green (`packages/vscode-ext/test/plugin.test.ts`). The `includeSprite = true`
  default preserves existing direct-call test expectations.
- Add a test rendering two blocks through one shared `env` object and asserting
  `ICON_SPRITE`'s distinctive substring (e.g. `id="seldia-icon-visibility"`) appears
  exactly once across the concatenated output.

---

## P10 — `packages/interaction` has no tests at all

**Package:** `packages/interaction` (~2,900 lines across 14 modules, 0 test files)

### Problem

Every other workspace package has a test suite:

| Package | Test files |
|---|---|
| `core` | 19 |
| `vscode-ext` | 7 |
| `cli` | 5 |
| `web` | 1 |
| **`interaction`** | **0** |

The package contains genuinely testable pure logic — `source-map-builder.ts` (a high
fan-out module), `diff-patcher.ts`, `code-generator.ts`, `collapse-expand.ts`,
`selection.ts` — plus DOM-dependent modules (`manager.ts`, `drag-drop.ts`, `zoom-pan.ts`,
`tooltips.ts`, `aria.ts`).

`manager.ts` also carries a concrete lifecycle risk that a test would pin down: `attach()`
registers `document.addEventListener('keydown', this.boundKeyHandler)` and `detach()`
removes it. Any path that re-attaches without detaching leaks a listener.

### Fix

Add a Vitest suite. `packages/web` already tests DOM code with `happy-dom` (see
`packages/web/test/components.test.ts` and its vitest config) — copy that setup.

1. Add `vitest` config + a `test` script to `packages/interaction/package.json`, mirroring
   `packages/web/package.json` exactly (same vitest version, same `environment: 'happy-dom'`).
   Confirm turbo picks it up (`turbo.json` already runs `test` across the workspace).

2. Create `packages/interaction/test/source-map.test.ts` — pure logic, highest value:
   - `buildSourceMap` maps a node id to the correct source line for a simple diagram.
   - Edges map to their declaration lines.
   - A source with no matching IR still returns a well-formed (empty) map rather than
     throwing.

3. Create `packages/interaction/test/manager.test.ts` — the lifecycle regression:
   - `attach(container)` then `detach()` leaves no `keydown` listener. Assert by spying on
     `document.addEventListener` / `removeEventListener` and checking the same handler
     reference is passed to both.
   - `attach()` called twice without an intervening `detach()` must not register two
     listeners. It currently guards this correctly (`if (this.attached) return;` at
     `manager.ts:182`) — the test locks that guard in against future edits, it is not
     fixing a present bug.

4. Create `packages/interaction/test/diff-patcher.test.ts` and
   `packages/interaction/test/code-generator.test.ts` with a few round-trip cases each.

Aim for a meaningful smoke suite over exhaustive coverage. Do not refactor the modules to
make them testable as part of this item — if something is genuinely untestable without
restructuring, note it and move on.

### Verify

`npm test` runs the new package and passes. Report the new test count.

---

## P11 — `provider.ts` contains literal NUL bytes, making the file read as binary

**File:** `packages/vscode-ext/src/webview/provider.ts`, line ~406

### Problem

```ts
const sig = `${svgContent}${stats}${errorMsg}`;
```

The separators between the interpolations are literal `U+0000` NUL characters embedded in
the source file. The intent is sound — a delimiter that cannot occur in the joined values,
so the cache signature is unambiguous.

The cost is tooling. `file(1)` reports the file as `data` rather than source; `grep` treats
it as binary and silently returns nothing (`grep -c "" provider.ts` produces no output at
all), which makes the file invisible to ordinary code search; some diff viewers and editors
will refuse to display it inline.

The file is valid UTF-8 and TypeScript compiles it fine, so this is a maintainability
problem, not a correctness one.

### Fix

Replace the embedded raw NULs with the escape sequence ` `, which is the identical
string value with no non-printable bytes in the source:

```ts
// NUL separators: neither the SVG, the stats line, nor an error message can
// contain U+0000, so the joined signature is unambiguous. Written as an escape
// rather than a literal NUL byte so the file stays plain text for grep/diff.
const sig = `${svgContent} ${stats} ${errorMsg}`;
```

Then confirm no other NULs remain in the tree:

```
grep -rlP '\x00' packages --include='*.ts' | grep -v node_modules
```

Fix any others the same way.

### Verify

- `file packages/vscode-ext/src/webview/provider.ts` reports ASCII/UTF-8 text, not `data`.
- `grep -c "" packages/vscode-ext/src/webview/provider.ts` prints `1557`.
- `npm test` green — the signature string value is unchanged, so caching behaviour is
  identical.

---

## P12 — Verified non-issues (do not "fix" these)

PAiRS's `dead_code` analysis flags 30 symbols. Most are **false positives** — the analysis
is syntactic and does not follow indirect dispatch. Do not delete them.

- **`SelDiAEngine` (class) and its methods** (`engine.ts:155`, `compile`, `validate`,
  `registerTheme`) — instantiated inside the `createEngine` factory at `engine.ts:908`,
  which PAiRS does not trace. The class is live; only the factory is exported.
- **`exportFlowchart` / `exportSequence` / `exportClass` / `exportEr` / `exportState` /
  `exportGantt` / `exportPie` / `exportGitgraph` / `exportMindmap` / `exportUsecase` /
  `exportActivity`** in `export/mermaid.ts` and `export/plantuml.ts` — reached through a
  dispatch table (`export/mermaid.ts:357`: `[DiagramType.FLOWCHART]: exportFlowchart`),
  not by direct call. All live.
- **Every `[interface]` entry marked `type-only`** — PAiRS emits no reference edges for
  type positions, so interfaces always look unreferenced. Ignore all of them.

- **`printBanner`** (`cli/src/index.ts:13`) — passed as a Commander lifecycle hook at
  `cli/src/index.ts:33` (`.hook('preAction', printBanner)`), never called by name. Live.
- **`genericPlugin.transform` / `genericPlugin.getDefaultLayoutOptions`**
  (`diagrams/misc.ts:29,43`) — plugin-interface methods invoked through the plugin
  registry, not directly. Live.

One flagged symbol **is** worth a look:

- **`cloudIcon`** (`diagrams/misc.ts:510`) — `grep -rn "cloudIcon" packages/core/src`
  returns only the definition, and it is not exported. Genuinely unreferenced; it may be
  removed. Re-run the grep to confirm before deleting.

---

## Suggested order

1. **P11** first — it makes `provider.ts` greppable, which every later item benefits from.
2. **P1 → P2 → P3 → P4** as one block; they are all edge-routing performance and interact.
   Run `npm test` between each, not just at the end.
3. **P7, P8** — core correctness/robustness.
4. **P5, P6, P9** — VS Code extension.
5. **P10** last — new test infrastructure, independent of everything above.

## Ground rules

- Run `npm test` after **every** item. All 10 packages must stay green.
- Where an item says a test failure is a signal worth reporting rather than fixing (P2, P3,
  P8, P10), stop and report rather than adjusting the assertion to match new output.
- Do not bundle unrelated refactors into these changes.
