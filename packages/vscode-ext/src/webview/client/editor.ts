// =============================================================================
// SelDiA — Visual editor webview client
// =============================================================================
// Runs inside the panel's webview (browser context, no vscode API except
// acquireVsCodeApi()). Bundled by esbuild into media/editor.js and loaded via
// asWebviewUri + a nonce'd <script> tag from provider.ts's getHtmlContent.
// Extracted from the inline <script> that used to live in that template
// literal — behavior is unchanged, only the packaging moved. Initial IR/theme now arrive via
// window.__seldiaInit instead of template interpolation.
// =============================================================================

import { decideUpdate, isEditBlocked } from './stale-state.js';
import { reduceInteraction, initialInteractionState, type InteractionEffect } from './interaction-reducer.js';

interface SeldiaInit {
  ir: any;
  theme: string;
}

declare global {
  interface Window {
    __seldiaInit: SeldiaInit;
    zoomIn: () => void;
    zoomOut: () => void;
    togglePanTool: () => void;
    resetZoom: () => void;
    fitToScreen: () => void;
    handleUndo: () => void;
    handleRedo: () => void;
    handleAddNode: () => void;
    handleAddEdge: () => void;
    exportSvg: () => void;
  }
  function acquireVsCodeApi(): { postMessage(msg: any): void };
}

export {};

// ── State ──────────────────────────────────────────────────────────
const vscodeApi = acquireVsCodeApi();
let isStale = false;
const vscode = {
  postMessage(m: any) {
    if (isEditBlocked(isStale, m?.type)) return; // stale SVG: edits would patch wrong lines
    vscodeApi.postMessage(m);
  },
};
let scale = 1;
let offsetX = 0,
  offsetY = 0;
// Mode/selection/edge-draw-source transitions run through the pure reducer
// in interaction-reducer.ts; these mirror its state for the DOM code below
// that reads them directly (drag, context menu, etc).
let interactionState = initialInteractionState();
let editMode = 'idle';
let selectedNodeId: string | null = null;
let selectedEdgeId: string | null = null;
let edgeDrawSourceId: string | null = null;
let dragNodeId: string | null = null;
let dragStartX = 0,
  dragStartY = 0;
let isDragging = false;
let isPanning = false;
let panStartX = 0,
  panStartY = 0;
let contextTargetId: string | null = null;
let contextTargetType: string | null = null;
let nodePositions: Record<string, { x: number; y: number }> = {};
let irData: any = window.__seldiaInit.ir;

// ── Initialize ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  annotateSvg();
  initFromIR();
  prepareEdges();
  vscode.postMessage({ type: 'ready' });
});

// The engine emits data-seldia-node-id / data-seldia-edge-id on the
// per-element <g> wrappers; the interaction layer here keys everything
// (click-select, drag, context menu, label editor) off data-id/data-type.
// Bridge the two after every SVG install — without this, clicks find no
// [data-id] ancestor and every action silently no-ops.
function annotateSvg() {
  const map: [string, string][] = [
    ['data-seldia-node-id', 'node'],
    ['data-seldia-edge-id', 'edge'],
    ['data-seldia-edge-ref', 'edge'],   // arrowhead / label layers of an edge
    ['data-seldia-group-id', 'group'],
  ];
  for (const [attr, type] of map) {
    document.querySelectorAll('#container [' + attr + ']').forEach((el) => {
      el.setAttribute('data-id', el.getAttribute(attr)!);
      el.setAttribute('data-type', type);
    });
  }
}

function initFromIR() {
  nodePositions = {};
  if (!irData || !Array.isArray(irData.nodes)) return;
  for (const n of irData.nodes) {
    nodePositions[n.id] = { x: n.x, y: n.y };
  }
}

// Screen px → SVG user units. Accounts for BOTH the zoom transform and
// the CSS max-width scaling (getBoundingClientRect sees the composite).
// Without this, drag deltas were written back as raw screen pixels —
// off by the scale factor whenever the diagram wasn't at exactly 1:1.
function svgUnitsPerPixel() {
  const svg = container.querySelector('svg');
  if (!svg) return 1;
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  if (!vb || !vb.width || !rect.width) return 1;
  return vb.width / rect.width;
}

// ── Floorplan drag guides ────────────────────────────────────────────
// While dragging a piece of furniture, show live horizontal and vertical
// distance lines from it to the nearest wall or object that shares its
// x-range (below/above) or y-range (left/right) — the same "what's my
// clearance" question the static dimension strings answer for the plan as
// a whole, but live, for the thing actually moving.
const FP_TICK = 5;

interface FpBox {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
}

/** Every candidate the dragged item can be measured against: wall
 *  segments (as thin boxes) and every other furniture piece's bbox, all
 *  in SVG user units. Re-read from the live DOM on every move rather than
 *  cached, since it's cheap and guarantees it never drifts from what's
 *  on screen. */
function fpObstacles(svg: SVGSVGElement, dragId: string | null): FpBox[] {
  const boxes: FpBox[] = [];
  svg.querySelectorAll('.seldia-floorplan-walls line').forEach((w) => {
    const x1 = parseFloat(w.getAttribute('x1')!),
      y1 = parseFloat(w.getAttribute('y1')!);
    const x2 = parseFloat(w.getAttribute('x2')!),
      y2 = parseFloat(w.getAttribute('y2')!);
    const t = parseFloat(w.getAttribute('stroke-width')!) || 4.5;
    const half = t / 2;
    boxes.push({
      x: Math.min(x1, x2) - half,
      y: Math.min(y1, y2) - half,
      w: Math.abs(x2 - x1) + t,
      h: Math.abs(y2 - y1) + t,
      kind: 'wall',
    });
  });
  svg.querySelectorAll('[data-id][data-type="node"]').forEach((el) => {
    if (el.getAttribute('data-id') === dragId) return;
    const b = (el as unknown as SVGGraphicsElement).getBBox();
    if (b.width <= 0 || b.height <= 0) return;
    boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, kind: 'object' });
  });
  return boxes;
}

function fpGuideGroup(svg: SVGSVGElement) {
  let g = svg.querySelector('#fpDragGuides');
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'fpDragGuides');
    svg.appendChild(g);
  }
  return g;
}

function fpFormatLen(px: number) {
  const scale = (irData && irData.fpScale) || 60;
  const m = px / scale;
  return m < 1 ? Math.round(m * 100) + ' cm' : m.toFixed(2) + ' m';
}

function fpLine(g: Element, x1: number, y1: number, x2: number, y2: number, cls: string) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('class', cls);
  g.appendChild(el);
}

function fpLabel(g: Element, x: number, y: number, text: string, vertical: boolean) {
  const w = text.length * 10.5 * 0.58 + 8,
    h = 15;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'fp-guide-pill');
  rect.setAttribute('rx', '2');
  if (vertical) {
    rect.setAttribute('x', String(x - h / 2));
    rect.setAttribute('y', String(y - w / 2));
    rect.setAttribute('width', String(h));
    rect.setAttribute('height', String(w));
  } else {
    rect.setAttribute('x', String(x - w / 2));
    rect.setAttribute('y', String(y - h / 2));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
  }
  g.appendChild(rect);
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.setAttribute('class', 'fp-guide-text');
  if (vertical) t.setAttribute('transform', 'rotate(-90 ' + x + ' ' + y + ')');
  t.textContent = text;
  g.appendChild(t);
}

type FpSide = 'left' | 'right' | 'up' | 'down';
const FP_OPPOSITE: Record<FpSide, FpSide> = { left: 'right', right: 'left', up: 'down', down: 'up' };
interface FpHit { o: FpBox; gap: number }

/** Nearest obstacle on one side of `box` that overlaps it on the
 *  perpendicular axis — "what's directly left/right/above/below me". */
function fpNearest(box: FpBox, obstacles: FpBox[], side: FpSide): FpHit | null {
  const horiz = side === 'left' || side === 'right';
  let best: FpHit | null = null;
  for (const o of obstacles) {
    const overlaps = horiz ? box.y < o.y + o.h && box.y + box.h > o.y : box.x < o.x + o.w && box.x + box.w > o.x;
    if (!overlaps) continue;
    const gap = side === 'right' ? o.x - (box.x + box.w)
      : side === 'left' ? box.x - (o.x + o.w)
      : side === 'down' ? o.y - (box.y + box.h)
      : box.y - (o.y + o.h);
    if (gap >= -0.5 && (!best || gap < best.gap)) best = { o, gap: Math.max(0, gap) };
  }
  return best;
}

/** Dimension line + ticks + value pill from `box` to `hit` on `side`. With
 *  `editId`, the pill is a click-to-edit control (limits carried in data-*). */
function fpDrawGuide(g: Element, box: FpBox, hit: FpHit, side: FpSide, editId?: string, opposite?: FpHit | null) {
  const best = hit.o;
  const midY = Math.max(box.y, best.y) / 2 + Math.min(box.y + box.h, best.y + best.h) / 2;
  const midX = Math.max(box.x, best.x) / 2 + Math.min(box.x + box.w, best.x + best.w) / 2;
  let x1: number, y1: number, x2: number, y2: number;
  if (side === 'right') { y1 = y2 = midY; x1 = box.x + box.w; x2 = best.x; }
  else if (side === 'left') { y1 = y2 = midY; x1 = best.x + best.w; x2 = box.x; }
  else if (side === 'down') { x1 = x2 = midX; y1 = box.y + box.h; y2 = best.y; }
  else { x1 = x2 = midX; y1 = best.y + best.h; y2 = box.y; }
  fpLine(g, x1, y1, x2, y2, 'fp-guide-line');
  const vertical = side === 'up' || side === 'down';
  for (const [tx, ty] of [[x1, y1], [x2, y2]]) {
    fpLine(g, tx - (vertical ? FP_TICK : 0), ty - (vertical ? 0 : FP_TICK), tx + (vertical ? FP_TICK : 0), ty + (vertical ? 0 : FP_TICK), 'fp-guide-tick');
  }
  const before = g.childNodes.length;
  fpLabel(g, (x1 + x2) / 2, (y1 + y2) / 2, fpFormatLen(hit.gap), vertical);
  if (!editId) return;
  // Wrap the pill + text so the whole label is one click target.
  const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  wrap.setAttribute('class', 'fp-guide-edit');
  wrap.setAttribute('data-node', editId);
  wrap.setAttribute('data-side', side);
  wrap.setAttribute('data-gap', String(hit.gap));
  // Max: slide all the way to the opposite obstacle (or a generous 50 m).
  wrap.setAttribute('data-max', String(hit.gap + (opposite ? opposite.gap : 3000)));
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  t.textContent = 'Click to set this distance';
  wrap.appendChild(t);
  while (g.childNodes.length > before) wrap.appendChild(g.childNodes[before]);
  g.appendChild(wrap);
}

function updateFpDragGuides(svg: SVGSVGElement, el: Element, tx: number, ty: number) {
  const bb = (el as unknown as SVGGraphicsElement).getBBox(); // el already carries the ghost transform
  const box: FpBox = { x: bb.x + tx, y: bb.y + ty, w: bb.width, h: bb.height, kind: 'drag' };
  const obstacles = fpObstacles(svg, el.getAttribute('data-id'));
  const g = fpGuideGroup(svg);
  g.textContent = '';
  for (const pair of [['up', 'down'], ['left', 'right']] as FpSide[][]) {
    const hits = pair.map((s) => [s, fpNearest(box, obstacles, s)] as const).filter(([, h]) => h);
    hits.sort((a, b) => a[1]!.gap - b[1]!.gap);
    if (hits[0]) fpDrawGuide(g, box, hits[0][1]!, hits[0][0]);
  }
}

/** Would `box` overlap a wall? (Touching is fine: walls are shrunk 1 unit.) */
function fpHitsWall(box: FpBox, walls: FpBox[]): boolean {
  return walls.some((w) => box.x < w.x + w.w - 1 && box.x + box.w > w.x + 1 && box.y < w.y + w.h - 1 && box.y + box.h > w.y + 1);
}

function clearFpDragGuides() {
  const svg = container.querySelector('svg');
  const g = svg && svg.querySelector('#fpDragGuides');
  if (g) g.remove();
}

// ── Zoom & Pan ─────────────────────────────────────────────────────
const container = document.getElementById('container')!;

// Upper zoom bound derived from the SVG's natural size, so the scaled
// composited layer never exceeds ~8000px on a side. transform:scale
// promotes the SVG to its own GPU layer rasterized at full scale — a
// 3000px-wide diagram at 5x is a 15000px texture, and layers that size
// are exactly what tips Electron's compositor into the blank-webview
// state on Linux.
function maxScaleFor() {
  const svg = container.querySelector('svg');
  const vb = svg && svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width || !vb.height) return 5;
  return Math.max(1, Math.min(5, 8000 / Math.max(vb.width, vb.height)));
}

// Zoom around a fixed point (cx, cy in container coordinates).
function zoomAt(cx: number, cy: number, factor: number) {
  const newScale = Math.max(0.1, Math.min(maxScaleFor(), scale * factor));
  offsetX = cx - (cx - offsetX) * (newScale / scale);
  offsetY = cy - (cy - offsetY) * (newScale / scale);
  scale = newScale;
  applyTransform();
}

// Wheel behaves like every canvas app: scroll / two-finger swipe pans,
// Ctrl+wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms at the
// cursor. Shift+wheel scrolls sideways on a plain mouse.
container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? container.clientHeight : 1;
  if (e.ctrlKey || e.metaKey) {
    const rect = container.getBoundingClientRect();
    // Proportional to the delta and clamped: one mouse notch ≈ 10%.
    const step = Math.max(-0.1, Math.min(0.1, e.deltaY * unit * 0.0015));
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-step));
    return;
  }
  let dx = e.deltaX * unit, dy = e.deltaY * unit;
  if (e.shiftKey && !dx) { dx = dy; dy = 0; }
  offsetX -= dx;
  offsetY -= dy;
  applyTransform();
}, { passive: false });

// ── Tools: Select (default) | Pan ──────────────────────────────────
// Select: click selects, drag moves, drag on empty canvas box-selects.
// Pan: drag moves the view. Middle-drag or holding Space pans in any tool.
type Tool = 'select' | 'pan';
let tool: Tool = 'select';
let spaceDown = false;
function syncToolUi() {
  const pan = tool === 'pan' || spaceDown;
  container.classList.toggle('tool-pan', pan);
  container.classList.toggle('tool-select', !pan);
  for (const [id, on] of [['btnSelect', tool === 'select'], ['btnPan', tool === 'pan']] as const) {
    const b = document.getElementById(id);
    b?.classList.toggle('active', on);
    b?.setAttribute('aria-pressed', String(on));
  }
}
function setTool(t: Tool) {
  tool = t;
  syncToolUi();
}
window.togglePanTool = () => setTool(tool === 'pan' ? 'select' : 'pan');
syncToolUi();

container.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && (tool === 'pan' || spaceDown))) {
    isPanning = true;
    container.classList.add('is-panning');
    panStartX = e.clientX - offsetX;
    panStartY = e.clientY - offsetY;
    e.preventDefault();
    e.stopImmediatePropagation(); // panning never also selects / drags
  }
}, true);

document.addEventListener('mousemove', (e) => {
  if (isPanning) {
    offsetX = e.clientX - panStartX;
    offsetY = e.clientY - panStartY;
    applyTransform();
  }
});

document.addEventListener('mouseup', (e) => {
  if (isPanning) {
    container.classList.remove('is-panning');
    if (container.contains(e.target as Node)) suppressNextClick = true;
  }
  isPanning = false;
});

function applyTransform() {
  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (svg) {
    svg.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
    svg.style.transformOrigin = '0 0';
  }
}

// Button zoom pivots on the container centre, not the origin — zooming
// around (0,0) walked the diagram off-screen with every click.
window.zoomIn = () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1.2);
window.zoomOut = () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1 / 1.2);
window.resetZoom = () => {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  applyTransform();
};
window.fitToScreen = () => {
  const svg = container.querySelector('svg');
  if (!svg) return;
  // Work in on-screen CSS px: the viewBox is user units, which differ from
  // the SVG's laid-out size whenever width/height attrs are set.
  const rect = svg.getBoundingClientRect();
  const crect = container.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const w = rect.width / scale;
  const h = rect.height / scale;
  // Layout position of the untransformed SVG inside the container.
  const baseX = rect.left - crect.left - offsetX;
  const baseY = rect.top - crect.top - offsetY;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  scale = Math.max(0.1, Math.min(maxScaleFor(), Math.min(cw / w, ch / h) * 0.9));
  offsetX = (cw - w * scale) / 2 - baseX;
  offsetY = (ch - h * scale) / 2 - baseY;
  applyTransform();
};

// ── Selection ──────────────────────────────────────────────────────
let suppressNextClick = false; // set on drag mouseup so the trailing click doesn't clear selection

/** Apply reducer effects to the DOM/vscode API. The reducer itself never
 *  touches either — this is the one place that bridges pure state
 *  transitions back into the webview. */
function applyInteractionEffects(effects: InteractionEffect[]) {
  for (const eff of effects) {
    switch (eff.type) {
      case 'selectNode': {
        const el = container.querySelector('[data-id="' + eff.id + '"]');
        if (el) el.setAttribute('data-selected', 'true');
        break;
      }
      case 'selectEdge': {
        const el = container.querySelector('[data-id="' + eff.id + '"]');
        if (el) el.setAttribute('data-selected', 'true');
        showEdgeHandles(eff.id);
        break;
      }
      case 'clearSelection':
        clearSelectionDom();
        clearEdgeHandles();
        break;
      case 'markEdgeSource':
        markEdgeDrawSource(eff.id);
        break;
      case 'clearEdgeSource':
        clearEdgeDrawSource();
        break;
      case 'postEdgeAdded':
        vscode.postMessage({ type: 'edgeAdded', sourceId: eff.sourceId, targetId: eff.targetId, kind: pendingEdgeKind });
        pendingEdgeKind = undefined;
        break;
      case 'postCreateConnectedNode':
        vscode.postMessage({ type: 'nodeAdded', connectFromId: eff.sourceId });
        pendingEdgeKind = undefined;
        break;
      case 'postEdgeReconnected':
        vscode.postMessage({ type: 'edgeReconnected', edgeId: eff.edgeId, end: eff.end, newId: eff.newId });
        break;
      case 'setAddEdgeButtonActive':
        document.getElementById('btnAddEdge')!.classList.toggle('active', eff.active);
        // Visible mode banner: the toolbar button alone is
        // easy to miss, so say explicitly what clicking will do next.
        modeBanner.style.display = eff.active ? 'block' : 'none';
        modeBanner.textContent = eff.active ? 'Click source node, then target node — Esc to cancel' : '';
        // Crosshair cursor for the whole canvas while in draw mode
        // Cleared here so ESCAPE/TOGGLE_EDGE_DRAW
        // both reset it via this one effect.
        container.classList.toggle('seldia-drawing-edge', eff.active);
        if (!eff.active) clearRubberBand();
        break;
      case 'setReconnectingActive':
        // Same banner/cursor pattern as drawing-edge mode, worded for
        // reconnect instead of "click source then target" (Step 4.1).
        modeBanner.style.display = eff.active ? 'block' : 'none';
        if (eff.active) modeBanner.textContent = 'Click the new node to reconnect to — Esc to cancel';
        container.classList.toggle('seldia-drawing-edge', eff.active);
        break;
      case 'closeOverlays':
        labelEditor.style.display = 'none';
        (contextMenu as HTMLElement).style.display = 'none';
        break;
    }
  }
}

function dispatchInteraction(event: Parameters<typeof reduceInteraction>[1]) {
  const { state, effects } = reduceInteraction(interactionState, event);
  interactionState = state;
  editMode = state.mode;
  selectedNodeId = state.selectedNodeId;
  selectedEdgeId = state.selectedEdgeId;
  edgeDrawSourceId = state.edgeDrawSourceId;
  applyInteractionEffects(effects);
}

container.addEventListener('click', (e) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (isPanning || e.button !== 0) return;
  const target = (e.target as Element).closest('[data-id]');
  // Shift+click adds / removes a node from the selection.
  if (e.shiftKey && target?.getAttribute('data-type') === 'node' && editMode === 'idle') {
    const id = target.getAttribute('data-id')!;
    const ids = selectedNodeIds();
    setMultiSel(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    return;
  }
  clearMultiSel();
  if (target) {
    const id = target.getAttribute('data-id')!;
    const type = target.getAttribute('data-type');
    if (type === 'node') {
      dispatchInteraction({ type: 'CLICK_NODE', id });
    } else if (type === 'edge') {
      dispatchInteraction({ type: 'CLICK_EDGE', id });
    }
  } else {
    dispatchInteraction({ type: 'CLICK_EMPTY' });
  }
});

container.addEventListener('dblclick', (e) => {
  const target = (e.target as Element).closest('[data-id]');
  if (!target) return;
  const id = target.getAttribute('data-id')!;
  const type = target.getAttribute('data-type');
  if (type === 'node') {
    // Some node renderings carry their label OUTSIDE the <g> wrapper (or
    // as paths) — open the editor with an empty seed instead of silently
    // doing nothing, matching the context menu's Edit Label behavior.
    const textEl = target.querySelector('text');
    openLabelEditor(target, textEl ? textEl.textContent! : '', id, 'node');
  } else if (type === 'edge') {
    const textEl = target.querySelector('text');
    if (textEl) {
      openLabelEditor(target, textEl.textContent!, id, 'edge');
    } else {
      openLabelEditor(target, '', id, 'edge');
    }
  }
});

// ── Direct manipulation: move nodes, box-select, move edges ────────
// "Only what you touch moves": every gesture posts the CURRENT layout
// (positions + drawn routes) alongside the change, and the host freezes the
// rest of the diagram in the source (see edit/layout-patch.ts).
type Pt = { x: number; y: number };
let dragUnitsPerPx = 1; // captured at drag start; scale can't change mid-drag
let dragIsFloorplan = false;
let dragIds: string[] = [];
/** Extra nodes selected by box-select / Shift+click (beyond the reducer's single selection). */
const multiSel = new Set<string>();

const freeLayout = () => !!(irData && irData.freeLayout);
const cssEsc = (s: string) => s.replace(/["\\]/g, '\\$&');

function svgEl(): SVGSVGElement | null {
  return container.querySelector('svg') as SVGSVGElement | null;
}
/** Client px → SVG user units. */
function toSvgPt(clientX: number, clientY: number): Pt {
  const svg = svgEl();
  if (!svg) return { x: clientX, y: clientY };
  const rect = svg.getBoundingClientRect();
  const upp = svgUnitsPerPixel();
  const vb = svg.viewBox.baseVal;
  return { x: (vb ? vb.x : 0) + (clientX - rect.left) * upp, y: (vb ? vb.y : 0) + (clientY - rect.top) * upp };
}

function parseRoute(s: string | null): Pt[] {
  if (!s) return [];
  return s.trim().split(/\s+/).map((p) => {
    const [x, y] = p.split(',').map(Number);
    return { x, y };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}
function edgeGroup(id: string): SVGGElement | null {
  return container.querySelector('g.seldia-edge[data-seldia-edge-id="' + cssEsc(id) + '"]');
}
function edgePad(g: Element | null): number {
  return parseFloat(g?.getAttribute('data-pad') || '0') || 0;
}
/** Every edge's drawn route (layout coords), for the host's freeze. */
function currentRoutes(): Record<string, Pt[]> {
  const out: Record<string, Pt[]> = {};
  container.querySelectorAll('g.seldia-edge[data-route]').forEach((g) => {
    const pts = parseRoute(g.getAttribute('data-route'));
    if (pts.length >= 2) out[g.getAttribute('data-seldia-edge-id')!] = pts;
  });
  return out;
}
/** All parts of an edge: path group + arrowhead + label layers. */
function edgeParts(id: string): Element[] {
  const sel = cssEsc(id);
  return Array.from(container.querySelectorAll('[data-seldia-edge-id="' + sel + '"], [data-seldia-edge-ref="' + sel + '"]'));
}

/** Called after every SVG install: wide invisible hit line on each edge
 *  (thin strokes are hard to grab) + a movable / fixed cursor class. */
function prepareEdges() {
  const movable = freeLayout();
  container.querySelectorAll('g.seldia-edge').forEach((g) => {
    g.classList.toggle('seldia-edge-movable', movable);
    g.classList.toggle('seldia-edge-fixed', !movable);
    if (!movable) g.setAttribute('title', 'Edges in this diagram type are placed automatically');
    const pts = parseRoute(g.getAttribute('data-route'));
    if (pts.length < 2 || g.querySelector('.seldia-edge-hit')) return;
    const pad = edgePad(g);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    hit.setAttribute('class', 'seldia-edge-hit');
    hit.setAttribute('points', pts.map((p) => p.x + pad + ',' + (p.y + pad)).join(' '));
    g.insertBefore(hit, g.firstChild);
  });
}

// ── Multi-selection ────────────────────────────────────────────────
function markSelected(id: string, on: boolean) {
  const el = container.querySelector('[data-id="' + cssEsc(id) + '"][data-type="node"]');
  if (el) el.setAttribute('data-selected', on ? 'true' : 'false');
}
function clearMultiSel() {
  for (const id of multiSel) if (id !== selectedNodeId) markSelected(id, false);
  multiSel.clear();
}
function setMultiSel(ids: string[]) {
  clearMultiSel();
  dispatchInteraction({ type: 'CLICK_EMPTY' });
  if (ids.length === 1) {
    dispatchInteraction({ type: 'CLICK_NODE', id: ids[0] });
    return;
  }
  for (const id of ids) {
    multiSel.add(id);
    markSelected(id, true);
  }
}
function selectedNodeIds(): string[] {
  const s = new Set(multiSel);
  if (selectedNodeId) s.add(selectedNodeId);
  return [...s];
}

// ── Box select ─────────────────────────────────────────────────────
const marquee = document.getElementById('marquee') as HTMLDivElement;
let boxStart: { x: number; y: number; additive: boolean } | null = null;
let boxActive = false;

function boxRect(e: MouseEvent) {
  const x = Math.min(boxStart!.x, e.clientX), y = Math.min(boxStart!.y, e.clientY);
  return { x, y, w: Math.abs(e.clientX - boxStart!.x), h: Math.abs(e.clientY - boxStart!.y) };
}

// ── Node drag state ────────────────────────────────────────────────
/** Applied ghost offset (may lag the cursor when a wall blocks the move). */
let ghostTx = 0, ghostTy = 0;
let fpWalls: FpBox[] | null = null;
let fpDragBox: FpBox | null = null;
function dragGhost(tx: number, ty: number) {
  const svg = svgEl();
  if (!svg) return;
  // Floorplan furniture never straddles a wall: try the move, else slide
  // along the wall on one axis, else hold the last valid spot. Only the
  // drop spot is checked, so a piece can still be carried into the next
  // room — it jumps there once it fully fits.
  if (dragIsFloorplan && fpDragBox) {
    if (!fpWalls) fpWalls = fpObstacles(svg, null).filter((o) => o.kind === 'wall');
    const at = (x: number, y: number) => ({ ...fpDragBox!, x: fpDragBox!.x + x, y: fpDragBox!.y + y });
    if (!fpHitsWall(at(tx, ty), fpWalls)) { /* free */ }
    else if (!fpHitsWall(at(tx, ghostTy), fpWalls)) ty = ghostTy;
    else if (!fpHitsWall(at(ghostTx, ty), fpWalls)) tx = ghostTx;
    else { tx = ghostTx; ty = ghostTy; }
  }
  ghostTx = tx;
  ghostTy = ty;
  for (const id of dragIds) {
    const el = svg.querySelector('[data-id="' + cssEsc(id) + '"][data-type="node"]');
    if (!el) continue;
    // The ghost translate is in SVG user units, so it must track the
    // cursor exactly regardless of zoom / CSS scaling.
    el.setAttribute('transform', 'translate(' + tx + ', ' + ty + ')');
    el.classList.add('seldia-moving');
    if (dragIsFloorplan && dragIds.length === 1) updateFpDragGuides(svg, el, tx, ty);
  }
  scheduleSelectionDecor(); // frames follow the ghost
}
/** Edges touching a moved node will be re-routed: show them dashed while dragging. */
function markRerouting(on: boolean) {
  const set = new Set(dragIds);
  container.querySelectorAll('g.seldia-edge').forEach((g) => {
    const hit = set.has(g.getAttribute('data-src') || '') || set.has(g.getAttribute('data-tgt') || '');
    if (!hit) return;
    for (const part of edgeParts(g.getAttribute('data-seldia-edge-id')!)) part.classList.toggle('seldia-edge-rerouting', on);
  });
}
function endNodeDrag(cancel: boolean) {
  if (cancel || !isDragging) {
    const svg = svgEl();
    for (const id of dragIds) {
      const el = svg?.querySelector('[data-id="' + cssEsc(id) + '"][data-type="node"]');
      el?.removeAttribute('transform');
      el?.classList.remove('seldia-moving');
    }
  }
  markRerouting(false);
  container.classList.remove('is-dragging');
  dragNodeId = null;
  dragIds = [];
  isDragging = false;
  clearFpDragGuides();
  scheduleSelectionDecor();
}

// ── Edge drag state ────────────────────────────────────────────────
interface EdgeDrag {
  id: string;
  route: Pt[];       // layout coords, as drawn
  seg: number;       // segment index being moved
  orient: 'h' | 'v' | 'd';
  start: Pt;         // svg coords at mousedown
  pad: number;
  moved: boolean;
  next: Pt[];
}
let edgeDrag: EdgeDrag | null = null;

function nearestSegment(route: Pt[], p: Pt): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function segOrient(a: Pt, b: Pt): 'h' | 'v' | 'd' {
  if (Math.abs(a.y - b.y) < 0.5) return 'h';
  if (Math.abs(a.x - b.x) < 0.5) return 'v';
  return 'd';
}
/** New route for dragging segment `seg` by (dx, dy). A horizontal segment
 *  slides vertically, a vertical one sideways (bends stay square); an end
 *  segment keeps its node attachment by gaining a short stub. A diagonal
 *  (straight) segment gets a new bend at the cursor. */
function draggedRoute(d: EdgeDrag, dx: number, dy: number, cursor: Pt): Pt[] {
  const r = d.route.map((p) => ({ ...p }));
  const i = d.seg;
  if (d.orient === 'd') {
    r.splice(i + 1, 0, cursor);
    return r;
  }
  const off = d.orient === 'h' ? { x: 0, y: dy } : { x: dx, y: 0 };
  const a = { x: r[i].x + off.x, y: r[i].y + off.y };
  const b = { x: r[i + 1].x + off.x, y: r[i + 1].y + off.y };
  const head = i === 0 ? [r[0], a] : [...r.slice(0, i), a];
  const tail = i + 1 === r.length - 1 ? [b, r[r.length - 1]] : [b, ...r.slice(i + 2)];
  return [...head, ...tail];
}

function handleLayer(): SVGGElement | null {
  const svg = svgEl();
  if (!svg) return null;
  let g = svg.querySelector('#edgeHandles') as SVGGElement | null;
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'edgeHandles');
    svg.appendChild(g);
  }
  return g;
}
function clearEdgeHandles() {
  const g = svgEl()?.querySelector('#edgeHandles');
  if (g) g.innerHTML = '';
}
/** Selected edge: a small handle on each segment's midpoint says "drag me". */
function showEdgeHandles(id: string) {
  clearEdgeHandles();
  if (!freeLayout()) return;
  const g = edgeGroup(id);
  const layer = handleLayer();
  if (!g || !layer) return;
  const pts = parseRoute(g.getAttribute('data-route'));
  const pad = edgePad(g);
  const sz = 7 * svgUnitsPerPixel();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const o = segOrient(a, b);
    const h = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    h.setAttribute('class', 'seg-handle ' + o);
    h.setAttribute('x', String((a.x + b.x) / 2 + pad - sz / 2));
    h.setAttribute('y', String((a.y + b.y) / 2 + pad - sz / 2));
    h.setAttribute('width', String(sz));
    h.setAttribute('height', String(sz));
    h.setAttribute('rx', String(sz / 4));
    h.setAttribute('data-edge', id);
    h.setAttribute('data-seg', String(i));
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = o === 'd' ? 'Drag to add a bend' : 'Drag to move this part of the edge';
    h.appendChild(t);
    layer.appendChild(h);
  }
}
function drawEdgeGhost(d: EdgeDrag) {
  const layer = handleLayer();
  if (!layer) return;
  let ghost = layer.querySelector('.ghost') as SVGPolylineElement | null;
  if (!ghost) {
    ghost = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    ghost.setAttribute('class', 'ghost');
    layer.appendChild(ghost);
  }
  ghost.setAttribute('points', d.next.map((p) => p.x + d.pad + ',' + (p.y + d.pad)).join(' '));
}
function endEdgeDrag(cancel: boolean) {
  if (!edgeDrag) return;
  for (const part of edgeParts(edgeDrag.id)) part.classList.remove('seldia-edge-rerouting');
  const ghost = svgEl()?.querySelector('#edgeHandles .ghost');
  ghost?.remove();
  container.classList.remove('is-dragging');
  if (cancel && selectedEdgeId === edgeDrag.id) showEdgeHandles(edgeDrag.id);
  edgeDrag = null;
}

// ── mousedown: decide what this gesture is ─────────────────────────
container.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || isPanning || tool !== 'select' || editMode === 'drawing-edge' || editMode === 'reconnecting') return;
  const t = e.target as Element;

  // 1. Edge handle or edge body → move that edge.
  const handle = t.closest('#edgeHandles .seg-handle');
  const edgeEl = handle ? null : t.closest('[data-id][data-type="edge"]');
  if (handle || edgeEl) {
    const id = handle ? handle.getAttribute('data-edge')! : edgeEl!.getAttribute('data-id')!;
    const g = edgeGroup(id);
    const route = parseRoute(g?.getAttribute('data-route') ?? null);
    if (!freeLayout() || route.length < 2) return;
    const pad = edgePad(g);
    const sp = toSvgPt(e.clientX, e.clientY);
    const seg = handle ? Number(handle.getAttribute('data-seg')) : nearestSegment(route, { x: sp.x - pad, y: sp.y - pad });
    edgeDrag = { id, route, seg, orient: segOrient(route[seg], route[seg + 1]), start: sp, pad, moved: false, next: route };
    dragUnitsPerPx = svgUnitsPerPixel();
    e.preventDefault();
    return;
  }

  // 2. Node → move it (plus the rest of the selection, if it's part of one).
  const node = t.closest('[data-id][data-type="node"]');
  if (node) {
    const id = node.getAttribute('data-id')!;
    const sel = selectedNodeIds();
    dragNodeId = id;
    dragIds = sel.includes(id) && sel.length > 1 ? sel : [id];
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragUnitsPerPx = svgUnitsPerPixel();
    isDragging = false;
    const svg = svgEl();
    dragIsFloorplan = !!(svg && svg.querySelector('.seldia-floorplan-walls'));
    ghostTx = ghostTy = 0;
    fpWalls = null;
    fpDragBox = null;
    if (dragIsFloorplan && dragIds.length === 1 && node.getAttribute('data-fp-kind') === 'furniture') {
      const bb = (node as SVGGraphicsElement).getBBox();
      const startBox: FpBox = { x: bb.x, y: bb.y, w: bb.width, h: bb.height, kind: 'drag' };
      // A piece that already overlaps a wall (hand-written source) isn't
      // trapped by the check — it's simply not enforced for it.
      if (!fpHitsWall(startBox, fpObstacles(svg!, null).filter((o) => o.kind === 'wall'))) fpDragBox = startBox;
    }
    return;
  }

  // 3. Empty canvas → box select.
  if (!t.closest('[data-id]') && !t.closest('.error')) {
    boxStart = { x: e.clientX, y: e.clientY, additive: e.shiftKey };
    boxActive = false;
    e.preventDefault();
  }
});

document.addEventListener('mousemove', (e) => {
  if (boxStart) {
    const r = boxRect(e);
    if (!boxActive && r.w < 4 && r.h < 4) return;
    boxActive = true;
    marquee.style.display = 'block';
    marquee.style.left = r.x + 'px';
    marquee.style.top = r.y + 'px';
    marquee.style.width = r.w + 'px';
    marquee.style.height = r.h + 'px';
    return;
  }

  if (edgeDrag) {
    const sp = toSvgPt(e.clientX, e.clientY);
    const dx = sp.x - edgeDrag.start.x, dy = sp.y - edgeDrag.start.y;
    if (!edgeDrag.moved) {
      if (Math.hypot(dx, dy) < 3 * dragUnitsPerPx) return;
      edgeDrag.moved = true;
      clearEdgeHandles();
      container.classList.add('is-dragging');
      for (const part of edgeParts(edgeDrag.id)) part.classList.add('seldia-edge-rerouting');
    }
    edgeDrag.next = draggedRoute(edgeDrag, dx, dy, { x: sp.x - edgeDrag.pad, y: sp.y - edgeDrag.pad });
    drawEdgeGhost(edgeDrag);
    return;
  }

  if (!dragNodeId) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (!isDragging) {
    if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
    isDragging = true;
    container.classList.add('is-dragging');
    if (freeLayout()) markRerouting(true);
  }
  dragGhost(dx * dragUnitsPerPx, dy * dragUnitsPerPx);
});

document.addEventListener('mouseup', (e) => {
  if (boxStart) {
    if (boxActive) {
      const r = boxRect(e);
      const hits: string[] = [];
      container.querySelectorAll('[data-id][data-type="node"]').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width && b.left >= r.x && b.top >= r.y && b.right <= r.x + r.w && b.bottom <= r.y + r.h) hits.push(el.getAttribute('data-id')!);
      });
      const ids = boxStart.additive ? [...new Set([...selectedNodeIds(), ...hits])] : hits;
      setMultiSel(ids);
      suppressNextClick = true;
    }
    marquee.style.display = 'none';
    boxStart = null;
    boxActive = false;
    return;
  }

  if (edgeDrag) {
    const d = edgeDrag;
    if (d.moved) {
      vscode.postMessage({ type: 'layoutGesture', positions: nodePositions, routes: currentRoutes(), edgeRoute: { id: d.id, route: d.next } });
      suppressNextClick = true;
      endEdgeDrag(false);
    } else {
      edgeDrag = null; // plain click: the click handler selects the edge
    }
    return;
  }

  if (dragNodeId && isDragging) {
    const ddx = ghostTx, ddy = ghostTy;
    const moved: Record<string, Pt> = {};
    for (const id of dragIds) {
      const p = nodePositions[id];
      if (p) moved[id] = { x: p.x + ddx, y: p.y + ddy };
    }
    if (freeLayout() && !dragIsFloorplan) {
      vscode.postMessage({ type: 'layoutGesture', positions: nodePositions, routes: currentRoutes(), moved });
    } else {
      for (const [id, np] of Object.entries(moved)) {
        const op = nodePositions[id];
        vscode.postMessage({ type: 'nodeDragged', nodeId: id, oldPosition: { x: op.x, y: op.y }, newPosition: np });
      }
    }
    Object.assign(nodePositions, moved);
    suppressNextClick = true; // the click event that follows must not clear the selection
  }
  endNodeDrag(false);
});

/** Esc mid-gesture: put everything back, send nothing. */
function cancelGesture(): boolean {
  if (dragNodeId && isDragging) { endNodeDrag(true); suppressNextClick = true; return true; }
  if (edgeDrag?.moved) { endEdgeDrag(true); suppressNextClick = true; return true; }
  if (boxStart) { marquee.style.display = 'none'; boxStart = null; boxActive = false; return true; }
  return false;
}

// ── Selection decor: frames for selected nodes + floorplan dimensions ──
// Nodes have no built-in "selected" look (an SVG <g> can't take an outline),
// so selected nodes get a dashed frame with corner handles drawn in an
// overlay layer, recomputed whenever selection or the SVG changes.
const SVGNS = 'http://www.w3.org/2000/svg';

function overlayLayer(id: string): SVGGElement | null {
  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return null;
  let g = svg.querySelector('#' + id) as SVGGElement | null;
  if (!g) {
    g = document.createElementNS(SVGNS, 'g') as SVGGElement;
    g.setAttribute('id', id);
    svg.appendChild(g);
  }
  return g;
}

/** Element bbox in the root SVG's user units, including its own transform (drag ghost). */
function bboxInSvg(el: SVGGraphicsElement): { x: number; y: number; w: number; h: number } | null {
  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (!svg || !el.getBBox) return null;
  const b = el.getBBox();
  if (!b.width && !b.height) return null;
  const rootM = svg.getScreenCTM(), elM = el.getScreenCTM();
  if (!rootM || !elM) return { x: b.x, y: b.y, w: b.width, h: b.height };
  const m = rootM.inverse().multiply(elM);
  const p = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(m);
  const a = p(b.x, b.y), c = p(b.x + b.width, b.y + b.height);
  return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
}

let decorQueued = false;
function scheduleSelectionDecor() {
  if (decorQueued) return;
  decorQueued = true;
  requestAnimationFrame(() => {
    decorQueued = false;
    drawSelectionDecor();
  });
}

function drawSelectionDecor() {
  const layer = overlayLayer('selFrames');
  if (!layer) return;
  layer.textContent = '';
  const upp = svgUnitsPerPixel();
  const selected = Array.from(container.querySelectorAll('[data-type="node"][data-selected="true"]')) as SVGGraphicsElement[];
  for (const el of selected) {
    const b = bboxInSvg(el);
    if (!b) continue;
    const pad = 4 * upp, hs = 6 * upp;
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('class', 'sel-frame');
    r.setAttribute('x', String(b.x - pad));
    r.setAttribute('y', String(b.y - pad));
    r.setAttribute('width', String(b.w + pad * 2));
    r.setAttribute('height', String(b.h + pad * 2));
    layer.appendChild(r);
    for (const [cx, cy] of [[b.x - pad, b.y - pad], [b.x + b.w + pad, b.y - pad], [b.x - pad, b.y + b.h + pad], [b.x + b.w + pad, b.y + b.h + pad]]) {
      const h = document.createElementNS(SVGNS, 'rect');
      h.setAttribute('class', 'sel-corner');
      h.setAttribute('x', String(cx - hs / 2));
      h.setAttribute('y', String(cy - hs / 2));
      h.setAttribute('width', String(hs));
      h.setAttribute('height', String(hs));
      layer.appendChild(h);
    }
  }
  // Floorplan: a single selected piece of furniture shows its clearances,
  // and each one is click-to-edit.
  const fp = overlayLayer('fpSelGuides');
  if (fp) fp.textContent = '';
  const dragging = !!dragNodeId && isDragging;
  if (fp && !dragging && selected.length === 1 && selected[0].getAttribute('data-fp-kind') === 'furniture') {
    const svg = container.querySelector('svg') as SVGSVGElement;
    const id = selected[0].getAttribute('data-id')!;
    const b = bboxInSvg(selected[0]);
    if (b) {
      const box: FpBox = { ...b, kind: 'sel' };
      const obstacles = fpObstacles(svg, id);
      for (const side of ['left', 'right', 'up', 'down'] as FpSide[]) {
        const hit = fpNearest(box, obstacles, side);
        if (hit) fpDrawGuide(fp, box, hit, side, id, fpNearest(box, obstacles, FP_OPPOSITE[side]));
      }
    }
  }
}

new MutationObserver((recs) => {
  // Only real changes: a selection flip or a re-installed SVG. Our own
  // overlay redraws are childList changes deeper down — ignoring them is
  // what keeps this from re-triggering itself every frame.
  if (recs.some((r) => r.type === 'attributes' || r.target === container)) scheduleSelectionDecor();
}).observe(container, {
  childList: true,              // SVG re-installed
  subtree: true,
  attributes: true,
  attributeFilter: ['data-selected'],
});

// ── Editable floorplan dimension ───────────────────────────────────
const fpDimInput = document.createElement('input');
fpDimInput.id = 'fpDimInput';
fpDimInput.type = 'text';
fpDimInput.spellcheck = false;
document.body.appendChild(fpDimInput);
let fpDimEdit: { id: string; side: FpSide; gap: number; max: number } | null = null;

/** "1.2", "1.2 m", "120cm", "1,2" → metres; undefined if unreadable. */
function parseMetres(s: string): number | undefined {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(cm|mm|m)?\s*$/i.exec(s);
  if (!m) return undefined;
  const v = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] || 'm').toLowerCase();
  return unit === 'cm' ? v / 100 : unit === 'mm' ? v / 1000 : v;
}

function openFpDimEditor(label: Element, id: string, side: FpSide, gap: number, max: number) {
  const r = label.getBoundingClientRect();
  fpDimEdit = { id, side, gap, max };
  fpDimInput.value = fpFormatLen(gap);
  fpDimInput.title = 'Distance in m or cm — up to ' + fpFormatLen(max) + '. Enter to apply, Esc to cancel';
  fpDimInput.style.display = 'block';
  fpDimInput.style.left = Math.round(r.left + r.width / 2 - 45) + 'px';
  fpDimInput.style.top = Math.round(r.top + r.height / 2 - 12) + 'px';
  fpDimInput.classList.remove('invalid');
  fpDimInput.focus();
  fpDimInput.select();
}
function closeFpDimEditor() {
  fpDimEdit = null;
  fpDimInput.style.display = 'none';
}
function commitFpDimEditor() {
  const ed = fpDimEdit;
  if (!ed) return;
  const metres = parseMetres(fpDimInput.value);
  const scalePx = (irData && irData.fpScale) || 60;
  if (metres === undefined) { fpDimInput.classList.add('invalid'); return; }
  // Limits: can't go below zero (touching) or past the obstacle on the
  // opposite side (that would push it into a wall / another piece).
  const want = Math.max(0, Math.min(ed.max, metres * scalePx));
  const d = want - ed.gap;
  const delta = ed.side === 'right' ? { x: -d, y: 0 } : ed.side === 'left' ? { x: d, y: 0 } : ed.side === 'down' ? { x: 0, y: -d } : { x: 0, y: d };
  const op = nodePositions[ed.id];
  closeFpDimEditor();
  if (!op || Math.abs(d) < 0.5) return;
  const np = { x: op.x + delta.x, y: op.y + delta.y };
  vscode.postMessage({ type: 'nodeDragged', nodeId: ed.id, oldPosition: { x: op.x, y: op.y }, newPosition: np });
  nodePositions[ed.id] = np;
}
fpDimInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // Delete / V / H / Space belong to the text field
  if (e.key === 'Enter') { e.preventDefault(); commitFpDimEditor(); }
  if (e.key === 'Escape') { e.preventDefault(); closeFpDimEditor(); }
});
fpDimInput.addEventListener('blur', () => { if (fpDimEdit) commitFpDimEditor(); });

container.addEventListener('mousedown', (e) => {
  const lbl = (e.target as Element).closest('#fpSelGuides .fp-guide-edit');
  if (!lbl) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // not a box-select / drag
  suppressNextClick = true;
  openFpDimEditor(lbl, lbl.getAttribute('data-node')!, lbl.getAttribute('data-side') as FpSide,
    Number(lbl.getAttribute('data-gap')), Number(lbl.getAttribute('data-max')));
}, true);

// ── Label Editor ───────────────────────────────────────────────────
const labelEditor = document.getElementById('labelEditor')!;
let editTargetId: string | null = null;
let editTargetType: string | null = null;
let editOldLabel = '';

let editCancelled = false;
let hiddenLabelEls: Element[] = [];

/** Text elements that draw the label of `id` — inside the node/edge group
 *  and on detached edge-label layers. Hidden while editing so the old text
 *  doesn't show through behind the editor. */
function labelTextEls(relativeTo: Element, id: string): Element[] {
  const els: Element[] = Array.from(relativeTo.querySelectorAll('text'));
  container.querySelectorAll('[data-seldia-edge-ref="' + CSS.escape(id) + '"] text').forEach((t) => els.push(t));
  return els;
}

function restoreHiddenLabels() {
  hiddenLabelEls.forEach((el) => (el as SVGElement).style.removeProperty('visibility'));
  hiddenLabelEls = [];
}

function openLabelEditor(relativeTo: Element, currentLabel: string, id: string, type: string) {
  restoreHiddenLabels();
  const texts = labelTextEls(relativeTo, id);
  // Centre the editor over the label text itself (fall back to the shape).
  const anchor = texts.length ? texts[0] : relativeTo;
  const rect = anchor.getBoundingClientRect();
  hiddenLabelEls = texts;
  texts.forEach((t) => ((t as SVGElement).style.visibility = 'hidden'));
  editCancelled = false;
  labelEditor.textContent = currentLabel;
  labelEditor.style.display = 'block';
  const ew = labelEditor.offsetWidth;
  const eh = labelEditor.offsetHeight;
  labelEditor.style.left = Math.max(0, rect.left + rect.width / 2 - ew / 2 + window.scrollX) + 'px';
  labelEditor.style.top = Math.max(0, rect.top + rect.height / 2 - eh / 2 + window.scrollY) + 'px';
  editTargetId = id;
  editTargetType = type;
  editOldLabel = currentLabel;
  (labelEditor as HTMLElement).focus();
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(labelEditor);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

labelEditor.addEventListener('blur', () => finishLabelEdit());
labelEditor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    (labelEditor as HTMLElement).blur();
  }
  if (e.key === 'Escape') {
    // Hiding a focused element fires blur → finishLabelEdit, which used to
    // commit the half-typed text. Flag it as a cancel first.
    e.preventDefault();
    editCancelled = true;
    (labelEditor as HTMLElement).blur();
  }
});

function finishLabelEdit() {
  const newLabel = labelEditor.textContent!.trim();
  labelEditor.style.display = 'none';
  restoreHiddenLabels();
  const cancelled = editCancelled;
  editCancelled = false;
  if (!cancelled && editTargetId && newLabel && newLabel !== editOldLabel) {
    if (editTargetType === 'node') {
      vscode.postMessage({
        type: 'labelEdited',
        nodeId: editTargetId,
        oldLabel: editOldLabel,
        newLabel: newLabel,
      });
    } else if (editTargetType === 'edge') {
      vscode.postMessage({
        type: 'labelEdited',
        edgeId: editTargetId,
        oldLabel: editOldLabel,
        newLabel: newLabel,
      });
    }
  }
  editTargetId = null;
  editTargetType = null;
}

// ── Context Menu ───────────────────────────────────────────────────
const contextMenu = document.getElementById('contextMenu')!;

container.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const target = (e.target as Element).closest('[data-id]');
  if (target) {
    contextTargetId = target.getAttribute('data-id');
    contextTargetType = target.getAttribute('data-type');
  } else {
    contextTargetId = null;
    contextTargetType = null;
  }
  // Only show the entries that apply to what was clicked.
  const scope = contextTargetType || 'canvas';
  const isFurniture = !!(target && target.getAttribute('data-fp-kind') === 'furniture');
  contextMenu.querySelectorAll('[data-scope]').forEach((item) => {
    const scopes = item.getAttribute('data-scope')!.split(' ');
    const inScope = scopes.indexOf(scope) !== -1;
    (item as HTMLElement).style.display = inScope && (!item.hasAttribute('data-fp-only') || isFurniture) ? '' : 'none';
  });
  (contextMenu as HTMLElement).style.display = 'block';
  (contextMenu as HTMLElement).style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  (contextMenu as HTMLElement).style.top =
    Math.min(e.clientY, window.innerHeight - contextMenu.children.length * 30) + 'px';
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target as Node)) {
    (contextMenu as HTMLElement).style.display = 'none';
  }
  const tm = document.getElementById('themeMenu');
  const tb = document.getElementById('themeBtn');
  if (tm && !tm.contains(e.target as Node) && e.target !== tb) {
    tm.style.display = 'none';
    tb!.setAttribute('aria-expanded', 'false');
  }
});

contextMenu.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    const action = item.getAttribute('data-action')!;
    (contextMenu as HTMLElement).style.display = 'none';
    handleContextAction(action);
  });
});

function handleContextAction(action: string) {
  const id = contextTargetId;
  const type = contextTargetType;
  switch (action) {
    case 'edit-label':
      if (id) {
        const el = container.querySelector('[data-id="' + id + '"]');
        if (el) {
          const textEl = el.querySelector('text');
          openLabelEditor(el, textEl ? textEl.textContent! : '', id, type!);
        }
      }
      break;
    case 'edit-style':
      if (id) {
        // The extension host shows the QuickPick/InputBox and writes the
        // resulting style patch back into the source.
        vscode.postMessage({ type: 'requestStyleEdit', nodeId: id });
      }
      break;
    case 'add-node':
      vscode.postMessage({ type: 'nodeAdded' });
      break;
    case 'add-connected-node':
      if (id) {
        vscode.postMessage({ type: 'nodeAdded', connectFromId: id });
      }
      break;
    case 'add-edge':
      if (id && type === 'node') {
        if (editMode !== 'drawing-edge') dispatchInteraction({ type: 'TOGGLE_EDGE_DRAW' });
        dispatchInteraction({ type: 'CLICK_NODE', id });
      }
      break;
    case 'reconnect-source':
      if (id && type === 'edge') dispatchInteraction({ type: 'START_RECONNECT', edgeId: id, end: 'source' });
      break;
    case 'reconnect-target':
      if (id && type === 'edge') dispatchInteraction({ type: 'START_RECONNECT', edgeId: id, end: 'target' });
      break;
    case 'delete':
      if (id) {
        if (type === 'node') vscode.postMessage({ type: 'nodeDeleted', nodeId: id });
        if (type === 'edge') vscode.postMessage({ type: 'edgeDeleted', edgeId: id });
      }
      break;
    case 'rotate':
      if (id) rotateFurniture(id);
      break;
  }
}

/** Turn a piece of furniture 90° clockwise from its current rotation.
 *  Reads the current angle off the element's own data-fp-rotation (set by
 *  the renderer) rather than tracking it separately in webview state,
 *  since that attribute is always in sync with what's on screen. */
function rotateFurniture(id: string) {
  const el = container.querySelector('[data-id="' + id + '"]');
  if (!el || el.getAttribute('data-fp-kind') !== 'furniture') return;
  const current = Number(el.getAttribute('data-fp-rotation')) || 0;
  const next = (current + 90) % 360;
  vscode.postMessage({ type: 'furnitureRotated', nodeId: id, rotation: next });
}

// ── Toolbar Actions ────────────────────────────────────────────────
window.handleUndo = () => {
  vscode.postMessage({ type: 'undoRequested' });
};
window.handleRedo = () => {
  vscode.postMessage({ type: 'redoRequested' });
};
window.handleAddNode = () => {
  togglePalette(nodePalette, btnAddNode);
};
window.handleAddEdge = () => {
  const vocab = irData && irData.vocabulary;
  const kinds = vocab && Array.isArray(vocab.edges) ? vocab.edges : [];
  if (kinds.length > 1) {
    togglePalette(edgePalette, btnAddEdge, true);
    return;
  }
  // Only one edge kind for this diagram type (or vocabulary unknown yet):
  // skip the picker and go straight into draw mode, same as before.
  // Edge-draw mode is purely webview state — the old code posted an
  // editModeChanged message the host never answered, so the button
  // never actually entered the mode.
  dispatchInteraction({ type: 'TOGGLE_EDGE_DRAW' });
};

// ── Add-node / add-edge kind palettes ───────────────────────────────
// Popovers listing the current diagram type's edit vocabulary
// (getEditVocabulary in @seldia/core), so "add node" and "draw edge" pick a
// concrete element kind instead of always emitting the same flowchart
// template regardless of diagram type.
const nodePalette = document.getElementById('nodePalette')!;
const edgePalette = document.getElementById('edgePalette')!;
const btnAddNode = document.getElementById('btnAddNode')!;
const btnAddEdge = document.getElementById('btnAddEdge')!;
const modeBanner = document.getElementById('modeBanner')!;

function togglePalette(menu: HTMLElement, btn: Element, isEdgePalette = false) {
  const open = menu.style.display === 'block';
  nodePalette.style.display = 'none';
  edgePalette.style.display = 'none';
  btnAddNode.setAttribute('aria-expanded', 'false');
  btnAddEdge.setAttribute('aria-expanded', 'false');
  if (open) return;
  menu.style.display = 'block';
  btn.setAttribute('aria-expanded', 'true');
  void isEdgePalette;
}

function renderPalettes() {
  const vocab = irData && irData.vocabulary;
  nodePalette.innerHTML = '';
  edgePalette.innerHTML = '';
  const nodeKinds = (vocab && Array.isArray(vocab.nodes) ? vocab.nodes : []) as Array<{ kind: string; label: string }>;
  const edgeKinds = (vocab && Array.isArray(vocab.edges) ? vocab.edges : []) as Array<{ kind: string; label: string }>;
  for (const entry of nodeKinds) {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.setAttribute('role', 'option');
    item.textContent = entry.label;
    item.addEventListener('click', () => {
      nodePalette.style.display = 'none';
      btnAddNode.setAttribute('aria-expanded', 'false');
      vscode.postMessage({ type: 'nodeAdded', kind: entry.kind });
    });
    nodePalette.appendChild(item);
  }
  for (const entry of edgeKinds) {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.setAttribute('role', 'option');
    item.textContent = entry.label;
    item.addEventListener('click', () => {
      edgePalette.style.display = 'none';
      btnAddEdge.setAttribute('aria-expanded', 'false');
      pendingEdgeKind = entry.kind;
      dispatchInteraction({ type: 'TOGGLE_EDGE_DRAW' });
    });
    edgePalette.appendChild(item);
  }
}
renderPalettes();

document.addEventListener('click', (e) => {
  if (!nodePalette.contains(e.target as Node) && !btnAddNode.contains(e.target as Node)) {
    nodePalette.style.display = 'none';
    btnAddNode.setAttribute('aria-expanded', 'false');
  }
  if (!edgePalette.contains(e.target as Node) && !btnAddEdge.contains(e.target as Node)) {
    edgePalette.style.display = 'none';
    btnAddEdge.setAttribute('aria-expanded', 'false');
  }
});

/** Edge kind chosen from the palette before entering drawing-edge mode;
 *  consumed (and reset to undefined) the next time an edge is actually
 *  created, so a plain toolbar click without a prior palette pick falls
 *  back to the vocabulary's default kind. */
let pendingEdgeKind: string | undefined;

// ── Theme (custom dropdown; see the toolbar comment for why not a
//    native <select>) ────────────────────────────────────────────────
const themeBtn = document.getElementById('themeBtn')!;
const themeMenu = document.getElementById('themeMenu')!;
const THEME_LABELS: Record<string, string> = {
  'sketchy-light': 'Sketchy Light',
  'sketchy-dark': 'Sketchy Dark',
  'clean-light': 'Clean Light',
  'clean-dark': 'Clean Dark',
  mono: 'Mono',
  blueprint: 'Blueprint',
  comic: 'Comic',
};
let currentTheme = window.__seldiaInit.theme;
/** The page CSS is baked at panel creation; incremental re-renders only
 *  swap the SVG, so the canvas background must follow the theme here. */
function applyThemeChrome(t: string) {
  const bg: Record<string, string> = {
    'sketchy-dark': '#1e1e1e', 'clean-dark': '#1e1e1e', blueprint: '#1d4e89', comic: '#fffbeb',
  };
  document.documentElement.style.setProperty('--canvas-bg', bg[t] ?? '#ffffff');
}

function setThemeUI(t: string) {
  currentTheme = t;
  applyThemeChrome(t);
  themeBtn.textContent = (THEME_LABELS[t] || t) + ' ▾';
  themeMenu.querySelectorAll('[data-theme-value]').forEach((i) => {
    i.classList.toggle('selected', i.getAttribute('data-theme-value') === t);
  });
}
setThemeUI(currentTheme);
themeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = themeMenu.style.display === 'block';
  themeMenu.style.display = open ? 'none' : 'block';
  themeBtn.setAttribute('aria-expanded', String(!open));
});
themeMenu.querySelectorAll('[data-theme-value]').forEach((item) => {
  item.addEventListener('click', () => {
    const t = item.getAttribute('data-theme-value')!;
    themeMenu.style.display = 'none';
    themeBtn.setAttribute('aria-expanded', 'false');
    if (t !== currentTheme) {
      setThemeUI(t);
      vscode.postMessage({ type: 'changeTheme', theme: t });
    }
  });
});

// ── Export ─────────────────────────────────────────────────────────
window.exportSvg = () => {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return;
  // Export a clean copy: no pan/zoom transform, no selection/edit markers.
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.style.removeProperty('transform');
  clone.style.removeProperty('transform-origin');
  clone.querySelectorAll('[data-selected]').forEach((n) => n.removeAttribute('data-selected'));
  clone.querySelectorAll('[style*="visibility"]').forEach((n) => (n as SVGElement).style.removeProperty('visibility'));
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const s = new XMLSerializer().serializeToString(clone);
  // Blob/anchor downloads are ignored by VS Code webviews — the host
  // shows a save dialog and reports the written path.
  vscode.postMessage({ type: 'exportRequested', format: 'svg', svg: s });
};

// ── Toolbar wiring ─────────────────────────────────────────────────
// The webview CSP only allows nonce'd scripts, which silently blocks inline
// onclick="" attributes — every toolbar button was dead. Bind here instead.
const TOOLBAR_COMMANDS: Record<string, () => void> = {
  save: () => handleSave(),
  undo: () => window.handleUndo(),
  redo: () => window.handleRedo(),
  zoomIn: () => window.zoomIn(),
  zoomOut: () => window.zoomOut(),
  select: () => setTool('select'),
  pan: () => setTool('pan'),
  autoLayout: () => { clearMultiSel(); vscode.postMessage({ type: 'autoLayout' }); },
  fit: () => window.fitToScreen(),
  resetZoom: () => window.resetZoom(),
  addNode: () => window.handleAddNode(),
  addEdge: () => window.handleAddEdge(),
  exportSvg: () => window.exportSvg(),
};
document.querySelectorAll<HTMLElement>('[data-cmd]').forEach((btn) => {
  const fn = TOOLBAR_COMMANDS[btn.getAttribute('data-cmd')!];
  if (fn) {
    btn.addEventListener('click', () => fn());
  }
});

// ── Save ───────────────────────────────────────────────────────────
// Visual edits land in the document as WorkspaceEdits, which leaves it
// dirty; nothing in the panel ever wrote it to disk, so closing the panel
// (or the untouched-looking tab) lost the work.
function handleSave() {
  vscode.postMessage({ type: 'saveRequested' });
}

function setDirty(dirty: boolean) {
  const btn = document.getElementById('btnSave');
  if (!btn) return;
  btn.classList.toggle('dirty', !!dirty);
  btn.title = dirty ? 'Save (Ctrl+S) — unsaved changes' : 'Save (Ctrl+S)';
}

// ── Keyboard shortcuts ─────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // While typing in the label editor, Delete/Backspace/undo belong to
  // the text field — without this guard, a Backspace while renaming a
  // selected node deleted the node out from under the editor.
  if (document.activeElement === labelEditor) return;
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if ((e.key === 'h' || e.key === 'H') && plain) { setTool('pan'); return; }
  if ((e.key === 'v' || e.key === 'V') && plain) { setTool('select'); return; }
  if (e.key === ' ' && plain) {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; syncToolUi(); }
    return;
  }
  if (e.key === 'Escape') {
    if (cancelGesture()) return;
    clearMultiSel();
    dispatchInteraction({ type: 'ESCAPE' });
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    handleSave();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    vscode.postMessage({ type: 'undoRequested' });
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    vscode.postMessage({ type: 'redoRequested' });
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
    e.preventDefault();
    vscode.postMessage({ type: 'redoRequested' });
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNodeId || selectedEdgeId || multiSel.size)) {
    e.preventDefault();
    for (const id of selectedNodeIds()) vscode.postMessage({ type: 'nodeDeleted', nodeId: id });
    clearMultiSel();
    if (selectedEdgeId) vscode.postMessage({ type: 'edgeDeleted', edgeId: selectedEdgeId });
    clearSelection();
  }
  if ((e.key === 'r' || e.key === 'R') && selectedNodeId) {
    e.preventDefault();
    rotateFurniture(selectedNodeId);
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && spaceDown) { spaceDown = false; syncToolUi(); }
});
window.addEventListener('blur', () => { if (spaceDown) { spaceDown = false; syncToolUi(); } });

// ── Edge draw visual feedback ─────────────────────────────────────
function markEdgeDrawSource(id: string) {
  const el = container.querySelector('[data-id="' + id + '"]');
  if (el) el.classList.add('seldia-edge-source');
}
function clearEdgeDrawSource() {
  container.querySelectorAll('.seldia-edge-source').forEach((el) => el.classList.remove('seldia-edge-source'));
}

// ── Rubber-band line + hover target ────
// Once a source node is picked in drawing-edge mode, a dashed line follows
// the cursor from the source node's centre, and whatever node the cursor is
// over highlights as the drop target — mirroring the click-to-click flow's
// eventual endpoint without requiring a drag gesture (drag-from-handle is
// left for a future pass; see docs/improve.md, E4).
let rubberBandLine: SVGLineElement | null = null;

function nodeCenterSvg(id: string): { x: number; y: number } | null {
  const el = container.querySelector('[data-id="' + id + '"][data-type="node"]') as SVGGraphicsElement | null;
  if (!el || !el.getBBox) return null;
  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return null;
  const b = el.getBBox();
  const ctm = el.getCTM();
  if (!ctm) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const pt = svg.createSVGPoint();
  pt.x = b.x + b.width / 2;
  pt.y = b.y + b.height / 2;
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

function clearRubberBand() {
  if (rubberBandLine) {
    rubberBandLine.remove();
    rubberBandLine = null;
  }
  container.querySelectorAll('.seldia-edge-target').forEach((el) => el.classList.remove('seldia-edge-target'));
}

container.addEventListener('mousemove', (e) => {
  if (editMode !== 'drawing-edge' || !edgeDrawSourceId) return;
  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return;
  const from = nodeCenterSvg(edgeDrawSourceId);
  if (!from) return;
  const rect = svg.getBoundingClientRect();
  const upp = svgUnitsPerPixel();
  const vb = svg.viewBox.baseVal;
  const toX = vb.x + (e.clientX - rect.left) * upp;
  const toY = vb.y + (e.clientY - rect.top) * upp;
  if (!rubberBandLine) {
    rubberBandLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rubberBandLine.setAttribute('class', 'edge-draw-line');
    svg.appendChild(rubberBandLine);
  }
  rubberBandLine.setAttribute('x1', String(from.x));
  rubberBandLine.setAttribute('y1', String(from.y));
  rubberBandLine.setAttribute('x2', String(toX));
  rubberBandLine.setAttribute('y2', String(toY));

  const hovered = (e.target as Element).closest('[data-id][data-type="node"]');
  const hoveredId = hovered ? hovered.getAttribute('data-id') : null;
  container.querySelectorAll('.seldia-edge-target').forEach((el) => {
    if (el.getAttribute('data-id') !== hoveredId) el.classList.remove('seldia-edge-target');
  });
  if (hovered && hoveredId !== edgeDrawSourceId) hovered.classList.add('seldia-edge-target');
});

// ── Helper functions ───────────────────────────────────────────────
// DOM-only: clears the data-selected attribute. Does not touch
// interactionState — callers that also need state cleared go through
// dispatchInteraction (ESCAPE, CLICK_EMPTY, etc), which calls this via the
// 'clearSelection' effect.
function clearSelectionDom() {
  if (selectedNodeId) {
    const el = container.querySelector('[data-id="' + selectedNodeId + '"]');
    if (el) el.setAttribute('data-selected', 'false');
  }
  if (selectedEdgeId) {
    const el = container.querySelector('[data-id="' + selectedEdgeId + '"]');
    if (el) el.setAttribute('data-selected', 'false');
  }
}
// Back-compat name for call sites that just want the DOM+state effect in
// contexts outside the reducer (message handler restoring selection, etc).
function clearSelection() {
  clearSelectionDom();
  selectedNodeId = null;
  selectedEdgeId = null;
  interactionState = { ...interactionState, selectedNodeId: null, selectedEdgeId: null };
}

// ── Message Handler (from extension) ───────────────────────────────
let lastInstalledSvg: string | null = null; // first updateContent always installs
let hasGoodSvg = !!container.querySelector('svg');
function setStale(stale: boolean, html = '') {
  isStale = stale;
  container.classList.toggle('seldia-stale', stale);
  const b = document.getElementById('staleBanner');
  if (b) b.innerHTML = stale ? html + ' — Fix the error to edit' : '';
}
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'updateContent': {
      if (decideUpdate(msg, hasGoodSvg) === 'show-stale') {
        // msg.error is pre-escaped by the extension host.
        setStale(true, msg.error || 'Compilation failed');
        const st = document.querySelector('.toolbar .stats');
        if (st && msg.stats) st.textContent = msg.stats;
        break;
      }
      setStale(false);
      hasGoodSvg = !!msg.svg;
      // Incremental re-render: swap the diagram, keep zoom/pan/selection.
      // An unchanged SVG is not re-installed: every innerHTML swap tears
      // down and re-rasterizes the whole subtree, and pointless repaints
      // feed the compositor instability this panel is trying to avoid.
      if (msg.svg && msg.svg === lastInstalledSvg) {
        const statsEl2 = document.querySelector('.toolbar .stats');
        if (statsEl2 && msg.stats) statsEl2.textContent = msg.stats;
        if (msg.ir) {
          irData = msg.ir;
          initFromIR();
        }
        break;
      }
      lastInstalledSvg = msg.svg || null;
      if (msg.svg) {
        container.innerHTML = msg.svg;
      } else {
        // msg.error is pre-escaped by the extension host.
        const div = document.createElement('div');
        div.className = 'error';
        div.innerHTML = msg.error || 'No diagram to render';
        container.innerHTML = '';
        container.appendChild(div);
      }
      const statsEl = document.querySelector('.toolbar .stats');
      if (statsEl && msg.stats) statsEl.textContent = msg.stats;
      if (msg.ir) {
        irData = msg.ir;
        initFromIR();
      }
      // Fresh SVG: re-bridge engine ids to the interaction attributes,
      // re-apply the current zoom/pan and restore selection.
      annotateSvg();
      prepareEdges();
      applyTransform();
      for (const id of [...multiSel]) {
        if (container.querySelector('[data-id="' + cssEsc(id) + '"][data-type="node"]')) markSelected(id, true);
        else multiSel.delete(id);
      }
      if (selectedNodeId) {
        const sel = container.querySelector('[data-id="' + selectedNodeId + '"]');
        if (sel) sel.setAttribute('data-selected', 'true');
        else selectedNodeId = null;
      }
      if (selectedEdgeId) {
        const sel = container.querySelector('[data-id="' + selectedEdgeId + '"]');
        if (sel) { sel.setAttribute('data-selected', 'true'); showEdgeHandles(selectedEdgeId); }
        else selectedEdgeId = null;
      }
      renderPalettes();
      // Explicit add-node: open the label editor on
      // the node that was just added instead of leaving the user to find and
      // double-click it themselves.
      if (msg.focusNodeId) {
        const el = container.querySelector('[data-id="' + msg.focusNodeId + '"]');
        if (el) {
          const textEl = el.querySelector('text');
          openLabelEditor(el, textEl ? textEl.textContent! || '' : '', msg.focusNodeId, 'node');
        }
      }
      // Explicit draw-edge: open the label editor
      // on the edge that was just created, same as add-node does for nodes.
      if (msg.focusEdgeId) {
        const el = container.querySelector('[data-id="' + msg.focusEdgeId + '"]');
        if (el) {
          const textEl = el.querySelector('text');
          openLabelEditor(el, textEl ? textEl.textContent! || '' : '', msg.focusEdgeId, 'edge');
        }
      }
      break;
    }
    case 'updateTheme':
      setThemeUI(msg.theme);
      break;
    case 'selectNode': {
      clearSelection();
      const el = container.querySelector('[data-id="' + msg.nodeId + '"]');
      if (el) {
        selectedNodeId = msg.nodeId;
        el.setAttribute('data-selected', 'true');
      }
      break;
    }
    case 'syncDirty':
      setDirty(msg.dirty);
      break;
    case 'syncUndoRedo':
      (document.getElementById('btnUndo') as HTMLButtonElement).disabled = !msg.canUndo;
      (document.getElementById('btnRedo') as HTMLButtonElement).disabled = !msg.canRedo;
      break;
    case 'setEditMode':
      editMode = msg.mode;
      break;
  }
});
