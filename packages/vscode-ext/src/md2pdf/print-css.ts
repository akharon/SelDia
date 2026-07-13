// =============================================================================
// SelDiA — MD→PDF Print Stylesheet
// =============================================================================
// Default print-optimized CSS for the MD→PDF export pipeline.

export const PRINT_CSS = `
/* Page setup */
@page {
    size: A4;
    margin: 25mm 20mm 30mm 20mm;
    @bottom-center {
        content: counter(page);
        font-family: 'Inter', -apple-system, sans-serif;
        font-size: 10pt;
        color: #666;
    }
}

/* Base typography */
body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1e293b;
    max-width: 100%;
}

h1 { font-size: 24pt; margin-top: 30px; margin-bottom: 12px; page-break-before: auto; }
h2 { font-size: 18pt; margin-top: 24px; margin-bottom: 10px; }
h3 { font-size: 14pt; margin-top: 18px; margin-bottom: 8px; }
h4 { font-size: 12pt; margin-top: 14px; margin-bottom: 6px; }

p { margin-bottom: 8px; }
ul, ol { margin-bottom: 8px; padding-left: 24px; }
li { margin-bottom: 4px; }

code {
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 9pt;
    background: #f1f5f9;
    padding: 2px 4px;
    border-radius: 3px;
}

pre {
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 8.5pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 12px;
    overflow-x: auto;
    white-space: pre-wrap;
    break-inside: avoid;
    page-break-inside: avoid;
}

pre code {
    background: none;
    padding: 0;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 10pt;
    break-inside: avoid;
    page-break-inside: avoid;
}

th, td {
    border: 1px solid #e2e8f0;
    padding: 8px 12px;
    text-align: left;
}

th {
    background: #f8fafc;
    font-weight: 600;
}

blockquote {
    border-left: 4px solid #3b82f6;
    padding: 8px 16px;
    margin: 12px 0;
    background: #f8fafc;
    color: #475569;
}

img {
    max-width: 100%;
    height: auto;
}

/* Diagram containers */
.seldia-diagram {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 24px 0;
    padding: 16px;
    background: #fafaf9;
    border: 1px solid #e7e5e4;
    border-radius: 6px;
    text-align: center;
}

.seldia-diagram svg {
    max-width: 100%;
    height: auto;
}

.seldia-diagram__header {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 11pt;
    font-weight: 600;
    color: #44403c;
    margin-bottom: 8px;
    text-align: left;
    border-bottom: 1px solid #e7e5e4;
    padding-bottom: 6px;
}

.seldia-diagram__caption {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 9pt;
    color: #78716c;
    margin-top: 8px;
    font-style: italic;
}

.seldia-diagram__type-badge {
    display: inline-block;
    font-size: 8pt;
    font-weight: 500;
    color: #fff;
    background: #0e639c;
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: 8px;
}

/* Error box */
.seldia-diagram--error {
    background: #fef2f2;
    border-color: #fca5a5;
    color: #991b1b;
    padding: 16px;
    font-family: monospace;
    white-space: pre-wrap;
    font-size: 9pt;
}

.seldia-diagram--error .error-title {
    font-weight: 600;
    font-size: 10pt;
    margin-bottom: 4px;
}

/* Table of Contents */
.seldia-toc {
    break-after: page;
    page-break-after: always;
    margin-bottom: 30px;
}

.seldia-toc h1 {
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 8px;
}

.seldia-toc ul {
    list-style: none;
    padding: 0;
    margin-top: 16px;
}

.seldia-toc li {
    padding: 6px 0;
    border-bottom: 1px dotted #e2e8f0;
    font-size: 11pt;
}

.seldia-toc li a {
    color: #0e639c;
    text-decoration: none;
}

.seldia-toc .toc-h2 { padding-left: 24px; font-size: 10pt; }
.seldia-toc .toc-h3 { padding-left: 48px; font-size: 9.5pt; }

/* Print-specific */
@media print {
    a { color: inherit; text-decoration: none; }
    .no-print { display: none; }
}
`;
