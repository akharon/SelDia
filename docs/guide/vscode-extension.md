# VS Code Extension

The SelDiA VS Code extension provides a rich editing experience for `.sld` files and Markdown integration.

## Features

### Language Support
- **Syntax highlighting** — Full TextMate grammar for `.sld` files
- **Autocomplete** — Diagram types, shapes, themes, arrow types, keywords, node IDs
- **Hover info** — Documentation popups for shapes, keywords, and themes
- **Go-to-definition** — Ctrl+Click on node references to jump to their declaration
- **Document outline** — See nodes, edges, and groups in the outline view
- **Error diagnostics** — Real-time error underlining as you type

### Preview
- **Toggle view** — `Ctrl+Shift+V` switches between code and rendered diagram
- **Side-by-side** — `Ctrl+K V` opens preview next to the editor
- **Interactive editor** — Custom editor for `.sld` files with code | preview split

### Interactive Editing
In the interactive editor for `.sld` files:
- **Zoom/Pan** — Scroll to zoom, Shift+Click+drag to pan
- **Drag & Drop** — Click and drag nodes to reposition
- **Inline editing** — Double-click labels to edit them directly
- **Context menus** — Right-click for Edit Label, Add Node, Delete, and more
- **Undo/Redo** — Ctrl+Z / Ctrl+Shift+Z for visual edits

### Markdown Integration
- **Fenced blocks** — Use ` ```seldia ` in `.md` files for auto-rendered diagrams
- **CodeLens** — "View Diagram" / "Edit Code" actions above each block
- **Type inference** — ` ```seldia-flowchart ` infers the diagram type
- **Read-only preview** — Blocks are laid out automatically; zoom, view the DSL,
  and export. To change a diagram, edit the fence in the file ("Open in editor"
  on a block jumps straight to it).

### Export
- **Export Diagram** — Save as SVG/PNG/PDF
- **Export Markdown to PDF** — Full MD→PDF pipeline with rendered diagrams

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `SelDiA: Toggle Code / Diagram View` | `Ctrl+Shift+V` | Toggle view mode |
| `SelDiA: Open Preview to the Side` | `Ctrl+K V` | Open preview panel |
| `SelDiA: Open Interactive Diagram` | — | Open interactive editor |
| `SelDiA: Insert Diagram Block` | `Ctrl+Shift+I` | Insert ` ```seldia ` block |
| `SelDiA: Export Diagram` | — | Export to SVG/PNG/PDF |
| `SelDiA: Export Markdown to PDF` | — | Export Markdown to PDF |
| `SelDiA: Deploy Copilot Skill` | — | Deploy DSL skill for Copilot |
