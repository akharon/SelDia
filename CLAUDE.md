# SelDiA Codebase Guide

## Project Overview

**SelDiA** (Self-Diagramming Architecture) is a unified diagram engine that:
- Parses **Mermaid, PlantUML, SelDiA DSL** into a real intermediate representation (IR)
- Renders 31+ diagram types (flowchart, sequence, class, C4, BPMN, DMN, state, ER, Gantt, etc.)
- Provides **LSP, validation, diagnostics** for agent-guided diagram maintenance
- Exports back to native formats (Mermaid, PlantUML, BPMN)
- Ships as **VS Code extension**, **CLI**, **web components** (`<seldia-viewer>`), and **NPM packages**

Core thesis: **Drift is the unsolved problem.** Generating diagrams is commoditized; keeping them true as systems evolve requires an IR, round-tripping, and structured queries. That's the engine SelDiA provides.

## Workspace Structure

Monorepo (pnpm workspaces) with 5 packages + root:

```
├── packages/core          → Parser, IR, engine, plugins (21+ diagram types)
├── packages/cli           → CLI: compile, validate, serve, init, render, export
├── packages/interaction   → Zoom/pan, drag-drop, selection, undo/redo, ARIA
├── packages/vscode-ext    → VS Code extension: editor, preview, LSP, Marp slides
├── packages/web           → Web components: <seldia-viewer>, viewer API
├── docs/                  → VitePress docs (seldia.dev)
└── [demos, examples, tests, scripts]
```

**Root turbo.json** orchestrates builds; each package is independent.

## Core Package Deep Dive

**`packages/core/src`** is the engine. Layout:

### AST & Parsing
- `ast/nodes.ts` — AST node types (DIAGRAMs, STATEMENTs, EDGE, NODE, etc.)
- `parser/` — Lexer + recursive descent parser
- `config.ts` — Diagram config (width, height, theme, sketch mode, etc.)

### Intermediate Representation (IR)
- `ir/types.ts` — **The IR type system** (IRShape, IREdge, IRNode, IRGroup, IRLabel, etc.)
  - This is where text becomes queryable structure
  - All renderers & transformations read from IR, not raw AST

### Diagram Type Plugins
- `diagrams/*.ts` — **Diagram type implementations** (one file per type)
  - `flowchart.ts`, `sequence.ts`, `class.ts`, `c4.ts`, `bpmn.ts`, `er.ts`, `state.ts`, `gantt.ts`, `mindmap.ts`, `workitem.ts`, etc.
  - Each plugs into engine via `plugin/types.ts`
  - Lexicon defined in `diagrams/misc.ts` (shared keywords like `node:`, `edge:`)

### Engines & Layout
- **`engine.ts`** — **Main orchestrator** (~56KB)
  - Compile (parse → AST → IR) pipeline
  - Shape instantiation & tree traversal
  - Layout dispatch (Dagre, d3-force, custom)
  - Theme/styling application
  - Render call (to `render/*.ts`)
- `layout/engines.ts` — Dagre (hierarchical), d3-force (network), custom layout dispatchers
- `layout/text-measure.ts` — Canvas text measurement for label wrapping

### Rendering & Styling
- `render/` directory:
  - Core rendering (SVG generation, Rough.js sketchy mode)
  - `design-system.ts` — Token-based color/stroke/fill system
  - `custom-renderers.ts` — Per-type shape rendering (circles, rects, paths)
- `themes.ts` — Light/dark, sketchy/clean, color tokens

### Import/Export
- `import/mermaid.ts` — Mermaid DSL → SelDiA IR
- `import/plantuml.ts` — PlantUML → IR
- `export/mermaid.ts` — IR → Mermaid DSL (round-trip back to GitHub-compatible format)
- `export/plantuml.ts` — IR → PlantUML
- `export/bpmn.ts` — IR → BPMN XML
- `export/sql-ddl.ts` — ER → SQL DDL

### Plugin System
- `plugin/types.ts` — Plugin interface (TypeDef, Parser, Renderer, Exporter)
- `plugin-manager.ts` — Registration & dispatch
- `registry.ts` — Plugin registry (which diagram types are loaded)

### Utilities
- `analyzer.ts` — Diagram analysis (dead nodes, cycles, hotspots)
- `diff/diff.ts` — IR diff for detecting changes
- `macro/include.ts` — `include()` macro support
- `workitem/` — Work-item diagram type & renderer
- `floorplan/` — Floorplan-specific (catalog, auto-dimensions)

## Interaction Package

**`packages/interaction/src`** — User input handling for VS Code Edit mode.

Key abstractions:
- **Drag-drop**: Select, pan, drag nodes → emit positioned IR updates
- **Source maps**: Map pixel coords ↔ source line ranges
- **Undo/redo**: Snapshot-based state machine
- **Code generator**: IR → SelDiA DSL (write-back)
- **Diff patcher**: Merge code edits with IR state

Exports:
- `code-generator.ts` — IR → DSL source
- `source-map.ts` — Coordinate/range bidirectional mapping
- `diff-patcher.ts` — Merge edits
- `undo-redo.ts` — Snapshot state machine

## CLI Package

**`packages/cli/src`** — Command-line interface.

Commands:
- `compile <file>` → SVG (via engine)
- `validate <file>` → LSP diagnostics
- `serve <file> [--port N]` → Live preview server
- `render . -o <dir>` → Batch render all `.sld` + fenced blocks
- `export <file> -t [mermaid|plantuml|bpmn|sql]` → Export to other formats
- `init <name>` → Scaffold new `.sld` file

## VS Code Extension

**`packages/vscode-ext/src`** — Full IDE integration.

Key files:
- `extension.ts` — Activation, command registration, LSP server setup
- `markdown-detector-types.ts` — Fence detection in Markdown
- `types.ts` — Extension-specific types (panels, URI schemes)
- **Preview panel** — Renders diagrams via custom editor
- **Edit panel** — Two-pane editor: DSL + live visual, uses `@seldia/interaction`
- **LSP server** — Syntax highlight, diagnostics, hover, code completion
- **Marp support** — Slide preview with inline diagram rendering

Exports:
- `vscode://` URI scheme for deep links
- `seldia://` custom editor schemes
- CodeLens for export actions

## Web Package

**`packages/web/src`** — Web components for embedding.

Exports:
- `<seldia-viewer>` — Read-only viewer custom element
- `<seldia-editor>` — Two-pane editor for pages (experimental)
- API: programmatic access to diagram data, theme toggle, etc.

## Common Patterns & Constraints

### The IR is the contract
- **All transformations read from IR**, never raw AST
- Renderers read `label` field (not `data`); class/ER parse label newlines for structure — see [[renderer-reads-structure-from-the-label]]
- Tests can't catch silent IR drops; always verify rendered output

### Null → default behavior (load-bearing)
- Import/export fallback: no fence → wraps in default fence — see [[mermaid-import-engine-position]]
- Turning this into an error box breaks backward compat

### Styling is token-based
- `design-system.ts` defines color/stroke/fill tokens
- Themes (light/dark/sketchy) override tokens
- MermaidJS + PlantUML classdef/style/linkStyle import → IR styling nodes; exporters read these back

### Group/subgraph layout
- IRGroup + layout engine handle hierarchical clusters
- Mermaid subgraphs → IRGroups → Dagre clusters — see [[group-subgraph-support]]

### Export fidelity
- Mermaid export: lossy (can't round-trip C4, BPMN); 9-sample corpus tests coverage — see [[mermaid-styling-export-fidelity]]
- PlantUML: better fidelity; group nesting + Dagre clusters fixed in 2026-08-11

### Plugin lifecycle
- Types extend `TypeDef` interface
- Parser produces AST nodes
- Engine instantiates shapes from AST
- Renderers paint shapes
- Exporters walk IR → foreign format

### Floorplan specifics
- Auto exterior wall dimensions via `measure` statement
- Layout uses offsetTop (not getBoundingClientRect) for scaling — see [[marp-diagram-fit]]
- "Show each length once" is four separate suppressions

## User Communication Preferences

⚠️ **This project prefers terse interactions — minimal explanations in chat, rely on diffs and code for context.**

- No trailing summaries of changes made
- Questions get direct answers, not elaboration
- Preserve token budget by defaulting to action over narration

## Recent Work (2026-07 to 2026-09)

Key items shipped:
- **Mermaid import & engine positioning** (2026-07-16) — Mermaid/PlantUML as inputs; null→default-fence fallback is load-bearing
- **Visual grammar per type** — Each diagram type now has distinct rendering grammar
- **Group/subgraph support** — IRGroup layout + Dagre clusters (2026-07-16)
- **Mermaid styling/export** — style/classDef/linkStyle import; exportMermaid() with 9-sample fidelity corpus (2026-07-17)
- **PlantUML fidelity** — 4 feature-interaction bugs found via corpus testing; group layout fixed (2026-08-11)
- **Work-item diagrams** — Closed-vocabulary traceability type (2026-08-11)
- **Marp support** — Slide preview + fence-chaining (2026-08-12)
- **Floorplan** — Auto dimensions + live drag guides + Edit-visually toolbar (2026-09-08)
- **CodeLens export gating** — Hide export lens for types without exporters (2026-09-08)

Current branch: **pivot** (uncommitted changes in package.json files, likely version/dep updates).

## How to Add a New Diagram Type

1. **Define AST nodes** in `diagrams/misc.ts` (keywords, shape types)
2. **Create parser** in `diagrams/yourtype.ts` — inherit from base, implement `parse()`
3. **Implement renderer** in `render/custom-renderers.ts` — shape painting logic
4. **Register in plugin system** — plugin-manager discovers it automatically
5. **Add exporter** (optional) in `export/yourtype.ts` if you want round-trip support
6. **Test** — render to PNG, verify visually; unit tests catch structure, not pixels

See [[work-item-diagrams]] for example gotchas when adding types.

## Running & Testing

```bash
npm run build              # Turbo builds all packages
npm run dev               # Watch mode
npm run test              # Vitest suite
npm run cli compile file.sld  # Use CLI directly
npm run docs:dev          # VitePress docs locally
```

VS Code extension:
```bash
# In packages/vscode-ext:
npm run build
# Then F5 to launch debug session
```

## Key Memories to Keep in Mind

- [[competitive-analysis-2026-07]] — SelDiA is the *engine*, not a rival format
- [[mermaid-import-engine-position]] — null→default-fence fallback is non-negotiable
- [[renderer-reads-structure-from-the-label]] — Class/ER parse newlines in LABEL, not data fields
- [[markdown-preview-edit-channel]] — vscode:// URIs + env.currentDocument, never command: URIs
- [[seldia-dsl-skill]] — DSL skill has compile-tested examples
- [[edit-panel-architecture]] — 2026-07-22 rework: provider owns write-back via patchers
- [[floorplan-dimensioning]] — offsetTop (not getBoundingClientRect) for layout scaling
- [[codelens-export-gating]] — ~13 types have no exporter; CodeLens hides them

---

**Last updated:** 2026-09-09 (PAiRS skill exploration + documentation)
