// =============================================================================
// SelDiA — Markdown Visual Editor: webview client (bundled to media/md-editor.js)
// =============================================================================
// Renders the host's segments as a keyed column of blocks. The document is the
// source of truth: every edit is posted to the host as a line-range edit, and
// the next `render` message brings the result back. Blocks being edited are
// never replaced from a render.
// =============================================================================

interface Seg {
  key: string;
  kind: 'frontmatter' | 'prose' | 'diagram';
  startLine: number;
  endLine: number;
  raw: string;
  html: string;
  lang?: string;
  source?: string;
  blockId?: string;
  bodyStart?: number;
  bodyEnd?: number;
}

interface Block {
  key: string;
  seg: Seg;
  el: HTMLElement;
  view: HTMLElement;
  html: string;
  /** Prose / frontmatter editor. */
  textarea?: HTMLTextAreaElement;
  /** Diagram source editor. */
  src?: {
    root: HTMLElement;
    area: HTMLTextAreaElement;
    lastSource: string;
    pending: boolean;
    timer: number | null;
    pendingTimeout: number | null;
  };
}

declare function acquireVsCodeApi(): any;

const vscode = acquireVsCodeApi();
const docEl = document.getElementById('doc') as HTMLElement;
const blocks = new Map<string, Block>();
let pendingFocus: number | null = null;
let firstRender = true;
let lastLineCount = 0;

const addBar = document.createElement('div');
addBar.className = 'mde-addbar';
docEl.appendChild(addBar);
for (const [label, snippet] of [['Text', 'text'], ['Heading', 'heading'], ['SelDiA diagram', 'seldia'], ['Mermaid diagram', 'mermaid']] as const) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = '+ ' + label;
  b.addEventListener('click', () => vscode.postMessage({ type: 'insert', atLine: 1e9, snippet }));
  addBar.appendChild(b);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function notifyUpdated(): void {
  window.dispatchEvent(new Event('vscode.markdown.updateContent'));
}

function toast(text: string): void {
  const t = el('div', 'mde-toast', text);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

// ── Insert "+" control ──────────────────────────────────────────────────────
function makeInsert(b: Block): HTMLElement {
  const wrap = el('div', 'mde-insert-wrap');
  const btn = el('button', 'mde-insert', '+');
  btn.type = 'button';
  btn.title = 'Insert a block below';
  let menu: HTMLElement | null = null;
  const close = () => { menu?.remove(); menu = null; };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) { close(); return; }
    menu = el('div', 'mde-menu');
    for (const [label, snippet] of [['Text', 'text'], ['Heading', 'heading'], ['SelDiA diagram', 'seldia'], ['Mermaid diagram', 'mermaid']] as const) {
      const item = el('button', undefined, label);
      item.type = 'button';
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        close();
        vscode.postMessage({ type: 'insert', atLine: b.seg.endLine, snippet });
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
    const off = (ev: MouseEvent) => {
      if (!wrap.contains(ev.target as Node)) { close(); document.removeEventListener('mousedown', off, true); }
    };
    document.addEventListener('mousedown', off, true);
  });
  wrap.appendChild(btn);
  return wrap;
}

// ── Block creation / update ─────────────────────────────────────────────────
function createBlock(seg: Seg): Block {
  const section = el('section', 'mde-block ' + (seg.kind === 'diagram' ? 'mde-diagram' : seg.kind === 'frontmatter' ? 'mde-prose mde-frontmatter-block' : 'mde-prose'));
  section.dataset.key = seg.key;
  const view = el('div', 'mde-view');
  section.appendChild(view);
  const b: Block = { key: seg.key, seg, el: section, view, html: '' };
  section.appendChild(makeInsert(b));
  return b;
}

function updateBlock(b: Block, seg: Seg): void {
  b.seg = seg;
  b.key = seg.key;
  b.el.dataset.key = seg.key;
  b.el.dataset.start = String(seg.startLine);
  b.el.dataset.end = String(seg.endLine);
  if (seg.blockId) b.el.dataset.blockId = seg.blockId;
  if (b.html !== seg.html) {
    b.view.innerHTML = seg.html;
    b.html = seg.html;
  }
  if (b.src) {
    const s = b.src;
    s.pending = false;
    if (s.pendingTimeout !== null) { clearTimeout(s.pendingTimeout); s.pendingTimeout = null; }
    s.lastSource = seg.source ?? '';
    if (s.area.value !== s.lastSource) sendSourceEdit(b);
  }
}

// ── Prose editing ───────────────────────────────────────────────────────────
function openProseEditor(b: Block, selectAll = false): void {
  if (b.textarea || b.src) return;
  const ta = el('textarea', 'mde-textarea');
  ta.value = b.seg.raw;
  ta.spellcheck = false;
  b.textarea = ta;
  b.view.hidden = true;
  b.el.classList.add('mde-editing');
  b.el.insertBefore(ta, b.view.nextSibling);
  autosize(ta);
  ta.focus();
  if (selectAll) ta.select();
  let closed = false;
  const close = (commit: boolean) => {
    if (closed) return;
    closed = true;
    const value = ta.value.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    b.textarea = undefined;
    ta.remove();
    b.view.hidden = false;
    b.el.classList.remove('mde-editing');
    if (commit && value !== b.seg.raw) {
      vscode.postMessage({ type: 'editLines', startLine: b.seg.startLine, endLine: b.seg.endLine, original: b.seg.raw, text: value });
    }
  };
  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('blur', () => close(true));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(true); }
  });
}

// ── Diagram source editing ──────────────────────────────────────────────────
function sendSourceEdit(b: Block): void {
  const s = b.src;
  if (!s || s.pending) return;
  const value = s.area.value;
  if (value === s.lastSource) return;
  s.pending = true;
  // Safety net: a rejected/no-op edit may never produce a render.
  s.pendingTimeout = window.setTimeout(() => { s.pending = false; s.pendingTimeout = null; }, 3000);
  vscode.postMessage({
    type: 'editLines',
    startLine: b.seg.bodyStart,
    endLine: b.seg.bodyEnd,
    original: s.lastSource,
    text: value,
  });
}

function closeSourceEditor(b: Block): void {
  const s = b.src;
  if (!s) return;
  if (s.timer !== null) clearTimeout(s.timer);
  if (s.pendingTimeout !== null) clearTimeout(s.pendingTimeout);
  // Flush a not-yet-sent edit so closing never loses typing.
  if (!s.pending && s.area.value !== s.lastSource) {
    vscode.postMessage({ type: 'editLines', startLine: b.seg.bodyStart, endLine: b.seg.bodyEnd, original: s.lastSource, text: s.area.value });
  }
  s.root.remove();
  b.src = undefined;
  b.el.classList.remove('mde-editing');
}

function openSourceEditor(b: Block): void {
  if (b.src || b.textarea || b.seg.kind !== 'diagram') return;
  const root = el('div', 'mde-src');
  const bar = el('div', 'mde-src-bar');
  bar.appendChild(el('span', 'mde-src-lang', b.seg.lang ?? 'diagram'));
  bar.appendChild(el('span', 'mde-spacer'));
  const canvas = el('button', undefined, 'Open canvas');
  const del = el('button', 'mde-danger', 'Delete diagram');
  const done = el('button', undefined, 'Done');
  for (const x of [canvas, del, done]) { x.type = 'button'; bar.appendChild(x); }
  const area = el('textarea', 'mde-src-text');
  area.spellcheck = false;
  area.value = b.seg.source ?? '';
  root.append(bar, area);
  b.el.appendChild(root);
  b.el.classList.add('mde-editing');
  const s = { root, area, lastSource: b.seg.source ?? '', pending: false, timer: null as number | null, pendingTimeout: null as number | null };
  b.src = s;
  autosize(area);

  area.addEventListener('input', () => {
    autosize(area);
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = window.setTimeout(() => { s.timer = null; sendSourceEdit(b); }, 300);
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSourceEditor(b); }
    else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input'));
    }
  });
  canvas.addEventListener('click', () => vscode.postMessage({ type: 'openVisual', blockId: b.seg.blockId }));
  done.addEventListener('click', () => closeSourceEditor(b));
  let armed = false;
  del.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      del.textContent = 'Click again to delete';
      setTimeout(() => { armed = false; del.textContent = 'Delete diagram'; }, 3000);
      return;
    }
    if (s.timer !== null) clearTimeout(s.timer);
    s.lastSource = b.seg.source ?? '';
    area.value = s.lastSource; // discard unsent typing; the delete uses the document's text
    vscode.postMessage({ type: 'editLines', startLine: b.seg.startLine, endLine: b.seg.endLine, original: b.seg.raw, text: '' });
    closeSourceEditor(b);
  });
  area.focus();
}

// ── Render ──────────────────────────────────────────────────────────────────
function render(segs: Seg[]): void {
  // 1. Editing diagram blocks follow their fence line, not their (changing) key.
  const claimed = new Set<string>();
  for (const b of [...blocks.values()]) {
    if (!b.src) continue;
    const match = segs.find((s) => s.kind === 'diagram' && s.startLine === b.seg.startLine && !claimed.has(s.key));
    if (!match) { closeSourceEditor(b); continue; }
    claimed.add(match.key);
    const other = blocks.get(match.key);
    if (other && other !== b) { other.el.remove(); blocks.delete(match.key); }
    blocks.delete(b.key);
    b.key = match.key;
    blocks.set(match.key, b);
  }

  // 2. Drop stale blocks.
  const wanted = new Set(segs.map((s) => s.key));
  for (const [k, b] of [...blocks]) {
    if (!wanted.has(k)) { b.el.remove(); blocks.delete(k); }
  }

  // 3. Create / update, then reorder with minimal moves (a focused textarea
  //    must not be detached, which would blur it).
  const ordered: HTMLElement[] = [];
  for (const seg of segs) {
    let b = blocks.get(seg.key);
    if (!b) { b = createBlock(seg); blocks.set(seg.key, b); }
    updateBlock(b, seg);
    ordered.push(b.el);
  }
  let cursor: Element | null = docEl.firstElementChild;
  for (const e of ordered) {
    if (e === cursor) cursor = cursor.nextElementSibling;
    else docEl.insertBefore(e, cursor);
  }
  addBar.classList.toggle('mde-addbar-empty', segs.length === 0);
  lastLineCount = segs.length ? segs[segs.length - 1].endLine : 0;

  // 4. Honour a pending focus request.
  if (pendingFocus !== null) {
    const seg = segs.find((s) => s.startLine === pendingFocus);
    pendingFocus = null;
    const b = seg && blocks.get(seg.key);
    if (b) {
      b.el.scrollIntoView({ block: 'nearest' });
      if (b.seg.kind === 'diagram') openSourceEditor(b);
      else openProseEditor(b, true);
    }
  }

  notifyUpdated();

  if (firstRender) {
    firstRender = false;
    try {
      const st = vscode.getState();
      if (st && typeof st.scrollY === 'number') window.scrollTo(0, st.scrollY);
    } catch { /* ignore */ }
  }
}

// ── Events ──────────────────────────────────────────────────────────────────
function blockOf(target: EventTarget | null): Block | undefined {
  const sec = (target as Element | null)?.closest?.('.mde-block') as HTMLElement | null;
  if (!sec) return undefined;
  return blocks.get(sec.dataset.key ?? '');
}

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (!m) return;
  if (m.type === 'render') render(m.segments as Seg[]);
  else if (m.type === 'focusLine') pendingFocus = m.line;
  else if (m.type === 'notice') toast(String(m.text));
});

// Capture on window so we run before the preview script's delegated handlers.
window.addEventListener('click', (e) => {
  const t = e.target as Element;
  const link = t.closest?.('a[href^="vscode://"]') as HTMLAnchorElement | null;
  if (link) {
    e.preventDefault();
    e.stopPropagation();
    vscode.postMessage({ type: 'deepLink', href: link.getAttribute('href') });
    return;
  }
  const modeBtn = t.closest?.('.seldia-mode-btn[data-seldia-target-mode="code"]');
  if (modeBtn) {
    const b = blockOf(modeBtn);
    if (b && b.seg.kind === 'diagram') {
      e.preventDefault();
      e.stopPropagation();
      if (b.src) closeSourceEditor(b); else openSourceEditor(b);
    }
  }
}, true);

docEl.addEventListener('click', (e) => {
  const t = e.target as Element;
  const b = blockOf(t);
  if (!b) return;

  const anchor = t.closest('a') as HTMLAnchorElement | null;
  if (anchor && b.seg.kind !== 'diagram' && b.view.contains(anchor)) {
    const href = anchor.getAttribute('href') ?? '';
    e.preventDefault();
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      (document.getElementById(id) ?? document.querySelector(`[name="${CSS.escape(id)}"]`))?.scrollIntoView();
    } else if (href) {
      vscode.postMessage({ type: 'openLink', href });
    }
    return;
  }
  if (!t.closest('.mde-view')) return;
  if (t.closest('a, button, input, textarea, summary, select')) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;

  if (b.seg.kind === 'diagram') {
    if (t.closest('.mde-fallback')) openSourceEditor(b);
    return;
  }
  openProseEditor(b);
});

docEl.addEventListener('dblclick', (e) => {
  const t = e.target as Element;
  if (!t.closest('.seldia-diagram-svg')) return;
  const b = blockOf(t);
  if (b && b.seg.kind === 'diagram') vscode.postMessage({ type: 'openVisual', blockId: b.seg.blockId });
});

let scrollTimer: number | null = null;
window.addEventListener('scroll', () => {
  if (scrollTimer !== null) clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    try { vscode.setState({ scrollY: window.scrollY }); } catch { /* ignore */ }
  }, 150);
});

void lastLineCount;
vscode.postMessage({ type: 'ready' });
export {};
