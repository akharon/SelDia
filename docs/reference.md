# Reference: build, configuration, fixtures, fidelity

Everything verified against the repository. Design lives in [arch.md](arch.md), usage in [user_guide.md](user_guide.md), open work in [improve.md](improve.md).

## Build and config

The repo is an **npm workspaces + Turborepo** monorepo (Node >= 22, `packageManager` npm@10). Workspaces: `packages/core`, `interaction`, `cli`, `web`, `vscode-ext`.

| File | Purpose |
|------|---------|
| `package.json` | Workspace list and root scripts: `build`, `dev`, `test`, `lint`, `clean`, `cli`, `docs:dev`/`docs:build`/`docs:preview` (VitePress over `docs/`), `test:integration` |
| `turbo.json` | Tasks: `build` (depends on `^build`, outputs `dist/**`), `test` (depends on `build`), `dev` (persistent), `lint`, `clean` |
| `tsconfig.base.json` | Shared compiler options (ES2022, ESNext modules, `strict`, bundler resolution); each package has its own `tsconfig.json` |
| `packages/*/package.json` | Per-package scripts. Tests are Vitest (`vitest run`). The per-package `lint` script is a placeholder (`echo lint`); no ESLint or Prettier config is committed |
| `packages/vscode-ext/package.json` | Extension manifest: commands, menus, keybindings, `seldia.*` settings, LM tools |
| `packages/vscode-ext/scripts/build.mjs` | esbuild bundles: extension host, language server, and the webview client `media/editor.js` |
| `docs/.vitepress/config.mts` | Docs site (`user_guide.md` is served as the home page via `rewrites`) |
| `.github/actions/seldia-render`, `.github/workflows/render-diagrams.yml.example` | GitHub Action that renders diagram blocks to SVG |

Scripts in `scripts/` (see `scripts/README.md`): `build.sh`, `test.sh`, `debug.sh`, `deploy.sh`, `bump-versions.sh`, `package-vsix.sh`, `install-vscode.sh`, `convert-icon.sh`, `github-setup.sh`, `verify-github-ready.sh`, plus `layout-metrics.mjs` / `layout-metrics-lib.mjs` (the layout-quality report).

```bash
npm run build            # turbo: all packages
npm run test             # turbo: build, then vitest in every package
npm run dev              # watch mode
bash scripts/package-vsix.sh   # build the .vsix (vsce needs --no-dependencies; the script handles it)
npm run docs:build       # VitePress site
node tests/integration.mjs     # end-to-end DSL -> SVG smoke test
```

To add a package: add it to `workspaces` in the root `package.json`, give it a `tsconfig.json` extending `tsconfig.base.json`, and add a row to the table above.

## Layout engine settings

Set in `packages/core/src/config.ts` (`DEFAULT_CONFIG`), overridable per engine via `createEngine({ config })`.

| Key | Default | Purpose | Where |
|-----|---------|---------|-------|
| `layoutEngineByType` | `auto` for `flowchart`; `elk` for `class`, `state`, `component`, `network`, `block`, `workitem`; `dagre` for the rest | Per-type auto-layout engine. Precedence (`engine.ts` `requestedEngine`): a diagram's own `layout` line, then a global `defaultLayoutEngine: 'elk'`, then `layoutEngineByType[type]`, then `defaultLayoutEngine`; grouped diagrams then go to ELK when `elkWhenGrouped`. Custom-layout types ignore it. Values: `dagre`, `elk`, `auto` (see `autoMaxNodes`) | `packages/core/src/config.ts` |
| `elkWhenGrouped` | `true` | A diagram that would default to `dagre` and has a group with members uses `elk` instead. An explicit `layout` line still wins. Also governs `auto`: a grouped diagram is not compared, it goes to `elk` (or `dagre` when this is `false`) | `packages/core/src/config.ts` |
| `autoMaxNodes` | `60` | `auto` engine only: a diagram with more nodes than this skips the comparison and uses a single ELK layout; a diagram with fewer than 2 edges uses dagre. Corpus cost of `auto` on flowcharts is about +1.2-1.4x total compile time (largest corpus flowchart is far below 60 nodes) | `packages/core/src/config.ts` |
| `autoMaxEdges` | `120` | `auto` engine only: a diagram with more edges than this also skips the comparison and uses a single ELK layout | `packages/core/src/config.ts` |
| `autoVariantMaxNodes` / `autoVariantMaxEdges` | `30` / `60` | `auto` engine only: diagrams within both limits try four layouts (dagre network-simplex and longest-path, ELK BRANDES_KOEPF and NETWORK_SIMPLEX); with <= 36 edges also up to three more (dagre tight-tree, ELK longest-path-source, and with <= 16 nodes ELK semi-interactive), then a median/barycenter sweep and a neighbour-swap pass whose try budget is `min(60, 900/edges)` (the top 3 variants are refined only with <= 16 nodes and <= 24 edges); larger diagrams under `autoMaxNodes`/`autoMaxEdges` try one dagre and one ELK; diagrams over those use a single ELK layout (thoroughness 3), since dagre's ordering is superlinear on dense graphs. Score order: gated defects (an edge over `DS.maxBendsPerEdge` counts as one), `crossings * crossingBendWeight + bends`, rank-skip penalty, routed length | `packages/core/src/config.ts` |
| `DS.crossingBendWeight` | `8` | `auto` engine and the refine passes: one edge crossing costs this many bends in the layout score (`crossings * weight + bends`, after gated defects). Raise it to prefer fewer crossings at the price of more bends | `packages/core/src/render/design-system.ts` |
| `edgeStyle` | `clean` | `clean` = rounded orthogonal edges with line jumps and hover highlight; `sketch` = hand-drawn rough edges | `packages/core/src/config.ts` |

## Test fixtures and gates

Corpus-style tests run over `docs/examples/` (every fence of every demo file) and the importer corpora. Fixture-asserting tests live next to the code in each package's `test/`.

| File | Purpose | Format | Usage |
|------|---------|--------|-------|
| `packages/core/test/fixtures/circuits/*.cir` + `*.expected.json` | 8 SPICE netlists with expected parts, nets, power nets (top-level only; `.subckt` internals not expanded; `value` = model/subckt name for D/Q/M/X) | SPICE / JSON | Circuit (`circuit` type) SPICE parser tests (T4.2) |
| `packages/core/test/fixtures/circuits/09-skidl-rc.net` + `.expected.json` | KiCad netlist as SKiDL `generate_netlist()` writes it (pin functions B/C/E, `/mid` net name, single-pin net) | KiCad s-expr / JSON | KiCad importer test (T4.3); `test/circuit.test.ts` also covers the >40-part warning |
| `packages/core/test/fixtures/pcb/blinky.kicad_pcb` | Hand-written 30x20 mm board: 2 resistors (one rotated), LED, 2-pin header, 4 tracks (F.Cu/B.Cu), 1 via, Edge.Cuts outline | KiCad s-expr | `test/pcb.test.ts` parser and render tests (`pcb` type, render-only) |
| `packages/core/test/fixtures/layout-baseline.json` | Layout-quality baseline per docs/examples fence, measured with the shipped defaults (`measureCorpus(..., 'defaults')`). Gated per diagram type on crossings, edgeOverlaps, borderHugs, nodeLabelHits, edgeNodeHits, labelOverlaps and groupViolations; `bends` is recorded but not gated | JSON | `layout-metrics.test.ts` gate: current <= baseline + max(1, ceil(10%)) per type. Regenerate from packages/core: `UPDATE_LAYOUT_BASELINE=1 npx vitest run test/layout-metrics.test.ts` |
| `docs/layout-metrics.json` | Live layout-metrics report: per-fence values and totals from the corpus | JSON | Written by `node scripts/layout-metrics.mjs [--engine dagre\|elk] [--quiet] [--out file]` (no `--engine` = shipped defaults). Not gated; regenerate, do not hand-edit |
| `packages/core/test/label-legibility.test.ts` | Label legibility over the docs/examples corpus: chips stay on their own edge, off arrowheads, nodes and group titles; token lint (`tokenViolations` = 0, every `stroke-width` and `font-size` is a DS token) | TypeScript | Run with the core suite |
| `packages/core/test/edge-layer.test.ts` | Unit tests for `render/edge-layer.ts`: `postRoute` (nudge, apex snap, title-band avoidance, jumps), `edgePathD`, `arrowheadSvg` | TypeScript | Run with the core suite |
| `packages/core/test/layout-metrics-labels.test.ts` | Hand-built IRs for the label metrics (`labelDetached`, `labelOnArrowhead`, `labelEdgeHits`, `groupTitleHits`, `parallelRunLength`) and `tokenViolations` | TypeScript | Run with the core suite |
| `packages/core/test/table.test.ts` | `table` type: pipe-row parsing, `^`/`<` merge resolution (chains, 2x2 blocks, escapes), invalid and non-rectangular merges degrading with diagnostics, engine compile and theming, lossy GFM export; `chart` directive (defaults, named/quoted columns, non-numeric warnings, pie single column), table IR → chart IR, stacked table+chart and `only` SVG | TypeScript | Run with the core suite |
| `packages/vscode-ext/test/seldia-table-patch.test.ts` | Table editor write-back for `table` fences: merge/unmerge, span-aware insert/delete/move, marker escaping, GFM → fence conversion, setting/replacing/removing the `chart` directive. Output is re-parsed with core's `parseTableBody` | TypeScript | Run with the vscode-ext suite |
| `packages/cli/test/check.test.ts` | `seldia check`: per-fence report, `--json`, `--max` exit code, bad extension | TypeScript | Run with the CLI suite |
| `packages/core/test/fixtures/mermaid-corpus/*.mmd` | 9 hand-written Mermaid samples (flowchart, sequence, class, ER, state, gantt, gitGraph, mindmap, pie) | Mermaid | `mermaid-fidelity.test.ts`: import, render, export, re-import |
| `packages/core/test/fixtures/plantuml-corpus/*.puml` | 7 PlantUML samples (activity, class, component, ER, sequence, state, usecase) | PlantUML | `plantuml-fidelity.test.ts`, `group-layout.test.ts` |
| `packages/vscode-ext/test/skill-examples.test.ts` | Compiles the examples embedded in the seldia-dsl SKILL.md | TypeScript | Run with the vscode-ext suite |
| `docs/examples/demo-*.md` | basic, mermaid, plantuml, circuits, readability, marp galleries | Markdown | Documentation and the layout-metrics corpus |

**Readability metrics** (`measureLayout` in `layout/metrics.ts`, also in `docs/layout-metrics.json` and `seldia check`): `labelDetached` (chip more than 16px from its own edge), `labelOnArrowhead` (chip on the last 14px of an edge), `labelEdgeHits` (chip on another edge or a group title band), `groupTitleHits` (edge through a group title), `parallelRunLength` (px of overlapping collinear runs). `tokenViolations(svg)` counts `stroke-width` and `font-size` values that are not DS tokens.

To add a fixture: drop the file next to the others, extend the test that loads the directory, and add a row here. To refresh the layout baseline after an intended layout change, run the `UPDATE_LAYOUT_BASELINE=1` command above and review the diff.

## Fidelity per exporter

There are no per-renderer packages; renderers are modules in `packages/core/src/render/`. Fidelity is a property of the import and export legs, and it is asserted by the corpus tests above rather than by a loss percentage.

- **Mermaid import** (`import/mermaid.ts`): flowchart, sequence, class, ER, state, gantt, pie, gitGraph, mindmap. Journey is deliberately excluded. An unsupported construct degrades to a diagnostic, and an unimportable block falls back to the default fence (G3).
- **Mermaid export** (`exportMermaid`): lossy by design. Covers the types with a Mermaid equivalent; styling round-trips through `style`, `classDef` and `linkStyle`. Types with no mapping return `null` and the CodeLens hides the action. The 9-sample corpus asserts what survives import, export, and re-import.
- **PlantUML import/export**: 11 families imported without Java. Better than Mermaid for class, sequence, component, state, activity and usecase; groups map to real layout clusters. The 7-sample corpus gates it. `@startjson` and other declined blocks are reported as unsupported, not failed.
- **BPMN XML / SQL DDL** (`exportBpmn`, `exportSqlDdl`): one-way exports for `bpmn` and `er`.
- **GFM export of `table`** (`exportTableGfm`): cell text, column alignment and header row survive. Merged cells do not (GFM has no spans): the anchor keeps the text and covered cells are written empty. The `chart ...` directive is dropped but the data is kept. `table` has no Mermaid or PlantUML mapping.
- **Circuit and PCB**: `circuit` imports SPICE and KiCad netlists (top level only; `.subckt` internals are not expanded). `pcb` is render-only.
