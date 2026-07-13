// =============================================================================
// SelDiA — MD→PDF Puppeteer Renderer
// =============================================================================
// Wraps Puppeteer (headless Chrome) for HTML → PDF conversion.

export interface PdfRendererOptions {
  format?: string;
  orientation?: 'portrait' | 'landscape';
  scale?: number;
  printBackground?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  headerTemplate?: string;
  footerTemplate?: string;
  timeout?: number;
  showPageNumbers?: boolean;
}

export interface PdfRendererResult {
  success: boolean;
  outputPath?: string;
  pageCount?: number;
  errorMessage?: string;
}

/**
 * Render an HTML string to PDF using Puppeteer.
 */
export async function renderPdf(
  html: string,
  outputPath: string,
  options: PdfRendererOptions = {}
): Promise<PdfRendererResult> {
  try {
    let puppeteer: any;
    try {
      puppeteer = await import('puppeteer');
    } catch {
      return {
        success: false,
        outputPath: '',
        errorMessage: 'Puppeteer is not installed. Run: npm install puppeteer',
      };
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: options.timeout || 60000,
      });

      await page.pdf({
        path: outputPath,
        format: options.format || 'A4',
        landscape: options.orientation === 'landscape',
        scale: options.scale || 1,
        printBackground: options.printBackground !== false,
        margin: {
          top: options.margin?.top || '25mm',
          right: options.margin?.right || '20mm',
          bottom: options.margin?.bottom || '30mm',
          left: options.margin?.left || '20mm',
        },
        displayHeaderFooter: true,
        headerTemplate: options.headerTemplate || '<div style="font-size:8pt;color:#94a3b8;padding:0 20mm;width:100%;text-align:center;"><span class="title"></span></div>',
        footerTemplate: options.footerTemplate !== undefined
          ? options.footerTemplate
          : '<div style="font-size:8pt;color:#94a3b8;padding:0 20mm;width:100%;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        preferCSSPageSize: true,
      });

      await browser.close();

      return { success: true, outputPath, pageCount: undefined };
    } catch (err) {
      await browser.close();
      throw err;
    }
  } catch (err: any) {
    return {
      success: false,
      outputPath: '',
      errorMessage: `PDF generation failed: ${err.message}`,
    };
  }
}
