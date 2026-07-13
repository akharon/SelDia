// =============================================================================
// SelDiA — MD→PDF Progress Reporter
// =============================================================================
// Provides VS Code progress notification integration for the MD→PDF pipeline.

import * as vscode from 'vscode';

export interface ProgressInfo {
  /** Current stage description */
  stage: string;
  /** Progress percentage (0-100) */
  percentage: number;
  /** Optional detail message */
  detail?: string;
}

export type ProgressCallback = (info: ProgressInfo) => void;

/**
 * Create a VS Code progress reporter for the MD→PDF pipeline.
 * Shows a progress notification with cancellable option.
 */
export function createProgressReporter(): {
  report: ProgressCallback;
  token: vscode.CancellationTokenSource;
} {
  const tokenSource = new vscode.CancellationTokenSource();

  const report: ProgressCallback = (info: ProgressInfo) => {
    // Progress is shown via vscode.window.withProgress, but we can also
    // update the status bar for incremental feedback
    vscode.window.setStatusBarMessage(
      `$(file-pdf) SelDiA MD→PDF: ${info.stage}${info.detail ? ` — ${info.detail}` : ''}`,
      5000
    );
  };

  return { report, token: tokenSource };
}

/**
 * Show a full progress dialog for the export operation.
 */
export async function showExportProgress<T>(
  title: string,
  task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Thenable<T>
): Promise<T | undefined> {
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      task
    );
  } catch {
    return undefined;
  }
}
