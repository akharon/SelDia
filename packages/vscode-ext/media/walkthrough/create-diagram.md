## Create a .sld File

Create a new file with the `.sld` extension (e.g., `diagram.sld`) and start typing SelDiA DSL code.

### Features you'll get:
- **Syntax highlighting** — Nodes, edges, keywords, and shapes are color-coded
- **Autocomplete** — Press `Ctrl+Space` to see suggestions for diagram types, shapes, themes, and node IDs
- **Hover info** — Hover over keywords to see documentation
- **Error diagnostics** — Parse errors are underlined in real-time
- **Outline view** — See all nodes, edges, and groups in the document outline

### Quick start:
```
diagram flowchart "Hello World" {
    start: (Start)
    hello: [Hello]
    world: (World)

    start --> hello --> world
}
```
