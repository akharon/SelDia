// Interaction trace (PAiRS-like): hover/click a node or edge to light its
// connections. Framework-free; shared by the Markdown preview and the visual
// editor client. Client-side only, never part of exported SVG. See
// docs/PAiRsLike.md. The class contract lives in @seldia/core flow-css.
import { INTERACTIVE_FLOW_CSS } from '@seldia/core/render/flow-css';

export interface EdgeRef { id: string; src: string; tgt: string }
export interface Focus { nodes: Set<string>; edges: Set<string> }
export interface Graph { edges: EdgeRef[]; out: Map<string, EdgeRef[]>; inn: Map<string, EdgeRef[]> }

const CAP = 500;

export function buildGraph(edges: EdgeRef[]): Graph {
  const out = new Map<string, EdgeRef[]>();
  const inn = new Map<string, EdgeRef[]>();
  const push = (m: Map<string, EdgeRef[]>, k: string, e: EdgeRef) => {
    const a = m.get(k);
    if (a) a.push(e);
    else m.set(k, [e]);
  };
  for (const e of edges) {
    push(out, e.src, e);
    push(inn, e.tgt, e);
  }
  return { edges, out, inn };
}

/** Pure focus computation. Node: incident edges + neighbours; with `transitive`
 *  the whole upstream and downstream closure. Edge: itself + endpoints. */
export function computeFocus(g: Graph, t: { node?: string; edge?: string }, transitive = false): Focus {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (t.edge) {
    const e = g.edges.find((x) => x.id === t.edge);
    edges.add(t.edge);
    if (e) { nodes.add(e.src); nodes.add(e.tgt); }
    return { nodes, edges };
  }
  if (!t.node) return { nodes, edges };
  const root = t.node;
  nodes.add(root);
  const walk = (adj: Map<string, EdgeRef[]>, pick: (e: EdgeRef) => string) => {
    const queue = [root];
    const seen = new Set(queue);
    while (queue.length && nodes.size + edges.size < CAP) {
      const n = queue.shift()!;
      for (const e of adj.get(n) ?? []) {
        edges.add(e.id);
        const m = pick(e);
        nodes.add(m);
        if (transitive && !seen.has(m)) { seen.add(m); queue.push(m); }
      }
    }
  };
  walk(g.out, (e) => e.tgt);
  walk(g.inn, (e) => e.src);
  return { nodes, edges };
}

export interface TraceOptions {
  /** Return false to suspend trace (editor drag / non-select tool). */
  enabled?: () => boolean;
  /** Click sets a sticky selection (default true). The editor owns selection itself: pass false. */
  sticky?: boolean;
  /** Inject transparent hit clones (default true). The editor ships its own hit polylines. */
  hitPaths?: boolean;
  /** Focus to fall back to when the pointer leaves a target (the editor's selection). */
  pinned?: () => { node?: string; edge?: string } | null;
}

/** Show `t`'s trace, or clear it when there's nothing to show. */
export function showTrace(svg: SVGSVGElement, t: { node?: string; edge?: string } | null | undefined): void {
  if (t && (t.node || t.edge)) apply(svg, computeFocus(graphOf(svg), t));
  else clearTrace(svg);
}

const attr = (el: Element | null, n: string) => el?.getAttribute(n) ?? '';

function graphOf(svg: SVGSVGElement): Graph {
  const edges: EdgeRef[] = [];
  svg.querySelectorAll('.seldia-edge[data-seldia-edge-id]').forEach((g) =>
    edges.push({ id: attr(g, 'data-seldia-edge-id'), src: attr(g, 'data-src'), tgt: attr(g, 'data-tgt') }));
  return buildGraph(edges);
}

function targetOf(svg: SVGSVGElement, el: Element | null): { node?: string; edge?: string } | null {
  const n = el?.closest?.('.seldia-node[data-seldia-node-id]');
  if (n && svg.contains(n)) return { node: attr(n, 'data-seldia-node-id') };
  const e = el?.closest?.('.seldia-edge, .seldia-edge-head, .seldia-edge-label');
  if (e && svg.contains(e)) return { edge: attr(e, 'data-seldia-edge-id') || attr(e, 'data-seldia-edge-ref') };
  return null;
}

export function clearTrace(svg: SVGSVGElement): void {
  svg.classList.remove('sd-trace');
  svg.querySelectorAll('.sd-on, .sd-sel').forEach((el) => el.classList.remove('sd-on', 'sd-sel'));
}

function apply(svg: SVGSVGElement, f: Focus): void {
  svg.querySelectorAll('.sd-on').forEach((el) => el.classList.remove('sd-on'));
  svg.querySelectorAll('.seldia-node[data-seldia-node-id]').forEach((el) => {
    if (f.nodes.has(attr(el, 'data-seldia-node-id'))) el.classList.add('sd-on');
  });
  svg.querySelectorAll('.seldia-edge[data-seldia-edge-id], [data-seldia-edge-ref]').forEach((el) => {
    if (f.edges.has(attr(el, 'data-seldia-edge-id') || attr(el, 'data-seldia-edge-ref'))) el.classList.add('sd-on');
  });
  svg.classList.add('sd-trace');
}

/** Mirror an external selection (editor) as `.sd-sel`. */
export function markSelection(svg: SVGSVGElement, ids: { node?: string | null; edge?: string | null }): void {
  svg.querySelectorAll('.sd-sel').forEach((el) => el.classList.remove('sd-sel'));
  svg.querySelectorAll('[data-seldia-node-id], [data-seldia-edge-id]').forEach((el) => {
    const id = attr(el, 'data-seldia-node-id') || attr(el, 'data-seldia-edge-id');
    if (id && (id === ids.node || id === ids.edge)) el.classList.add('sd-sel');
  });
}

/** Add transparent, wider hit paths so thin edges are hoverable. Idempotent. */
export function addHitPaths(svg: SVGSVGElement): void {
  svg.querySelectorAll('.seldia-edge').forEach((g) => {
    if (g.querySelector('.sd-hit')) return;
    const line = g.querySelector('path, polyline');
    if (!line) return;
    const hit = line.cloneNode(false) as SVGElement;
    for (const a of ['id', 'class', 'style', 'marker-end', 'marker-start', 'stroke', 'stroke-width', 'stroke-dasharray'])
      hit.removeAttribute(a);
    hit.setAttribute('class', 'sd-hit');
    g.appendChild(hit);
  });
}

/** Install hover/click trace on a rendered SVG. Re-installing is a no-op. */
export function installTrace(svg: SVGSVGElement, opts: TraceOptions = {}): void {
  if (svg.dataset.sdTrace) return;
  svg.dataset.sdTrace = '1';
  svg.classList.add('sd-interactive');
  if (opts.hitPaths !== false) addHitPaths(svg);
  const sticky = opts.sticky !== false;
  const on = () => !opts.enabled || opts.enabled();
  let locked = false;
  let down: { x: number; y: number } | null = null;

  const show = (el: Element | null, transitive: boolean) => {
    const t = targetOf(svg, el);
    if (!t) return false;
    apply(svg, computeFocus(graphOf(svg), t, transitive));
    return true;
  };

  const rest = () => showTrace(svg, opts.pinned?.());
  svg.addEventListener('mouseover', (e) => {
    if (locked || !on()) return;
    if (!show(e.target as Element, e.shiftKey)) rest();
  });
  svg.addEventListener('mouseleave', () => {
    if (!locked) rest();
  });
  svg.addEventListener('mousedown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  svg.addEventListener('click', (e) => {
    if (!sticky || !on()) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // pan drag
    const el = e.target as Element;
    if (!show(el, e.shiftKey)) {
      locked = false;
      clearTrace(svg);
      return;
    }
    locked = true;
    markSelection(svg, targetOf(svg, el)!);
  });
  const onKey = (e: KeyboardEvent) => {
    if (!svg.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'Escape' && locked) {
      locked = false;
      clearTrace(svg);
    }
  };
  document.addEventListener('keydown', onKey);
}

const CLIENT_CLASSES = ['sd-interactive', 'sd-trace', 'sd-on', 'sd-sel', 'seldia-paused'];

/** Remove client-only artifacts (hit clones, trace/selection/pause classes,
 *  injected stylesheet) from a CLONED svg before serializing it for export. */
export function stripClientArtifacts<T extends Element>(clone: T): T {
  clone.querySelectorAll('.sd-hit, #seldia-flow-css').forEach((n) => n.remove());
  const els = [clone, ...Array.from(clone.querySelectorAll('.' + CLIENT_CLASSES.join(', .')))];
  for (const el of els) {
    el.classList.remove(...CLIENT_CLASSES);
    if (!el.getAttribute('class')) el.removeAttribute('class');
  }
  clone.removeAttribute('data-sd-trace');
  return clone;
}

/** Inject the shared interactive stylesheet once per document. */
export function ensureFlowCss(doc: Document = document): void {
  if (doc.getElementById('seldia-flow-css')) return;
  const s = doc.createElement('style');
  s.id = 'seldia-flow-css';
  s.textContent = INTERACTIVE_FLOW_CSS;
  doc.head.appendChild(s);
}
