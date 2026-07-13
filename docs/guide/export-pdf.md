# Export & PDF

SelDiA can export diagrams as SVG or full Markdown documents as PDF.

## Export a Single Diagram

### CLI

```bash
seldia compile diagram.sld -o diagram.svg
seldia compile diagram.sld -o diagram.png --scale 2
seldia compile diagram.sld -o diagram.html --interactive
```

### VS Code

Run **`SelDiA: Export Diagram`** from the command palette, or use the export button in the preview toolbar.

## MD → PDF Export

Convert Markdown files containing SelDiA diagrams to professional PDF documents.

### VS Code

1. Open a `.md` file with ` ```seldia ` blocks
2. Run **`SelDiA: Export Markdown to PDF`** from the command palette
3. The PDF is generated with rendered diagrams, print CSS, and optional TOC

### Pipeline

```
Markdown Source
    ↓ Parse via `marked`
    ↓ Detect ```seldia blocks
    ↓ Compile each block → SVG
    ↓ Inject SVGs into HTML
    ↓ Assemble with print CSS
    ↓ Render via Puppeteer
    ↓ PDF output
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| Format | A4 | Page format (A4, Letter, etc.) |
| Orientation | portrait | Page orientation |
| Theme | sketchy-light | Diagram rendering theme |
| TOC | Auto (3+ diagrams) | Table of Contents |
| Page numbers | Yes | Footer page count |
| Scale | 1.0 | PDF scale factor |

### Requirements

Puppeteer must be installed for PDF generation:

```bash
npm install puppeteer
```
