// Glowing-light walk: the third state of the animation button (paused → play →
// glow). A dot of light travels each edge from source to target and leaves it
// lit; unvisited edges stay dim until the light reaches them.
//   • Graph diagrams fan out: every outgoing edge of a node starts when the
//     light first reaches that node, so the light multiplies at junctions.
//   • Sequence diagrams play their messages one after another, in order.
// The whole schedule is planned up front (planGlowWalk, pure and tested), and
// each frame is a stateless function of elapsed time. Shared by the Markdown
// preview and the visual editor. Client-side only: stripClientArtifacts
// removes everything it adds before export.

export type AnimMode = 'paused' | 'play' | 'glow';

/** Button cycle: paused → play → glow → paused. Glow is skipped when the diagram has nothing to walk. */
export function nextAnimMode(mode: AnimMode, canGlow: boolean): AnimMode {
  if (mode === 'paused') return 'play';
  if (mode === 'play' && canGlow) return 'glow';
  return 'paused';
}

/** What a click does, keyed by the state it switches to. */
const ACTION: Record<AnimMode, string> = { play: 'Play animations', glow: 'Glowing light', paused: 'Pause animations' };

/** Show the NEXT state's glyph (like the old play/pause toggle did). CSS keys off data-next. */
export function syncAnimButton(btn: Element | null, mode: AnimMode, canGlow: boolean): void {
  if (!btn) return;
  const next = nextAnimMode(mode, canGlow);
  btn.setAttribute('data-anim', mode);
  btn.setAttribute('data-next', next);
  btn.setAttribute('title', ACTION[next]);
  btn.setAttribute('aria-label', ACTION[next]);
}

// ── Plan ───────────────────────────────────────────────────────────────────
export interface WalkEdge { id: string; src: string; tgt: string; dur: number }
export interface WalkStep { id: string; start: number; end: number }

export const GAP_MS = 120;

/**
 * When each edge's light starts and arrives. Ordered: one after another.
 * Otherwise an edge starts at the first arrival at its source (Dijkstra over
 * durations), so each edge is walked exactly once per cycle and cycles end.
 * Components no root reaches (pure cycles) are seeded after the rest finish.
 */
export function planGlowWalk(edges: WalkEdge[], ordered: boolean): WalkStep[] {
  if (ordered) {
    let t = 0;
    return edges.map((e) => {
      const s = { id: e.id, start: t, end: t + e.dur };
      t = s.end + GAP_MS;
      return s;
    });
  }
  const out = new Map<string, WalkEdge[]>();
  const targets = new Set<string>();
  for (const e of edges) {
    const a = out.get(e.src);
    if (a) a.push(e);
    else out.set(e.src, [e]);
    targets.add(e.tgt);
  }
  const steps = new Map<string, WalkStep>();
  const settled = new Set<string>();
  const dist = new Map<string, number>();
  let last = 0;

  const run = (seeds: string[], t0: number) => {
    for (const s of seeds) if (!settled.has(s) && !dist.has(s)) dist.set(s, t0);
    for (;;) {
      let n: string | undefined;
      for (const [k, d] of dist) if (!settled.has(k) && (n === undefined || d < dist.get(n)!)) n = k;
      if (n === undefined) return;
      settled.add(n);
      const t = dist.get(n)!;
      for (const e of out.get(n) ?? []) {
        if (steps.has(e.id)) continue;
        const end = t + e.dur;
        steps.set(e.id, { id: e.id, start: t, end });
        last = Math.max(last, end);
        if (!settled.has(e.tgt) && (dist.get(e.tgt) ?? Infinity) > end) dist.set(e.tgt, end);
      }
    }
  };

  const roots = [...new Set(edges.map((e) => e.src))].filter((n) => !targets.has(n));
  run(roots, 0);
  for (const e of edges) if (!steps.has(e.id)) run([e.src], steps.size ? last + GAP_MS : 0);
  return edges.map((e) => steps.get(e.id)!);
}

// ── DOM ────────────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
const SPEED = 0.26; // user units per ms
const MIN_MS = 350;
const MAX_MS = 1800;
const HOLD_MS = 1400; // everything lit before the cycle restarts
const REST_MS = 600; // everything dim before the next cycle
const PATH_SEL = ':is(path, polyline)[fill="none"]:not(.sd-glow-halo):not([class*="hit"]), line:not([class*="hit"])';
const EDGE_SEL = '.seldia-edge[data-seldia-edge-id][data-src][data-tgt]';

interface Seg {
  step: WalkStep;
  g: Element;
  path: SVGGeometryElement;
  len: number;
  rev: boolean;
  color: string;
  refs: Element[];
  src: Element[];
  tgt: Element[];
  halo?: SVGGeometryElement;
  dot?: SVGGElement;
  state: 0 | 1 | 2; // dim | walking | lit
}

/** Whether the diagram has edges the light can walk (cheap, no layout). */
export function canGlowWalk(svg: Element | null): boolean {
  return !!svg?.querySelector(`${EDGE_SEL} :is(${PATH_SEL})`);
}

const walkers = new WeakMap<SVGSVGElement, () => void>();

/** Start or stop the walk on one rendered svg. Idempotent. */
export function setGlowWalk(svg: SVGSVGElement, on: boolean): void {
  const stop = walkers.get(svg);
  if (on && !stop) walkers.set(svg, startWalk(svg));
  else if (!on && stop) {
    stop();
    walkers.delete(svg);
  }
}

/** Is the path drawn target→source? Compare its start with the routed endpoints. */
function reversed(g: Element, path: SVGGeometryElement): boolean {
  const pts = (g.getAttribute('data-route') || '').trim().split(/\s+/).map((p) => p.split(',').map(Number));
  if (pts.length < 2 || pts.some((p) => p.length < 2 || p.some(isNaN))) return false;
  const pad = Number(g.getAttribute('data-pad')) || 0;
  const a = path.getPointAtLength(0);
  const d = (p: number[]) => Math.hypot(a.x - p[0] - pad, a.y - p[1] - pad);
  return d(pts[pts.length - 1]) < d(pts[0]);
}

function colorOf(path: Element): string {
  const c = getComputedStyle(path).stroke;
  return c && c !== 'none' && !c.startsWith('url') ? c : '#22d3ee';
}

function collect(svg: SVGSVGElement): Seg[] {
  const byNode = new Map<string, Element[]>();
  svg.querySelectorAll('.seldia-node[data-seldia-node-id]').forEach((el) => {
    const id = el.getAttribute('data-seldia-node-id')!;
    byNode.set(id, [...(byNode.get(id) ?? []), el]);
  });
  const byRef = new Map<string, Element[]>();
  svg.querySelectorAll('[data-seldia-edge-ref]').forEach((el) => {
    const id = el.getAttribute('data-seldia-edge-ref')!;
    byRef.set(id, [...(byRef.get(id) ?? []), el]);
  });
  const raw: (Omit<Seg, 'step'> & { e: WalkEdge })[] = [];
  svg.querySelectorAll(EDGE_SEL).forEach((g) => {
    const path = g.querySelector<SVGGeometryElement>(PATH_SEL);
    if (!path || typeof path.getTotalLength !== 'function') return;
    let len = 0;
    try { len = path.getTotalLength(); } catch { return; }
    if (!(len > 1)) return;
    const id = g.getAttribute('data-seldia-edge-id')!;
    const src = g.getAttribute('data-src')!;
    const tgt = g.getAttribute('data-tgt')!;
    raw.push({
      e: { id, src, tgt, dur: Math.min(MAX_MS, Math.max(MIN_MS, len / SPEED)) },
      g, path, len, rev: reversed(g, path), color: colorOf(path),
      refs: byRef.get(id) ?? [], src: byNode.get(src) ?? [], tgt: byNode.get(tgt) ?? [], state: 0,
    });
  });
  const plan = planGlowWalk(raw.map((r) => r.e), svg.getAttribute('data-seldia-type') === 'sequence');
  return raw.map(({ e: _e, ...r }, i) => ({ ...r, step: plan[i] }));
}

function makeDot(color: string): SVGGElement {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'sd-glow-dot');
  g.style.setProperty('--sd-glow', color);
  for (const [r, fill, op] of [[7, color, 0.3], [4, color, 1], [1.8, '#ffffff', 0.9]] as const) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(r));
    c.setAttribute('fill', fill);
    c.setAttribute('opacity', String(op));
    g.appendChild(c);
  }
  return g;
}

function makeHalo(s: Seg): SVGGeometryElement {
  const h = s.path.cloneNode(false) as SVGGeometryElement;
  for (const a of ['id', 'class', 'style', 'marker-end', 'marker-start', 'marker-mid', 'stroke-dasharray', 'stroke-width'])
    h.removeAttribute(a);
  h.setAttribute('class', 'sd-glow-halo');
  h.setAttribute('stroke', s.color);
  h.style.strokeDasharray = `${s.len} ${s.len}`;
  s.g.insertBefore(h, s.g.firstChild);
  return h;
}

function startWalk(svg: SVGSVGElement): () => void {
  svg.classList.add('sd-glowwalk');
  const layer = document.createElementNS(NS, 'g');
  layer.setAttribute('class', 'sd-glow-layer');
  svg.appendChild(layer);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let segs: Seg[] = [];
  let total = 0;
  let t0 = 0;
  let raf = 0;
  let stopped = false;

  const lit = (els: Element[], on: boolean) => els.forEach((el) => el.classList.toggle('sd-lit', on));
  const reset = () => {
    for (const s of segs) {
      s.halo?.remove();
      s.dot?.remove();
    }
    svg.querySelectorAll('.sd-lit').forEach((el) => el.classList.remove('sd-lit'));
    segs = [];
  };
  const begin = (now: number) => {
    reset();
    segs = collect(svg);
    total = segs.reduce((m, s) => Math.max(m, s.step.end), 0);
    t0 = now;
  };

  const frame = (now: number) => {
    raf = 0;
    if (stopped) return;
    if (!svg.isConnected) return stop();
    let t = now - t0;
    if (!segs.length || t >= total + HOLD_MS + REST_MS || segs.some((s) => !s.path.isConnected)) {
      begin(now);
      t = 0;
    }
    const root = svg.getScreenCTM();
    const resting = t >= total + HOLD_MS;
    // Node lighting: a node is lit once any of its edges has started (source) or arrived (target).
    const nodes = new Map<Element, boolean>();
    for (const s of segs) {
      const state: 0 | 1 | 2 = resting || t < s.step.start ? 0 : t < s.step.end ? 1 : 2;
      for (const n of s.src) nodes.set(n, nodes.get(n) || state > 0);
      for (const n of s.tgt) nodes.set(n, nodes.get(n) || state === 2);
      if (state !== s.state) {
        s.state = state;
        s.g.classList.toggle('sd-lit', state > 0);
        lit(s.refs, state > 0);
        if (state > 0 && !s.halo) s.halo = makeHalo(s);
        if (state === 0) { s.halo?.remove(); s.halo = undefined; }
        if (state === 1 && !s.dot) layer.appendChild((s.dot = makeDot(s.color)));
        if (state !== 1) { s.dot?.remove(); s.dot = undefined; }
      }
      if (!s.halo) continue;
      const f = state === 2 ? 1 : (t - s.step.start) / (s.step.end - s.step.start);
      const off = s.len * (1 - f);
      s.halo.style.strokeDashoffset = String(s.rev ? -off : off);
      if (s.dot) {
        const pt = s.path.getPointAtLength(s.rev ? s.len * (1 - f) : s.len * f);
        const m = root && s.path.getScreenCTM();
        const p = m && root ? pt.matrixTransform(root.inverse().multiply(m)) : pt;
        s.dot.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
      }
    }
    for (const [n, on] of nodes) n.classList.toggle('sd-lit', on);
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    reset();
    layer.remove();
    svg.classList.remove('sd-glowwalk');
    walkers.delete(svg);
  };

  if (still) {
    // Reduced motion: no travelling light, just the fully lit end state.
    segs = collect(svg);
    for (const s of segs) {
      s.halo = makeHalo(s);
      s.halo.style.strokeDashoffset = '0';
      lit([s.g, ...s.refs, ...s.src, ...s.tgt], true);
    }
  } else raf = requestAnimationFrame(frame);
  return stop;
}
