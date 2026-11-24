/**
 * Shared CSS for flowing (animated) edges and the interactive "trace" highlight.
 * Single source for the Markdown preview, the visual editor and standalone SVG
 * export, so the three can never drift (see docs/PAiRsLike.md).
 *
 * Dash pattern and widths come from DS tokens so the token lint stays clean.
 */
import { DS } from './design-system.js';

/** Dash period of DS.dash.edge ('6 4' → 10). The keyframe shifts one full period per cycle. */
const DASH_PERIOD = DS.dash.edge.split(/\s+/).map(Number).reduce((a, b) => a + b, 0);

/** Loop durations for `animate`, `animate: fast`, `animate: slow`. */
export const FLOW_DURATION = { normal: '0.7s', fast: '0.35s', slow: '1.6s' } as const;

const STROKES = 'path, polyline, line';

/** Keyframes + authored-animation classes. Embedded in SVG output when any edge animates. */
export const FLOW_KEYFRAMES_CSS =
  `@keyframes seldia-flow{to{stroke-dashoffset:-${DASH_PERIOD}}}` +
  `@media (prefers-reduced-motion:no-preference){` +
  `.seldia-flow :is(${STROKES}){animation:seldia-flow ${FLOW_DURATION.normal} linear infinite}` +
  `.seldia-flow-fast :is(${STROKES}){animation-duration:${FLOW_DURATION.fast}}` +
  `.seldia-flow-slow :is(${STROKES}){animation-duration:${FLOW_DURATION.slow}}` +
  `}` +
  // !important: the trace rule (.sd-trace … .sd-on) restarts the animation via the
  // `animation` shorthand at a higher specificity, which reset play-state to running.
  `.seldia-paused :is(${STROKES}){animation-play-state:paused!important}` +
  `@media print{.seldia-flow :is(${STROKES}),.sd-on :is(${STROKES}){animation:none}}` +
  `.seldia-noflow .seldia-flow :is(${STROKES}){animation:none}`;

/**
 * Interactive trace: the host script adds `.sd-trace` on the root <svg> and `.sd-on`
 * on the focused nodes/edges/heads/labels; `.sd-sel` marks the selected element.
 * Only traced edges move — everything else dims (the PAiRS "motion budget").
 */
export const TRACE_CSS =
  `.sd-trace .seldia-edge,.sd-trace .seldia-edge-head,.sd-trace .seldia-edge-label{opacity:.15;transition:opacity .15s}` +
  `.sd-trace .seldia-node{opacity:.4;transition:opacity .15s}` +
  `.sd-trace .seldia-node.sd-on,.sd-trace .seldia-edge.sd-on,.sd-trace .seldia-edge-head.sd-on,.sd-trace .seldia-edge-label.sd-on{opacity:1}` +
  `.sd-trace .seldia-edge.sd-on :is(${STROKES}){stroke-width:${DS.stroke.emphasis};stroke-dasharray:${DS.dash.edge}}` +
  `@media (prefers-reduced-motion:no-preference){.sd-trace:not(.seldia-noflow) .seldia-edge.sd-on :is(${STROKES}){animation:seldia-flow ${FLOW_DURATION.normal} linear infinite}}` +
  `.seldia-node.sd-sel,.seldia-edge.sd-sel{filter:drop-shadow(0 0 3px var(--vscode-focusBorder,#3b82f6))}` +
  `.sd-hit{fill:none;stroke:transparent;stroke-width:18;pointer-events:stroke;cursor:pointer}` +
  `@media (prefers-reduced-motion:reduce){.sd-trace *{transition:none!important}}`;

/** Everything an interactive host (preview / editor) needs. */
export const INTERACTIVE_FLOW_CSS = FLOW_KEYFRAMES_CSS + TRACE_CSS;
