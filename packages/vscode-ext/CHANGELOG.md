# Changelog

## Unreleased

- **Markdown Visual Editor** — new custom editor (`seldia.markdownEditor`) that shows a `.md` file as rendered prose and diagrams. Click prose to edit its Markdown, edit `seldia`/`mermaid`/`plantuml` fences inline with live re-render, double-click a diagram for the interactive canvas. Open via the editor-title button, `SelDiA: Open Markdown Visual Editor`, or Reopen Editor With.

## 1.65.0

Unified Diagram-as-Code extension for VS Code: parses Mermaid, PlantUML, and
the SelDiA DSL into a shared IR and renders 31+ diagram types with a
hand-drawn Rough.js aesthetic.

- **Diagram types** — flowchart, sequence, class, C4, BPMN, DMN, state, ER,
  Gantt, mindmap, charts, Sankey, timeline, Git graph, floorplan, work-item,
  and more, all through one DSL
- **Language Server** — diagnostics, completion, hover docs, go-to-definition,
  document symbols
- **Interactive editing** — drag-drop, zoom/pan, inline label editing,
  collapse/expand groups, undo/redo, with visual edits round-tripping back to
  source
- **Import/export** — Mermaid and PlantUML import to IR; export back to
  Mermaid, PlantUML, BPMN XML, or SQL DDL
- **Markdown integration** — auto-detected fenced diagram blocks with inline
  SVG preview and CodeLens export actions
- **Marp support** — slide preview and Markdown-to-PDF export with diagrams
  rendered inline
- **GitHub Copilot skill** — deploy SelDiA DSL knowledge as a Copilot skill,
  plus Language Model Tools for render/validate/list-types
- **Floorplan mode** — auto exterior wall dimensioning, live drag guides,
  edit-visually toolbar
