## Export to PDF

Convert any Markdown file containing SelDiA diagrams into a professional PDF document.

### How to export:
1. Open a `.md` file with SelDiA diagram blocks
2. Run **`SelDiA: Export Markdown to PDF`** from the command palette
3. The PDF is generated with:
   - Rendered SelDiA diagrams as inline SVGs
   - Print-optimized CSS (page breaks, margins, fonts)
   - Optional Table of Contents (if 3+ diagrams detected)
   - Page numbers and document metadata

### Requirements:
- Puppeteer must be installed: `npm install puppeteer`
- PDFs are A4 format by default with `sketchy-light` theme
