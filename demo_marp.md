---
marp: true
theme: default
paginate: true
---

# SelDiA + Marp

Slide decks written in Markdown, with SelDiA diagrams rendered inline.

Open this file and run **SelDiA: Open Marp Slide Preview** from the CodeLens
above, or the command palette.

---

## Architecture at a glance

```seldia
diagram flowchart "Request Flow" {
  client: (Client)
  gateway: [API Gateway]
  service: [Order Service]
  db: [(Database)]
  client --> gateway --> service --> db
}
```

---

## Why this works

- One `.md` file: slides + diagrams, no separate diagramming tool
- `marp: true` front-matter opts a file into slide mode
- Every fence SelDiA already understands — `seldia`, `mermaid`, `plantuml` —
  renders the same way inside a slide as it does in the regular preview
- Export straight to PDF or HTML with **SelDiA: Export Marp Deck**

---

# Thanks!
