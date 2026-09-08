// =============================================================================
// SelDiA — Puppeteer browser acquisition
// =============================================================================
// Both PDF export (md2pdf/pdf-renderer.ts) and PPTX export (marp/pptx.ts) need
// a headless Chrome. Vendoring puppeteer's JS into dist/node_modules is not
// enough on its own: puppeteer resolves the actual browser binary from a
// user-level cache directory (~/.cache/puppeteer by default) that is populated
// by its postinstall script — and `vsce package --no-dependencies` never runs
// postinstall for the packaged extension. So on a fresh install the module
// imports fine and `launch()` then fails with "Could not find Chrome".
//
// This module centralises both steps: resolve puppeteer, and make sure a
// browser exists, downloading one on first use if it doesn't.
// =============================================================================

export interface BrowserAcquisition {
  /** The resolved puppeteer module namespace. */
  puppeteer: any;
  /** Explicit binary path when we resolved one ourselves; else undefined. */
  executablePath?: string;
}

/** Progress reporting so a multi-minute first-run download isn't silent. */
export type ProgressReporter = (message: string) => void;

/**
 * `import('puppeteer')` fails hard when the package is missing. Keep the
 * message actionable — this is the single place that knows why it can be
 * absent (a packaging miss, since it is a declared dependency).
 */
async function loadPuppeteer(): Promise<any> {
  try {
    return await import('puppeteer');
  } catch (err: any) {
    throw new Error(
      'Puppeteer is not available. The extension package may be incomplete; ' +
        'reinstall SelDiA, or run "npm install puppeteer" in a development checkout. ' +
        `(${err?.message || String(err)})`
    );
  }
}

/**
 * Return true when puppeteer can already point at an installed browser.
 * `executablePath()` throws (rather than returning empty) when the configured
 * build is absent from the cache, so the throw is the signal, not an error.
 */
function hasInstalledBrowser(puppeteer: any): boolean {
  try {
    const path = puppeteer.executablePath();
    if (!path) return false;
    // executablePath() reports the *expected* location even when nothing has
    // been downloaded there yet, so the existence check is the real test.
    // Imported lazily to keep this module cheap for the common case.
    const { existsSync } = require('fs') as typeof import('fs');
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Download the browser build puppeteer expects into its normal cache dir.
 * Uses @puppeteer/browsers, which ships as part of puppeteer's own dependency
 * closure, so this adds nothing to what we already vendor.
 */
async function downloadBrowser(puppeteer: any, onProgress?: ProgressReporter): Promise<string> {
  const browsers: any = await import('@puppeteer/browsers');

  // PUPPETEER_CACHE_DIR is the documented override; fall back to the same
  // default puppeteer itself uses so a later launch() finds what we install.
  const cacheDir =
    process.env.PUPPETEER_CACHE_DIR ||
    puppeteer.configuration?.cacheDirectory ||
    require('path').join(require('os').homedir(), '.cache', 'puppeteer');

  const browser = browsers.Browser.CHROME;
  const buildId =
    puppeteer.configuration?.chrome?.version ||
    (await browsers.resolveBuildId(browser, browsers.detectBrowserPlatform(), 'stable'));

  onProgress?.(`Downloading Chrome ${buildId} (one-time, ~150 MB)…`);

  let lastPercent = -1;
  const installed = await browsers.install({
    browser,
    buildId,
    cacheDir,
    downloadProgressCallback: (downloaded: number, total: number) => {
      if (!total) return;
      const percent = Math.floor((downloaded / total) * 100);
      // Report every 10% rather than every chunk, to avoid flooding the UI.
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        onProgress?.(`Downloading Chrome ${buildId}… ${percent}%`);
      }
    },
  });

  return installed.executablePath;
}

/**
 * Resolve puppeteer and guarantee a usable browser, downloading one on first
 * use. Callers pass the result straight into `puppeteer.launch()`.
 */
export async function ensureBrowser(onProgress?: ProgressReporter): Promise<BrowserAcquisition> {
  const puppeteer = await loadPuppeteer();

  if (hasInstalledBrowser(puppeteer)) {
    return { puppeteer };
  }

  try {
    const executablePath = await downloadBrowser(puppeteer, onProgress);
    return { puppeteer, executablePath };
  } catch (err: any) {
    throw new Error(
      'Could not find or download a Chrome browser for export. ' +
        'Install one manually with "npx puppeteer browsers install chrome", ' +
        'or set PUPPETEER_EXECUTABLE_PATH to an existing Chrome/Chromium binary. ' +
        `(${err?.message || String(err)})`
    );
  }
}

/**
 * Launch options shared by every export path. An explicit executablePath is
 * only set when we downloaded the binary ourselves this run.
 */
export function launchOptions(acquired: BrowserAcquisition): Record<string, unknown> {
  const options: Record<string, unknown> = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  const override = process.env.PUPPETEER_EXECUTABLE_PATH || acquired.executablePath;
  if (override) options.executablePath = override;
  return options;
}
