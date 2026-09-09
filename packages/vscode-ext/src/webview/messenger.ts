// =============================================================================
// SelDiA — Webview ↔ Extension Message Bridge
// =============================================================================
// Type-safe postMessage communication between the VS Code extension host
// and the interactive diagram webview.

import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
} from '../types.js';

export class WebviewMessenger {
  private _onMessage: ((msg: WebviewToExtMessage) => void) | null = null;
  private _webview: { postMessage(message: ExtToWebviewMessage): void } | null = null;

  /**
   * Connect to a webview for sending messages.
   */
  connect(webview: { postMessage(msg: ExtToWebviewMessage): Thenable<boolean> }): void {
    this._webview = webview;
  }

  /**
   * Disconnect from the webview.
   */
  disconnect(): void {
    this._webview = null;
    this._onMessage = null;
  }

  /**
   * Register a handler for incoming messages from the webview.
   */
  onMessage(handler: (msg: WebviewToExtMessage) => void): void {
    this._onMessage = handler;
  }

  /**
   * Handle a raw message from the webview (called by the VS Code message event).
   */
  handleRawMessage(raw: any): void {
    if (this._onMessage && raw && raw.type) {
      this._onMessage(raw as WebviewToExtMessage);
    }
  }

  // ── Sending messages to webview ────────────────────────────────────────

  sendRender(
    ir: any,
    theme: string,
    interactive: boolean,
    viewMode?: any,
    zoom?: number
  ): void {
    this.post({ type: 'render', ir, theme, interactive, viewMode, zoom });
  }

  sendUpdateTheme(theme: string): void {
    this.post({ type: 'updateTheme', theme });
  }

  sendUpdateZoom(scale: number): void {
    this.post({ type: 'updateZoom', scale });
  }

  sendSelectNode(nodeId: string): void {
    this.post({ type: 'selectNode', nodeId });
  }

  sendHighlightError(nodeId: string, message: string, severity: 'error' | 'warning'): void {
    this.post({ type: 'highlightError', nodeId, message, severity });
  }

  sendSetEditMode(mode: string): void {
    this.post({ type: 'setEditMode', mode } as any);
  }

  sendSyncUndoRedo(canUndo: boolean, canRedo: boolean): void {
    this.post({ type: 'syncUndoRedo', canUndo, canRedo });
  }

  sendSyncDirty(dirty: boolean): void {
    this.post({ type: 'syncDirty', dirty });
  }

  private post(msg: ExtToWebviewMessage): void {
    if (this._webview) {
      this._webview.postMessage(msg);
    }
  }
}
