// =============================================================================
// SelDiA VS Code Extension — Markdown → PDF Export Types
// =============================================================================

import type { ID, Diagnostic } from '@seldia/core/types/common';

// -----------------------------------------------------------------------------
// MD-to-PDF Options
// -----------------------------------------------------------------------------

export interface Md2PdfOptions {
  /** Input Markdown file path (absolute) */
  inputPath: string;

  /** Output PDF file path (absolute). Default: same as input, .pdf extension */
  outputPath?: string;

  /** PDF page format */
  format?: PageFormat;

  /** Page orientation */
  orientation?: 'portrait' | 'landscape';

  /** Additional CSS to inject into the HTML before printing */
  customCss?: string;

  /** Whether to automatically generate a Table of Contents */
  generateToc?: boolean;

  /** Minimum number of diagrams to trigger TOC generation. Default: 3 */
  tocMinDiagrams?: number;

  /** Whether to show page numbers in the footer */
  showPageNumbers?: boolean;

  /** Header template (HTML string). Supports placeholders:
   *  <span class="title"></span> — document title
   *  <span class="date"></span> — current date */
  headerTemplate?: string;

  /** Footer template (HTML string). Same placeholders as headerTemplate.
   *  Default: '<span class="pageNumber"></span> / <span class="totalPages"></span>' */
  footerTemplate?: string;

  /** PDF scale factor (0.1–2.0). Default: 1 */
  scale?: number;

  /** Whether to print CSS backgrounds (gradients, colors). Default: true */
  printBackground?: boolean;

  /** Page margins in CSS units */
  margin?: PdfMargin;

  /** Theme ID for SelDiA diagram rendering. Default: 'sketchy-light' */
  theme?: string;

  /** Whether to render diagrams with Rough.js sketchy style. Default: true */
  sketchy?: boolean;

  /** Timeout for Puppeteer PDF generation in milliseconds. Default: 60_000 */
  timeout?: number;

  /** Document metadata for PDF properties */
  metadata?: PdfMetadata;

  /** Whether to show a VS Code progress notification. Default: true */
  showProgress?: boolean;

  /** Whether to open the PDF after generation. Default: true */
  openAfterExport?: boolean;
}

export type PageFormat =
  | 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6'
  | 'Letter' | 'Legal' | 'Tabloid' | 'Ledger';

export interface PdfMargin {
  top?: string;     // e.g. '25mm', '1in', '72px'
  right?: string;
  bottom?: string;
  left?: string;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;   // Default: 'SelDiA'
  producer?: string;  // Default: 'SelDiA MD-to-PDF'
}

// -----------------------------------------------------------------------------
// MD-to-PDF Result
// -----------------------------------------------------------------------------

export interface Md2PdfResult {
  /** Whether the export succeeded */
  success: boolean;

  /** Output PDF file path */
  outputPath?: string;

  /** File size in bytes */
  fileSize?: number;

  /** Number of pages generated */
  pageCount?: number;

  /** Number of SelDiA diagrams found and rendered */
  diagramCount: number;

  /** Diagrams that failed to render (with their error details) */
  failedDiagrams: FailedDiagram[];

  /** Total processing time in milliseconds */
  durationMs: number;

  /** Errors (if success = false) */
  errors?: Md2PdfError[];
}

export interface FailedDiagram {
  /** Diagram block ID */
  blockId: string;

  /** Line number in the source Markdown */
  line: number;

  /** Diagram title (if parsed) */
  title?: string;

  /** Error message */
  error: string;
}

export interface Md2PdfError {
  phase: 'parse' | 'compile' | 'assemble' | 'render' | 'write';
  message: string;
  detail?: string;
}

// -----------------------------------------------------------------------------
// Markdown HTML Assembly Types
// -----------------------------------------------------------------------------

export interface AssembledHtml {
  /** The complete HTML document as a string */
  html: string;

  /** Number of SelDiA diagrams injected */
  diagramCount: number;

  /** List of diagram block IDs and their status */
  diagramStatuses: DiagramStatus[];

  /** The extracted document title (from first <h1>) */
  title?: string;

  /** Table of Contents HTML (if generated) */
  tocHtml?: string;
}

export interface DiagramStatus {
  blockId: ID;
  line: number;
  title?: string;
  status: 'rendered' | 'error' | 'skipped';
  errorMessage?: string;
  svgSize?: { width: number; height: number };
}

// -----------------------------------------------------------------------------
// Markdown Parser (marked) Types
// -----------------------------------------------------------------------------

export interface MarkdownParserConfig {
  /** Whether to enable GFM (GitHub Flavored Markdown). Default: true */
  gfm: boolean;

  /** Whether to enable line breaks without trailing spaces. Default: true */
  breaks: boolean;

  /** Whether to auto-link URLs. Default: true */
  gfmAutoLink: boolean;

  /** Custom CSS class prefix for SelDiA diagram wrappers */
  diagramWrapperClass: string;

  /** Custom CSS class for diagram error boxes */
  diagramErrorClass: string;
}

export interface SelDiADiagramBlock {
  /** Unique block ID */
  blockId: ID;

  /** The raw DSL source */
  dslSource: string;

  /** The diagram type */
  diagramType: string;

  /** The diagram title */
  title?: string;

  /** Start line in the original Markdown */
  startLine: number;

  /** End line in the original Markdown */
  endLine: number;
}

// -----------------------------------------------------------------------------
// Puppeteer PDF Renderer Types
// -----------------------------------------------------------------------------

export interface PuppeteerPdfConfig {
  /** Path to Chromium executable. Auto-detected if not set */
  executablePath?: string;

  /** Additional Chromium launch args */
  launchArgs?: string[];

  /** Whether to run in headless mode. Default: true (always for PDF) */
  headless: boolean;

  /** Viewport width for rendering. Default: 1200 */
  viewportWidth: number;

  /** Viewport height. Default: 800 */
  viewportHeight: number;

  /** Device scale factor. Default: 2 (for crisp SVG rendering) */
  deviceScaleFactor: number;

  /** Whether to wait for network idle before printing. Default: true */
  waitForNetworkIdle: boolean;

  /** Network idle timeout in ms. Default: 5000 */
  networkIdleTimeout: number;
}

// -----------------------------------------------------------------------------
// MD-to-PDF Pipeline Interface
// -----------------------------------------------------------------------------

export interface Md2PdfPipeline {
  /**
   * Execute the full Markdown → PDF pipeline.
   *
   * Pipeline stages:
   * 1. Read Markdown file
   * 2. Detect ```seldia blocks
   * 3. Compile each block to SVG
   * 4. Parse Markdown → HTML with custom marked renderer
   * 5. Inject compiled SVGs into HTML
   * 6. (Opt) Generate Table of Contents
   * 7. Launch Puppeteer, set HTML content
   * 8. Generate PDF
   * 9. Write PDF to disk
   *
   * @param options - Export options
   * @param onProgress - Optional progress callback
   * @returns Export result
   */
  execute(
    options: Md2PdfOptions,
    onProgress?: (progress: PipelineProgress) => void
  ): Promise<Md2PdfResult>;
}

export interface PipelineProgress {
  /** Current pipeline phase */
  phase: PipelinePhase;

  /** Progress percentage (0–100) */
  percentage: number;

  /** Human-readable status message */
  message: string;
}

export type PipelinePhase =
  | 'reading'
  | 'detecting'
  | 'compiling'
  | 'parsing-markdown'
  | 'assembling-html'
  | 'generating-toc'
  | 'launching-browser'
  | 'rendering-pdf'
  | 'writing-file'
  | 'done';

// -----------------------------------------------------------------------------
// Default Configuration
// -----------------------------------------------------------------------------

export const DEFAULT_MD2PDF_OPTIONS: Required<Omit<Md2PdfOptions, 'inputPath' | 'outputPath' | 'customCss' | 'headerTemplate' | 'footerTemplate' | 'metadata'>> = {
  format: 'A4',
  orientation: 'portrait',
  generateToc: false,
  tocMinDiagrams: 3,
  showPageNumbers: true,
  scale: 1,
  printBackground: true,
  theme: 'sketchy-light',
  sketchy: true,
  timeout: 60_000,
  showProgress: true,
  openAfterExport: true,
  margin: {
    top: '25mm',
    right: '20mm',
    bottom: '30mm',
    left: '20mm',
  },
};

export const DEFAULT_PUPPETEER_CONFIG: PuppeteerPdfConfig = {
  headless: true,
  viewportWidth: 1200,
  viewportHeight: 800,
  deviceScaleFactor: 2,
  waitForNetworkIdle: true,
  networkIdleTimeout: 5000,
};

export const DEFAULT_MARKDOWN_PARSER_CONFIG: MarkdownParserConfig = {
  gfm: true,
  breaks: true,
  gfmAutoLink: true,
  diagramWrapperClass: 'seldia-diagram',
  diagramErrorClass: 'seldia-diagram--error',
};
