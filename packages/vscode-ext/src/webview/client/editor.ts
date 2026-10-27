// =============================================================================
// SelDiA — Visual editor webview client
// =============================================================================
// Runs inside the panel's webview (browser context, no vscode API except
// acquireVsCodeApi()). Bundled by esbuild into media/editor.js and loaded via
// asWebviewUri + a nonce'd <script> tag from provider.ts's getHtmlContent.
// Extracted from the inline <script> that used to live in that template
// literal (see docs/next_steps.md §3.2 step 0.1) — behavior is unchanged,
// only the packaging moved. Initial IR/theme now arrive via
// window.__seldiaInit instead of template interpolation.
// =============================================================================

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
const vscode = acquireVsCodeApi();
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

/** Draw a dimension-style line from the dragged box's near edge to the
 *  nearest obstacle edge that overlaps it on the perpendicular axis —
 *  i.e. "what's directly above/below/left/right of me right now". */
function fpGuideToNearest(g: Element, box: FpBox, obstacles: FpBox[], axis: 'x' | 'y') {
  // axis 'y': measure vertically (up/down) to something overlapping in x.
  // axis 'x': measure horizontally (left/right) to something overlapping in y.
  const horiz = axis === 'x';
  let best: FpBox | null = null,
    bestGap = Infinity,
    bestSide: string | null = null;
  for (const o of obstacles) {
    const overlaps = horiz ? box.y < o.y + o.h && box.y + box.h > o.y : box.x < o.x + o.w && box.x + box.w > o.x;
    if (!overlaps) continue;
    if (horiz) {
      const gapRight = o.x - (box.x + box.w);
      const gapLeft = box.x - (o.x + o.w);
      if (gapRight >= 0 && gapRight < bestGap) {
        bestGap = gapRight;
        best = o;
        bestSide = 'right';
      }
      if (gapLeft >= 0 && gapLeft < bestGap) {
        bestGap = gapLeft;
        best = o;
        bestSide = 'left';
      }
    } else {
      const gapDown = o.y - (box.y + box.h);
      const gapUp = box.y - (o.y + o.h);
      if (gapDown >= 0 && gapDown < bestGap) {
        bestGap = gapDown;
        best = o;
        bestSide = 'down';
      }
      if (gapUp >= 0 && gapUp < bestGap) {
        bestGap = gapUp;
        best = o;
        bestSide = 'up';
      }
    }
  }
  if (!best || !isFinite(bestGap)) return;
  const midY = Math.max(box.y, best.y) / 2 + Math.min(box.y + box.h, best.y + best.h) / 2;
  const midX = Math.max(box.x, best.x) / 2 + Math.min(box.x + box.w, best.x + best.w) / 2;
  let x1: number, y1: number, x2: number, y2: number;
  if (bestSide === 'right') {
    y1 = y2 = midY;
    x1 = box.x + box.w;
    x2 = best.x;
  } else if (bestSide === 'left') {
    y1 = y2 = midY;
    x1 = best.x + best.w;
    x2 = box.x;
  } else if (bestSide === 'down') {
    x1 = x2 = midX;
    y1 = box.y + box.h;
    y2 = best.y;
  } else {
    x1 = x2 = midX;
    y1 = best.y + best.h;
    y2 = box.y;
  }
  fpLine(g, x1, y1, x2, y2, 'fp-guide-line');
  const vertical = bestSide === 'up' || bestSide === 'down';
  for (const [tx, ty] of [
    [x1, y1],
    [x2, y2],
  ]) {
    fpLine(
      g,
      tx - (vertical ? FP_TICK : 0),
      ty - (vertical ? 0 : FP_TICK),
      tx + (vertical ? FP_TICK : 0),
      ty + (vertical ? 0 : FP_TICK),
      'fp-guide-tick'
    );
  }
  const gap = Math.hypot(x2 - x1, y2 - y1);
  fpLabel(g, (x1 + x2) / 2, (y1 + y2) / 2, fpFormatLen(gap), vertical);
}

function updateFpDragGuides(svg: SVGSVGElement, el: Element, tx: number, ty: number) {
  const bb = (el as unknown as SVGGraphicsElement).getBBox(); // el already carries the ghost transform
  const box: FpBox = { x: bb.x + tx, y: bb.y + ty, w: bb.width, h: bb.height, kind: 'drag' };
  const obstacles = fpObstacles(svg, el.getAttribute('data-id'));
  const g = fpGuideGroup(svg);
  g.textContent = '';
  fpGuideToNearest(g, box, obstacles, 'y'); // vertical line: nearest above/below
  fpGuideToNearest(g, box, obstacles, 'x'); // horizontal line: nearest left/right
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

container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = container.getBoundingClientRect();
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 0.9 : 1.1);
});

container.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    isPanning = true;
    panStartX = e.clientX - offsetX;
    panStartY = e.clientY - offsetY;
    e.preventDefault();
    return;
  }
});

document.addEventListener('mousemove', (e) => {
  if (isPanning) {
    offsetX = e.clientX - panStartX;
    offsetY = e.clientY - panStartY;
    applyTransform();
    return;
  }
});

document.addEventListener('mouseup', () => {
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
window.zoomIn = () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1.3);
window.zoomOut = () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1 / 1.3);
window.resetZoom = () => {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  applyTransform();
};
window.fitToScreen = () => {
  const svg = container.querySelector('svg');
  if (!svg) return;
  const vb = svg.getAttribute('viewBox') || '0 0 800 600';
  const parts = vb.split(' ');
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const sx = cw / parseFloat(parts[2]);
  const sy = ch / parseFloat(parts[3]);
  scale = Math.min(sx, sy) * 0.9;
  offsetX = (cw - parseFloat(parts[2]) * scale) / 2;
  offsetY = (ch - parseFloat(parts[3]) * scale) / 2;
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
        break;
      }
      case 'clearSelection':
        clearSelectionDom();
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
        // Visible mode banner (arch.md §9.4.5): the toolbar button alone is
        // easy to miss, so say explicitly what clicking will do next.
        modeBanner.style.display = eff.active ? 'block' : 'none';
        modeBanner.textContent = eff.active ? 'Click source node, then target node — Esc to cancel' : '';
        // Crosshair cursor for the whole canvas while in draw mode
        // (next_steps.md Step 3.2); cleared here so ESCAPE/TOGGLE_EDGE_DRAW
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

// ── Node Dragging ──────────────────────────────────────────────────
let dragUnitsPerPx = 1; // captured at drag start; scale can't change mid-drag
let dragIsFloorplan = false;

container.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.shiftKey || isPanning) return;
  const target = (e.target as Element).closest('[data-id][data-type="node"]');
  if (!target) return;
  const id = target.getAttribute('data-id')!;
  dragNodeId = id;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragUnitsPerPx = svgUnitsPerPixel();
  isDragging = false;
  const svg = container.querySelector('svg');
  dragIsFloorplan = !!(svg && svg.querySelector('.seldia-floorplan-walls'));
});

document.addEventListener('mousemove', (e) => {
  if (!dragNodeId) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (!isDragging) {
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      isDragging = true;
    }
    return;
  }

  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (svg) {
    const el = svg.querySelector('[data-id="' + dragNodeId + '"]');
    if (el) {
      // The ghost translate is in SVG user units, so it must track the
      // cursor exactly regardless of zoom / CSS scaling.
      const tx = dx * dragUnitsPerPx,
        ty = dy * dragUnitsPerPx;
      el.setAttribute('transform', 'translate(' + tx + ', ' + ty + ')');
      if (dragIsFloorplan) updateFpDragGuides(svg, el, tx, ty);
    }
  }
});

document.addEventListener('mouseup', (e) => {
  if (dragNodeId && isDragging) {
    const oldPos = nodePositions[dragNodeId];
    if (oldPos) {
      const nx = oldPos.x + (e.clientX - dragStartX) * dragUnitsPerPx;
      const ny = oldPos.y + (e.clientY - dragStartY) * dragUnitsPerPx;
      vscode.postMessage({
        type: 'nodeDragged',
        nodeId: dragNodeId,
        oldPosition: { x: oldPos.x, y: oldPos.y },
        newPosition: { x: nx, y: ny },
      });
      nodePositions[dragNodeId] = { x: nx, y: ny };
    }
    suppressNextClick = true; // the click event that follows must not clear the selection
  }
  dragNodeId = null;
  isDragging = false;
  clearFpDragGuides();
});

// ── Label Editor ───────────────────────────────────────────────────
const labelEditor = document.getElementById('labelEditor')!;
let editTargetId: string | null = null;
let editTargetType: string | null = null;
let editOldLabel = '';

function openLabelEditor(relativeTo: Element, currentLabel: string, id: string, type: string) {
  const rect = relativeTo.getBoundingClientRect();
  labelEditor.style.display = 'block';
  labelEditor.style.left = rect.left + 10 + 'px';
  labelEditor.style.top = rect.top + 10 + 'px';
  labelEditor.textContent = currentLabel;
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
    e.preventDefault();
    labelEditor.style.display = 'none';
  }
});

function finishLabelEdit() {
  const newLabel = labelEditor.textContent!.trim();
  labelEditor.style.display = 'none';
  if (editTargetId && newLabel && newLabel !== editOldLabel) {
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
// template regardless of diagram type (next_steps.md Step 2/3).
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
  if (!nodePalette.contains(e.target as Node) && e.target !== btnAddNode) {
    nodePalette.style.display = 'none';
    btnAddNode.setAttribute('aria-expanded', 'false');
  }
  if (!edgePalette.contains(e.target as Node) && e.target !== btnAddEdge) {
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
};
let currentTheme = window.__seldiaInit.theme;
function setThemeUI(t: string) {
  currentTheme = t;
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
  const s = new XMLSerializer().serializeToString(svgEl);
  const b = new Blob([s], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'diagram.svg';
  a.click();
  URL.revokeObjectURL(a.href);
};

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
  if (e.key === 'Escape') {
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
  if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNodeId || selectedEdgeId)) {
    e.preventDefault();
    if (selectedNodeId) vscode.postMessage({ type: 'nodeDeleted', nodeId: selectedNodeId });
    if (selectedEdgeId) vscode.postMessage({ type: 'edgeDeleted', edgeId: selectedEdgeId });
    clearSelection();
  }
  if ((e.key === 'r' || e.key === 'R') && selectedNodeId) {
    e.preventDefault();
    rotateFurniture(selectedNodeId);
  }
});

// ── Edge draw visual feedback ─────────────────────────────────────
function markEdgeDrawSource(id: string) {
  const el = container.querySelector('[data-id="' + id + '"]');
  if (el) el.classList.add('seldia-edge-source');
}
function clearEdgeDrawSource() {
  container.querySelectorAll('.seldia-edge-source').forEach((el) => el.classList.remove('seldia-edge-source'));
}

// ── Rubber-band line + hover target (next_steps.md Step 3.1/3.2) ────
// Once a source node is picked in drawing-edge mode, a dashed line follows
// the cursor from the source node's centre, and whatever node the cursor is
// over highlights as the drop target — mirroring the click-to-click flow's
// eventual endpoint without requiring a drag gesture (drag-from-handle is
// left for a future pass; see next_steps.md).
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
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'updateContent': {
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
      applyTransform();
      if (selectedNodeId) {
        const sel = container.querySelector('[data-id="' + selectedNodeId + '"]');
        if (sel) sel.setAttribute('data-selected', 'true');
        else selectedNodeId = null;
      }
      if (selectedEdgeId) {
        const sel = container.querySelector('[data-id="' + selectedEdgeId + '"]');
        if (sel) sel.setAttribute('data-selected', 'true');
        else selectedEdgeId = null;
      }
      renderPalettes();
      // Explicit add-node (next_steps.md Step 2.2): open the label editor on
      // the node that was just added instead of leaving the user to find and
      // double-click it themselves.
      if (msg.focusNodeId) {
        const el = container.querySelector('[data-id="' + msg.focusNodeId + '"]');
        if (el) {
          const textEl = el.querySelector('text');
          openLabelEditor(el, textEl ? textEl.textContent! || '' : '', msg.focusNodeId, 'node');
        }
      }
      // Explicit draw-edge (next_steps.md Step 3.4): open the label editor
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
