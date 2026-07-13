# SelDiA for VS Code

**Self-Diagramming Architecture** — A unified Diagram-as-Code extension with hand-drawn Rough.js aesthetics.

Create 21+ diagram types using a single, clean DSL directly in VS Code. Preview, edit, and export your diagrams — all without leaving the editor.

## Features

### 🎨 21+ Diagram Types
Flowchart, Sequence, Class, C4 Context, C4 Container, BPMN, State, ER, Gantt, Mindmap, Component, Deployment, Network, Use Case, Activity, Chart (Bar/Line/Pie/Radar/Scatter), Sankey, Timeline, Git Graph, Form, Block — all in one unified DSL.

### ✏️ Interactive Editing
- **Drag & drop** nodes to reposition
- **Double-click** inline label editing
- **Zoom & pan** with scroll wheel and Shift+drag
- **Right-click** context menus for add/delete/edit
- **Undo/redo** (Ctrl+Z/Y) for visual edits
- **Collapse/expand** groups and C4 containers

### 📝 Rich Language Support
- **Syntax highlighting** — Full TextMate grammar for `.sld` files
- **LSP diagnostics** — Real-time error checking as you type
- **Autocomplete** — Keywords, diagram types, shapes, themes, edge types
- **Hover documentation** — DSL syntax reference on hover
- **Go to definition** — Navigate from node references to declarations
- **Document symbols** — Outline view of nodes, edges, and groups
- **Code snippets** — 16+ snippets for all diagram types

### 🔗 Markdown Integration
Embed SelDiA diagrams in any Markdown file:

````markdown
```seldia
diagram flowchart "My Flow" {
    start: (Start) --> process: [Process] --> end: (End)
}
```
````

- Auto-detects ` ```seldia ` fenced code blocks
- Inline SVG rendering in the editor
- CodeLens actions: "View Diagram", "Edit Code"
- Dedicated Markdown preview panel

### 🔄 Bidirectional Sync
Edit diagrams visually OR in code — changes sync both ways automatically. The source map preserves formatting, comments, and whitespace.

### 📄 PDF Export
Convert any Markdown file with embedded SelDiA diagrams to a professional PDF:
- Custom `marked` renderer compiles DSL → SVG
- Print-optimized CSS with page breaks
- Auto-generated Table of Contents
- Error fallback rendering for broken diagrams

### 🤖 GitHub Copilot Integration
Deploy the SelDiA DSL Copilot skill so GitHub Copilot can generate, modify, and explain SelDiA diagrams. Run **"SelDiA: Deploy Copilot Skill"** from the command palette.

## Getting Started

1. Create a new file with the `.sld` extension
2. Start typing — autocomplete and diagnostics kick in
3. Press `Ctrl+Shift+V` to preview the rendered diagram
4. Use `Ctrl+K V` for a side-by-side code/preview view

### Quick Examples

```seldia
diagram flowchart "Hello World" {
    start: (Start)
    end: (End)
    start --> end
}
```

```seldia
diagram sequence "API Call" {
    actor: (Client)
    participant: [Server]
    participant: [Database]
    Client -> Server: POST /data
    Server -> Database: INSERT
    Database --> Server: OK
    Server --> Client: 201 Created
}
```

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| SelDiA: Toggle Code / Diagram View | `Ctrl+Shift+V` | Toggle between code and diagram |
| SelDiA: Open Preview to the Side | `Ctrl+K V` | Open preview side-by-side |
| SelDiA: Insert Diagram Block | `Ctrl+Shift+I` | Insert a SelDiA fenced block in Markdown |
| SelDiA: Export Diagram | — | Export current diagram as SVG/PNG/PDF |
| SelDiA: Export Markdown to PDF | — | Convert Markdown with diagrams to PDF |
| SelDiA: Deploy Copilot Skill | — | Deploy Copilot DSL skill |
| SelDiA: Check Skill Status | — | Check Copilot skill deployment status |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `seldia.defaultTheme` | `sketchy-light` | Default theme for rendered diagrams |
| `seldia.markdown.enabled` | `true` | Enable diagram detection in Markdown |
| `seldia.copilotSkill.enabled` | `true` | Enable Copilot skill deployment |
| `seldia.interactive.enabled` | `true` | Enable interactive editing |
| `seldia.interactive.undoStackSize` | `50` | Maximum undo steps for visual edits |
| `seldia.export.defaultFormat` | `svg` | Default export format |

## Requirements

- VS Code 1.96.0 or later
- Node.js 22.x (for PDF export via Puppeteer — optional)

## Extension Pack

This extension is part of the SelDiA ecosystem. Related packages:

- [`@seldia/core`](https://www.npmjs.com/package/@seldia/core) — Parser, engine, types
- [`@seldia/cli`](https://www.npmjs.com/package/@seldia/cli) — CLI tools
- [`@seldia/render`](https://www.npmjs.com/package/@seldia/render) — SVG rendering engine
- [`@seldia/layout`](https://www.npmjs.com/package/@seldia/layout) — Layout algorithms
- [`@seldia/interaction`](https://www.npmjs.com/package/@seldia/interaction) — Interactive editing primitives
- [`@seldia/web`](https://www.npmjs.com/package/@seldia/web) — Web components

## Known Issues

- PDF export requires Puppeteer (installed on first use)
- Large diagrams (>200 nodes) may experience performance degradation
- Markdown injection grammar for syntax highlighting inside fenced blocks is pending

---

**Enjoying SelDiA?** Leave a review on the VS Code Marketplace! 🎉
