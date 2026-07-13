// =============================================================================
// SelDiA — Web Components & CodeMirror Language Mode Entry Point
// =============================================================================

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createEngine } from '@seldia/core';
import type { CoreEngine } from '@seldia/core';

// ── <seldia-viewer> ──────────────────────────────────────────────────────────
@customElement('seldia-viewer')
export class SelDiAViewer extends LitElement {
  static styles = css`
    :host { display: block; }
    .container { padding: 16px; }
    svg { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
    .error { color: #e53e3e; padding: 16px; background: #fff5f5; border-radius: 8px; font-family: monospace; }
  `;

  @property({ type: String }) src = '';
  @property({ type: String }) dsl = '';
  @property({ type: String }) theme = 'sketchy-light';
  @property({ type: Boolean }) interactive = false;

  private engine: CoreEngine = createEngine();
  private svgContent = '';

  async updated(changed: Map<string, unknown>) {
    if (changed.has('dsl') || changed.has('theme') || changed.has('src')) {
      await this.compile();
    }
  }

  private async compile() {
    let source = this.dsl;
    if (this.src && !source) {
      try {
        const resp = await fetch(this.src);
        source = await resp.text();
      } catch {
        this.svgContent = `<div class="error">Failed to load: ${this.src}</div>`;
        this.requestUpdate();
        return;
      }
    }
    if (!source) { this.svgContent = ''; this.requestUpdate(); return; }
    const result = await this.engine.compile(source, this.src || undefined);
    this.svgContent = result.ok ? result.value.svg : `<div class="error">Compile error</div>`;
    this.requestUpdate();
  }

  render() {
    return html`<div class="container">${this.svgContent}</div>`;
  }
}

// ── <seldia-editor> ──────────────────────────────────────────────────────────
@customElement('seldia-editor')
export class SelDiAEditor extends LitElement {
  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; }
    textarea { flex: 1; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; resize: none; outline: none; background: #f8fafc; color: #1a202c; line-height: 1.5; }
    textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.1); }
    .toolbar { display: flex; gap: 8px; padding: 8px 0; align-items: center; }
    .toolbar button { padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; cursor: pointer; font-size: 12px; }
    .toolbar button:hover { background: #f1f5f9; }
    .status { font-size: 11px; color: #64748b; margin-left: auto; }
  `;

  @property({ type: String }) diagram = 'flowchart';
  @property({ type: String }) theme = 'sketchy-light';
  @property({ type: String }) value = '';
  @property({ type: Boolean }) readonly = false;

  private engine: CoreEngine = createEngine();
  private outputSvg = '';

  render() {
    return html`
      <div class="toolbar">
        <button @click=${this.compile}>▶ Compile</button>
        <button @click=${this.copy}>📋 Copy SVG</button>
        <span class="status">${this.outputSvg ? '✅ Rendered' : '⚪ Ready'}</span>
      </div>
      <textarea .value=${this.value} @input=${this.onInput} ?readonly=${this.readonly} placeholder="diagram ${this.diagram} &quot;Title&quot; { ... }"></textarea>
      ${this.outputSvg ? html`<div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px">${this.outputSvg}</div>` : ''}
    `;
  }

  private onInput(e: Event) {
    this.value = (e.target as HTMLTextAreaElement).value;
    this.dispatchEvent(new CustomEvent('change', { detail: { value: this.value } }));
  }

  private async compile() {
    if (!this.value) return;
    const result = await this.engine.compile(this.value);
    this.outputSvg = result.ok ? result.value.svg : `<div style="color:#e53e3e;padding:12px;background:#fff5f5;border-radius:8px">❌ ${(result.errors || []).map((e: any) => e.message).join(', ')}</div>`;
    this.requestUpdate();
  }

  private async copy() {
    if (this.outputSvg) {
      await navigator.clipboard.writeText(this.outputSvg);
    }
  }
}

// ── <seldia-live> ────────────────────────────────────────────────────────────
@customElement('seldia-live')
export class SelDiALive extends LitElement {
  static styles = css`
    :host { display: grid; grid-template-columns: 1fr 1fr; height: 100vh; gap: 16px; padding: 16px; }
    .panel { display: flex; flex-direction: column; }
    .panel-header { font-weight: 600; font-size: 14px; color: #64748b; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .05em; }
    textarea { flex: 1; font-family: monospace; font-size: 13px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; resize: none; outline: none; background: #f8fafc; }
    textarea:focus { border-color: #3b82f6; }
    .preview { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; overflow: auto; background: #fff; }
    svg { max-width: 100%; height: auto; }
  `;

  @property({ type: String }) theme = 'sketchy-light';
  private engine: CoreEngine = createEngine();
  private dsl = '';
  private svgOut = '';

  render() {
    return html`
      <div class="panel">
        <div class="panel-header">📝 DSL Editor</div>
        <textarea @input=${this.onInput} placeholder="diagram flowchart &quot;Title&quot; { ... }">${this.dsl}</textarea>
      </div>
      <div class="panel">
        <div class="panel-header">🎨 Preview</div>
        <div class="preview">${this.svgOut || html`<div style="color:#94a3b8;text-align:center;padding:40px">Edit the DSL to see the preview</div>`}</div>
      </div>
    `;
  }

  private async onInput(e: Event) {
    this.dsl = (e.target as HTMLTextAreaElement).value;
    if (!this.dsl) { this.svgOut = ''; this.requestUpdate(); return; }
    const result = await this.engine.compile(this.dsl);
    this.svgOut = result.ok ? result.value.svg : `<div style="color:#e53e3e">${(result.errors || []).map((err: any) => err.message).join('; ')}</div>`;
    this.requestUpdate();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'seldia-viewer': SelDiAViewer;
    'seldia-editor': SelDiAEditor;
    'seldia-live': SelDiALive;
  }
}

// ── CodeMirror 6 Language Mode Exports ───────────────────────────────────────
export { seldiaLanguage, seldiaAutocomplete, seldiaIndent } from './codemirror/seldia-language.js';
