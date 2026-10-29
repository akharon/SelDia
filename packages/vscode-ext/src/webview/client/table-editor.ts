// =============================================================================
// SelDiA — GFM Table Editor (webview client)
// =============================================================================
// Grid UI for webview/table-provider.ts. The host owns the truth: this script
// only renders the table it is sent and posts intents (`op`, `undo`, `redo`).
// Every cell is a plaintext contenteditable; a cell commits on blur, so
// Tab/Enter navigation (which moves focus) is also what saves. Re-renders keep
// the focused cell, its caret and any uncommitted text, so a host update that
// lands while the user is already typing in the next cell never eats keys.
// =============================================================================

type Align = 'left' | 'center' | 'right' | null;
interface Table { header: string[]; align: Align[]; rows: string[][]; indent: string }
type Op =
  | { kind: 'setCell'; row: number; col: number; value: string }
  | { kind: 'insertRow'; index: number }
  | { kind: 'deleteRow'; index: number }
  | { kind: 'insertCol'; index: number }
  | { kind: 'deleteCol'; index: number }
  | { kind: 'moveRow'; from: number; to: number }
  | { kind: 'moveCol'; from: number; to: number }
  | { kind: 'setAlign'; col: number; align: Align };

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(() => {
  const vscode = acquireVsCodeApi();
  const grid = document.getElementById('grid') as HTMLTableElement;
  const status = document.getElementById('status') as HTMLElement;
  const menu = document.getElementById('menu') as HTMLElement;

  let table: Table | undefined;
  let canUndo = false;
  let canRedo = false;
  /** Selected cell: r = -1 is the header row, c is the column. */
  let sel = { r: -1, c: 0 };
  /** Where focus should land after the host answers the op we just sent. */
  let pendingFocus: { r: number; c: number } | null = null;

  const post = (msg: unknown) => vscode.postMessage(msg);
  const sendOp = (op: Op, focusAfter?: { r: number; c: number }) => {
    if (focusAfter) pendingFocus = focusAfter;
    post({ type: 'op', op });
  };

  const cellAt = (r: number, c: number) =>
    grid.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
  const valueOf = (r: number, c: number) => (r < 0 ? table!.header[c] : table!.rows[r]?.[c]) ?? '';
  const cellText = (el: HTMLElement) => (el.innerText ?? el.textContent ?? '').replace(/\n$/, '');

  // ── Rendering ──────────────────────────────────────────────────────────

  function colName(c: number): string {
    let s = '';
    let n = c + 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function render() {
    // Preserve the focused cell (and anything typed but not yet committed).
    const active = document.activeElement as HTMLElement | null;
    let keep: { r: number; c: number; text: string; dirty: boolean; caret: number } | null = null;
    if (active?.dataset?.r !== undefined && grid.contains(active) && table) {
      const r = Number(active.dataset.r);
      const c = Number(active.dataset.c);
      const text = cellText(active);
      keep = { r, c, text, dirty: text !== active.dataset.committed, caret: caretOffset(active) };
    }

    grid.textContent = '';
    if (!table) {
      status.textContent = 'This table can no longer be found in the document (it was removed or is no longer a valid table). Close this panel or undo the change.';
      status.className = 'status warn';
      return;
    }
    status.className = 'status';

    const cols = table.header.length;
    const thead = grid.createTHead();
    const letters = thead.insertRow();
    const corner = document.createElement('th');
    corner.className = 'corner';
    letters.appendChild(corner);
    for (let c = 0; c < cols; c++) {
      const th = document.createElement('th');
      th.className = 'colhead';
      th.textContent = colName(c);
      th.dataset.colhead = String(c);
      letters.appendChild(th);
    }
    const head = thead.insertRow();
    head.dataset.r = '-1';
    head.appendChild(rowHead('H', -1));
    for (let c = 0; c < cols; c++) head.appendChild(editable('th', -1, c));

    const tbody = grid.createTBody();
    table.rows.forEach((_, r) => {
      const tr = tbody.insertRow();
      tr.dataset.r = String(r);
      tr.appendChild(rowHead(String(r + 1), r));
      for (let c = 0; c < cols; c++) tr.appendChild(editable('td', r, c));
    });

    const target = pendingFocus ?? (keep ? { r: keep.r, c: keep.c } : null);
    pendingFocus = null;
    if (target) {
      const r = Math.min(target.r, table.rows.length - 1);
      const c = Math.min(target.c, cols - 1);
      const el = cellAt(r, c) ?? cellAt(-1, c);
      if (el) {
        if (keep && keep.dirty && keep.r === r && keep.c === c) el.textContent = keep.text;
        focusCell(el, keep && keep.r === r && keep.c === c ? keep.caret : undefined);
      }
    } else {
      sel = { r: Math.min(sel.r, table.rows.length - 1), c: Math.min(sel.c, cols - 1) };
    }
    syncToolbar();
  }

  function rowHead(label: string, r: number): HTMLElement {
    const td = document.createElement(r < 0 ? 'th' : 'td');
    td.className = r < 0 ? 'corner' : 'rowhead';
    td.textContent = label;
    td.dataset.rowhead = String(r);
    return td;
  }

  function editable(tag: 'th' | 'td', r: number, c: number): HTMLElement {
    const el = document.createElement(tag);
    const v = valueOf(r, c);
    el.textContent = v;
    el.dataset.r = String(r);
    el.dataset.c = String(c);
    el.dataset.committed = v;
    el.tabIndex = -1;
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    el.spellcheck = false;
    const a = table!.align[c];
    if (a) el.style.textAlign = a;
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-label', `${r < 0 ? 'Header' : `Row ${r + 1}`}, column ${colName(c)}`);
    return el;
  }

  function caretOffset(el: HTMLElement): number {
    const s = window.getSelection();
    if (!s || !s.rangeCount || !el.contains(s.anchorNode)) return cellText(el).length;
    const range = s.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setEnd(s.anchorNode!, s.anchorOffset);
    return range.toString().length;
  }

  function focusCell(el: HTMLElement, caret?: number) {
    el.focus();
    const s = window.getSelection();
    if (!s) return;
    const range = document.createRange();
    const text = el.firstChild;
    if (caret !== undefined && text && text.nodeType === Node.TEXT_NODE) {
      const off = Math.min(caret, (text.textContent ?? '').length);
      range.setStart(text, off);
      range.collapse(true);
    } else {
      // Fresh focus: select the whole cell so typing replaces it (spreadsheet feel).
      range.selectNodeContents(el);
    }
    s.removeAllRanges();
    s.addRange(range);
  }

  function syncToolbar() {
    const rows = table?.rows.length ?? 0;
    const cols = table?.header.length ?? 0;
    const body = sel.r >= 0;
    const dis: Record<string, boolean> = {
      rowAbove: !table, rowBelow: !table, colLeft: !table, colRight: !table,
      deleteRow: !table || !body,
      deleteCol: !table || cols <= 1,
      moveUp: !table || !body || sel.r === 0,
      moveDown: !table || !body || sel.r >= rows - 1,
      moveLeft: !table || sel.c === 0,
      moveRight: !table || sel.c >= cols - 1,
      alignNone: !table, alignLeft: !table, alignCenter: !table, alignRight: !table,
      merge: true,
      undo: !canUndo, redo: !canRedo, reveal: false,
    };
    document.querySelectorAll<HTMLButtonElement>('.toolbar button[data-act]').forEach((b) => {
      b.disabled = !!dis[b.dataset.act!];
    });
    const align = table?.align[sel.c] ?? null;
    const pressed: Record<string, boolean> = {
      alignNone: align === null, alignLeft: align === 'left', alignCenter: align === 'center', alignRight: align === 'right',
    };
    for (const [act, on] of Object.entries(pressed)) {
      document.querySelector(`.toolbar button[data-act="${act}"]`)?.setAttribute('aria-pressed', String(!!table && on));
    }
    grid.querySelectorAll('.sel-row').forEach((e) => e.classList.remove('sel-row'));
    grid.querySelectorAll('.sel-col').forEach((e) => e.classList.remove('sel-col'));
    grid.querySelector(`tr[data-r="${sel.r}"]`)?.classList.add('sel-row');
    grid.querySelector(`[data-colhead="${sel.c}"]`)?.classList.add('sel-col');
  }

  // ── Commit & actions ───────────────────────────────────────────────────

  function commit(el: HTMLElement) {
    if (!table || el.dataset.r === undefined) return;
    const text = cellText(el);
    if (text === el.dataset.committed) return;
    el.dataset.committed = text; // optimistic: avoid a double commit on re-blur
    sendOp({ kind: 'setCell', row: Number(el.dataset.r), col: Number(el.dataset.c), value: text });
  }

  function act(name: string) {
    if (name === 'undo') { post({ type: 'undo' }); return; }
    if (name === 'redo') { post({ type: 'redo' }); return; }
    if (name === 'reveal') { post({ type: 'revealSource' }); return; }
    if (!table) return;
    const { r, c } = sel;
    switch (name) {
      case 'rowAbove': { const i = r < 0 ? 0 : r; sendOp({ kind: 'insertRow', index: i }, { r: i, c }); break; }
      case 'rowBelow': { const i = r + 1; sendOp({ kind: 'insertRow', index: i }, { r: i, c }); break; }
      case 'colLeft': sendOp({ kind: 'insertCol', index: c }, { r, c }); break;
      case 'colRight': sendOp({ kind: 'insertCol', index: c + 1 }, { r, c: c + 1 }); break;
      case 'deleteRow': if (r >= 0) sendOp({ kind: 'deleteRow', index: r }, { r: Math.min(r, table.rows.length - 2), c }); break;
      case 'deleteCol': if (table.header.length > 1) sendOp({ kind: 'deleteCol', index: c }, { r, c: Math.min(c, table.header.length - 2) }); break;
      case 'moveUp': if (r > 0) sendOp({ kind: 'moveRow', from: r, to: r - 1 }, { r: r - 1, c }); break;
      case 'moveDown': if (r >= 0 && r < table.rows.length - 1) sendOp({ kind: 'moveRow', from: r, to: r + 1 }, { r: r + 1, c }); break;
      case 'moveLeft': if (c > 0) sendOp({ kind: 'moveCol', from: c, to: c - 1 }, { r, c: c - 1 }); break;
      case 'moveRight': if (c < table.header.length - 1) sendOp({ kind: 'moveCol', from: c, to: c + 1 }, { r, c: c + 1 }); break;
      case 'alignNone': sendOp({ kind: 'setAlign', col: c, align: null }, { r, c }); break;
      case 'alignLeft': sendOp({ kind: 'setAlign', col: c, align: 'left' }, { r, c }); break;
      case 'alignCenter': sendOp({ kind: 'setAlign', col: c, align: 'center' }, { r, c }); break;
      case 'alignRight': sendOp({ kind: 'setAlign', col: c, align: 'right' }, { r, c }); break;
    }
  }

  function move(dr: number, dc: number, opts: { wrap?: boolean } = {}) {
    if (!table) return;
    const rows = table.rows.length;
    const cols = table.header.length;
    let r = sel.r + dr;
    let c = sel.c + dc;
    if (opts.wrap) {
      if (c >= cols) { c = 0; r++; }
      if (c < 0) { c = cols - 1; r--; }
    }
    if (r < -1 || c < 0 || c >= cols) return;
    if (r >= rows) {
      // Tab past the last cell appends a row — the familiar word-processor gesture.
      if (opts.wrap) { sendOp({ kind: 'insertRow', index: rows }, { r: rows, c: 0 }); (document.activeElement as HTMLElement)?.blur(); }
      return;
    }
    const el = cellAt(r, c);
    if (el) focusCell(el);
  }

  // ── Events ─────────────────────────────────────────────────────────────

  grid.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.r === undefined) return;
    sel = { r: Number(el.dataset.r), c: Number(el.dataset.c) };
    syncToolbar();
  });
  grid.addEventListener('focusout', (e) => commit(e.target as HTMLElement));

  // Clicking a row/column handle selects its first cell.
  grid.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.rowhead !== undefined) { e.preventDefault(); cellAt(Number(t.dataset.rowhead), sel.c)?.focus(); }
    else if (t.dataset.colhead !== undefined) { e.preventDefault(); cellAt(sel.r, Number(t.dataset.colhead))?.focus(); }
  });

  // Paste as plain text only (no HTML spans in contenteditable fallbacks).
  grid.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (text === undefined) return;
    e.preventDefault();
    document.execCommand('insertText', false, text.replace(/\r?\n/g, ' '));
  });

  grid.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.r === undefined) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && !e.shiftKey && k.toLowerCase() === 'z') {
      e.preventDefault();
      // An uncommitted cell edit is undone locally first; otherwise the
      // document-level snapshot undo runs on the host.
      if (cellText(el) !== el.dataset.committed) { el.textContent = el.dataset.committed ?? ''; focusCell(el); }
      else post({ type: 'undo' });
      return;
    }
    if (mod && ((e.shiftKey && k.toLowerCase() === 'z') || k.toLowerCase() === 'y')) {
      e.preventDefault();
      commit(el);
      post({ type: 'redo' });
      return;
    }
    if (e.altKey && k.startsWith('Arrow')) {
      e.preventDefault();
      commit(el);
      act({ ArrowUp: 'moveUp', ArrowDown: 'moveDown', ArrowLeft: 'moveLeft', ArrowRight: 'moveRight' }[k] as string);
      return;
    }
    switch (k) {
      case 'Tab': e.preventDefault(); move(0, e.shiftKey ? -1 : 1, { wrap: true }); break;
      case 'Enter': e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); break;
      case 'ArrowUp': if (!e.shiftKey) { e.preventDefault(); move(-1, 0); } break;
      case 'ArrowDown': if (!e.shiftKey) { e.preventDefault(); move(1, 0); } break;
      case 'Escape': e.preventDefault(); el.textContent = el.dataset.committed ?? ''; focusCell(el); break;
    }
  });

  document.querySelector('.toolbar')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (b && !b.disabled) act(b.dataset.act!);
  });
  // Keep the cell focused when a toolbar button is pressed with the mouse —
  // focusout still fires its commit, but the selection is not lost.
  document.querySelector('.toolbar')!.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) {
      const a = document.activeElement as HTMLElement | null;
      if (a && grid.contains(a)) commit(a);
    }
  });

  // ── Context menu ───────────────────────────────────────────────────────
  const MENU: Array<[string, string] | null> = [
    ['rowAbove', 'Insert row above'], ['rowBelow', 'Insert row below'],
    ['colLeft', 'Insert column left'], ['colRight', 'Insert column right'], null,
    ['deleteRow', 'Delete row'], ['deleteCol', 'Delete column'], null,
    ['moveUp', 'Move row up'], ['moveDown', 'Move row down'],
    ['moveLeft', 'Move column left'], ['moveRight', 'Move column right'], null,
    ['alignNone', 'Align: default'], ['alignLeft', 'Align: left'], ['alignCenter', 'Align: center'], ['alignRight', 'Align: right'], null,
    ['merge', 'Merge cells'],
  ];

  grid.addEventListener('contextmenu', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-r][data-c]');
    if (!el) return;
    e.preventDefault();
    if (document.activeElement !== el) el.focus();
    menu.textContent = '';
    for (const item of MENU) {
      if (!item) { menu.appendChild(document.createElement('hr')); continue; }
      const [name, label] = item;
      const tb = document.querySelector<HTMLButtonElement>(`.toolbar button[data-act="${name}"]`);
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.menuAct = name;
      b.setAttribute('role', 'menuitem');
      b.disabled = !!tb?.disabled;
      if (name === 'merge') b.title = 'Merging needs a SelDiA table (coming soon)';
      menu.appendChild(b);
    }
    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - w - 4)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - h - 4)}px`;
  });
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-menu-act]');
    if (!b || b.disabled) return;
    menu.hidden = true;
    const a = document.activeElement as HTMLElement | null;
    if (a && grid.contains(a)) commit(a);
    act(b.dataset.menuAct!);
  });
  const hideMenu = () => { menu.hidden = true; };
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target as Node)) hideMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
  window.addEventListener('blur', hideMenu);

  // Global undo/redo when focus is outside the grid (e.g. on a toolbar button).
  document.addEventListener('keydown', (e) => {
    if (grid.contains(e.target as Node)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); post({ type: 'undo' }); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); post({ type: 'redo' }); }
  });

  // ── Host messages ──────────────────────────────────────────────────────
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.type !== 'table') return;
    table = m.table;
    canUndo = !!m.canUndo;
    canRedo = !!m.canRedo;
    render();
  });

  post({ type: 'ready' });
})();
