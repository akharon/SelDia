## Use Diagrams in Markdown

SelDiA diagrams work inside any Markdown file (`.md`, `.mdx`).

Simply wrap your DSL in a ` ```seldia ` fenced code block:

````markdown
# My Architecture

Here is the system context:

```seldia
diagram c4 context "My System" {
    person user: "User"
    system app: "My App"
    user --> app: "Uses"
}
```

The diagram above is automatically rendered inline.
````

### Features:
- **Built-in Markdown Preview** — Diagrams render directly inside VS Code's native Markdown preview
- **CodeLens** — Click "Preview Diagram" above each block to open the Markdown preview
- **Zoom & Pan** — Hover over a diagram and use the toolbar buttons to zoom and pan
- **Export** — Click the 📥 Export button to download any diagram as SVG
- **Type inference** — Use ` ```seldia-flowchart ` to specify the type
- **Fallback detection** — Diagram blocks with `// seldia` as the first line are also detected
