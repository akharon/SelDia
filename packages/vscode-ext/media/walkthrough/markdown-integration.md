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
- **Auto-render** — Diagrams render automatically when you open the file
- **CodeLens** — Click "View Diagram" above each block to open it in preview
- **Type inference** — Use ` ```seldia-flowchart ` to specify the type
- **Fallback detection** — Diagram blocks with `// seldia` as the first line are also detected
