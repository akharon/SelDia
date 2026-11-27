// =============================================================================
// SelDiA — Markdown Visual Editor (CustomTextEditorProvider)
// =============================================================================
// Shows a .md file as a column of blocks (rendered prose + rendered diagrams).
// The TextDocument is the only source of truth: every webview edit is turned
// into a minimal line-range WorkspaceEdit, so save / undo / dirty state are
// VS Code's own. See md-editor/segments.ts for the block model.
// =============================================================================

import * as vscode from 'vscode';
import { Marked } from 'marked';
import type { CoreEngine } from '@seldia/core';
import { renderSelDiABlock, renderMermaidBlock, renderPlantUmlBlock } from '../markdown-preview/plugin.js';
import { nextDiagramNumber } from '../markdown-preview/numbering.js';
import { ICON_SPRITE } from '../shared/icons.js';
import { SerialQueue } from '../edit/serial-queue.js';
import { EDIT_URI_ACTIONS } from '../edit/commands.js';
import {
  splitMarkdown, collectLinkDefinitions, segmentKeys, replaceLines, insertBlock,
  minimalLineEdit, rewriteImageSrcs, splitLines, INSERT_SNIPPETS, type MdSegment,
} from './segments.js';

export const MD_EDITOR_VIEW_TYPE = 'seldia.markdownEditor';

const CACHE_LIMIT = 200;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function isMarkdownEditorEnabled(): boolean {
  return vscode.workspace.getConfiguration('seldia').get<boolean>('markdownEditor.enabled', false);
}

/** Tell the user the editor is off; offer to enable it. Resolves true if enabled. */
export async function promptEnableMarkdownEditor(): Promise<boolean> {
  const pick = await vscode.window.showInformationMessage(
    'The SelDiA Markdown Visual Editor is disabled (setting "seldia.markdownEditor.enabled").',
    'Enable'
  );
  if (pick !== 'Enable') return false;
  await vscode.workspace.getConfiguration('seldia').update('markdownEditor.enabled', true, vscode.ConfigurationTarget.Global);
  return true;
}

export class MarkdownVisualEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly marked = new Marked({ gfm: true, breaks: false });
  private readonly diagramCache = new Map<string, string>();

  constructor(
    private readonly engine: CoreEngine,
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveCustomTextEditor(doc: vscode.TextDocument, panel: vscode.WebviewPanel, _token: vscode.CancellationToken): void {
    // Opt-in feature: when disabled (default), fall back to the text editor.
    // The customEditors contribution can't be gated by a `when`, so a
    // "Reopen Editor With" or editorAssociations entry still lands here.
    if (!isMarkdownEditorEnabled()) {
      panel.dispose();
      void vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default');
      void promptEnableMarkdownEditor().then((enabled) => {
        if (enabled) void vscode.commands.executeCommand('vscode.openWith', doc.uri, MD_EDITOR_VIEW_TYPE);
      });
      return;
    }
    const webview = panel.webview;
    const docDir = vscode.Uri.joinPath(doc.uri, '..');
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        folder ? folder.uri : docDir,
      ],
    };
    webview.html = this.shellHtml(webview);

    const queue = new SerialQueue();
    const post = (m: unknown) => { void webview.postMessage(m); };

    const render = () => {
      try {
        post(this.buildRenderMessage(doc, webview, docDir));
      } catch (err: any) {
        post({ type: 'notice', text: `Render failed: ${err?.message || err}` });
      }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== doc.uri.toString()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; render(); }, 150);
    });

    const applyText = async (newText: string): Promise<boolean> => {
      const oldText = doc.getText();
      if (newText === oldText) return true;
      const edit = minimalLineEdit(oldText, newText);
      const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      const lineCount = doc.lineCount;
      let range: vscode.Range;
      let text: string;
      if (edit.endLine < lineCount) {
        range = new vscode.Range(new vscode.Position(edit.startLine, 0), new vscode.Position(edit.endLine, 0));
        text = edit.lines.length ? edit.lines.join(eol) + eol : '';
      } else {
        const last = doc.lineAt(lineCount - 1);
        range = new vscode.Range(new vscode.Position(edit.startLine, 0), last.range.end);
        text = edit.lines.join(eol);
      }
      const we = new vscode.WorkspaceEdit();
      we.replace(doc.uri, range, text);
      return vscode.workspace.applyEdit(we);
    };

    const msgSub = webview.onDidReceiveMessage((msg: any) => {
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'ready':
          render();
          break;
        case 'editLines':
          void queue.run(async () => {
            const start = Number(msg.startLine);
            const end = Number(msg.endLine);
            const lines = splitLines(doc.getText());
            if (!(start >= 0 && end >= start && end <= lines.length) ||
                lines.slice(start, end).join('\n') !== String(msg.original ?? '')) {
              post({ type: 'notice', text: 'The document changed underneath this edit — it was not applied.' });
              render();
              return;
            }
            const text = String(msg.text ?? '');
            await applyText(replaceLines(doc.getText(), start, end, text === '' ? null : text));
          });
          break;
        case 'insert':
          void queue.run(async () => {
            const snippet = INSERT_SNIPPETS[String(msg.snippet)];
            if (!snippet) return;
            const r = insertBlock(doc.getText(), Number(msg.atLine) || 0, snippet);
            if (await applyText(r.text)) post({ type: 'focusLine', line: r.line });
          });
          break;
        case 'deepLink':
          this.handleDeepLink(String(msg.href ?? ''));
          break;
        case 'openVisual':
          void vscode.commands.executeCommand('seldia.editBlockVisually', { blockId: String(msg.blockId ?? ''), doc: doc.uri.toString() });
          break;
        case 'openLink':
          this.handleOpenLink(String(msg.href ?? ''), docDir);
          break;
      }
    });

    panel.onDidDispose(() => {
      if (timer) clearTimeout(timer);
      changeSub.dispose();
      msgSub.dispose();
    });
  }

  private handleDeepLink(href: string): void {
    let uri: vscode.Uri;
    try { uri = vscode.Uri.parse(href); } catch { return; }
    const action = uri.path.replace(/^\/+/, '');
    if (!EDIT_URI_ACTIONS.has(action)) return;
    const args: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(uri.query)) args[k] = v;
    void vscode.commands.executeCommand(`seldia.${action}`, args);
  }

  private handleOpenLink(href: string, docDir: vscode.Uri): void {
    if (/^(https?:|mailto:)/i.test(href)) {
      void vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    const rel = decodeURI(href.split('#')[0]);
    if (!rel) return;
    void vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(docDir, rel));
  }

  private buildRenderMessage(doc: vscode.TextDocument, webview: vscode.Webview, docDir: vscode.Uri) {
    const text = doc.getText();
    const segs = splitMarkdown(text);
    const keys = segmentKeys(segs);
    const linkDefs = collectLinkDefinitions(text);
    const env: any = { currentDocument: doc.uri.toString() };
    if (this.diagramCache.size > CACHE_LIMIT) this.diagramCache.clear();
    let ordinal = 0;
    const segments = segs.map((s, i) => {
      let html: string;
      try {
        if (s.kind === 'frontmatter') {
          html = `<details class="mde-frontmatter"><summary>Front matter</summary><pre>${escapeHtml(s.raw)}</pre></details>`;
        } else if (s.kind === 'diagram') {
          html = this.renderDiagram(s, ++ordinal, doc, env);
        } else {
          const md = linkDefs ? `${s.raw}\n\n${linkDefs}` : s.raw;
          const out = this.marked.parse(md, { async: false }) as string;
          html = rewriteImageSrcs(out, (src) => {
            try {
              const rel = decodeURI(src.split(/[?#]/)[0]);
              return webview.asWebviewUri(vscode.Uri.joinPath(docDir, rel)).toString();
            } catch { return undefined; }
          });
        }
      } catch (err: any) {
        html = `<div class="mde-error">Could not render this block: ${escapeHtml(err?.message || String(err))}</div>`;
      }
      return {
        key: keys[i], kind: s.kind, startLine: s.startLine, endLine: s.endLine, raw: s.raw, html,
        lang: s.lang, source: s.source, blockId: s.blockId, bodyStart: s.bodyStart, bodyEnd: s.bodyEnd,
      };
    });
    return { type: 'render', version: doc.version, segments };
  }

  private renderDiagram(s: MdSegment, n: number, doc: vscode.TextDocument, env: any): string {
    const lang = (s.lang ?? '').toLowerCase();
    const source = s.source ?? '';
    const captions = vscode.workspace.getConfiguration('seldia').get<boolean>('markdown.captions.enabled', true);
    const cacheKey = `${n}|${captions ? 1 : 0}|${lang}|${source}`;
    const cached = this.diagramCache.get(cacheKey);
    if (cached !== undefined) {
      nextDiagramNumber(env);
      return cached;
    }
    const docUri = doc.uri.toString();
    let html: string | null;
    if (lang.startsWith('seldia')) html = renderSelDiABlock(this.engine, source, docUri, false, env, captions);
    else if (lang === 'mermaid') html = renderMermaidBlock(this.engine, source, docUri, false, env, captions);
    else html = renderPlantUmlBlock(this.engine, source, docUri, false, env, captions);
    if (html === null) {
      html = `<pre class="mde-fallback"><code>${escapeHtml(source)}</code></pre>`;
    }
    this.diagramCache.set(cacheKey, html);
    return html;
  }

  private shellHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', f));
    const dist = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', f));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media('seldia-preview.css')}">
<link rel="stylesheet" href="${media('md-editor.css')}">
</head><body>
${ICON_SPRITE}
<div id="seldia-toc-config" data-seldia-toc-enabled="0" hidden></div>
<main id="doc" class="mde-doc"></main>
<script nonce="${nonce}" src="${dist('seldia-preview.js')}"></script>
<script nonce="${nonce}" src="${media('md-editor.js')}"></script>
</body></html>`;
  }
}
