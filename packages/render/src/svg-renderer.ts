// =============================================================================
// SelDiA — SVG Renderer Implementation with Rough.js-style paths
// =============================================================================

import type { LayoutResult, IRNode, IREdge } from '@seldia/core/ir/types';
import type { Rect, Point } from '@seldia/core/types/common';
import type { Theme, NodeStyle, EdgeStyle } from '@seldia/core/types/style';
import type { RenderEngine, RenderOptions, RenderOutput } from './types.js';
import {
  SeededRandom,
  roughRectangle,
  roughPolygon,
  roughEllipse,
  roughPolyline,
  roughArc,
} from './rough/index.js';

export class SvgRenderer implements RenderEngine {
  readonly id = 'svg-default';
  readonly name = 'SVG Renderer';

  async render(layoutResult: LayoutResult, options: Partial<RenderOptions>): Promise<RenderOutput> {
    const { nodes, edges } = layoutResult.diagram;
    const theme = options.theme || this.defaultTheme();
    const sketchy = options.sketchy ?? theme.sketchy ?? true;
    const pad = 20;
    const bounds = this.computeBounds(nodes);
    const bw = bounds.width + pad * 2, bh = bounds.height + pad * 2;
    const bg = theme.palette.background || '#ffffff';

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bw} ${bh}" width="${bw}" height="${bh}">\n`;
    svg += `  <defs>\n    <filter id="sketch"><feTurbulence type="turbulence" baseFrequency="0.03" numOctaves="2" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="${sketchy ? 2 : 0}" xChannelSelector="R" yChannelSelector="G"/></filter>\n  </defs>\n`;
    svg += `  <rect width="${bw}" height="${bh}" fill="${bg}" rx="8"/>\n`;
    const start = performance.now();
    for (const e of edges) svg += this.renderEdge(e, pad, theme, sketchy);
    for (const n of nodes) svg += this.renderNode(n, pad, theme, sketchy);
    svg += '</svg>';
    const elapsed = performance.now() - start;

    return { content: svg, mimeType: 'image/svg+xml', width: bw, height: bh, stats: { nodeCount: nodes.length, edgeCount: edges.length, groupCount: layoutResult.diagram.groups.length, renderTimeMs: elapsed } };
  }

  private renderNode(node: IRNode, pad: number, theme: Theme, sketchy: boolean): string {
    const x = node.position.x + pad, y = node.position.y + pad, w = node.size.width, h = node.size.height;
    const cx = x + w / 2, cy = y + h / 2;
    const d = theme.node || {};
    const s = node.style || {} as any;
    const fill = s.fill || d.fill || '#e8f4f8';
    const stroke = s.stroke || d.stroke || '#2c3e50';
    const sw = s.strokeWidth || d.strokeWidth || 2;
    const color = s.textColor || d.textColor || '#2c3e50';
    const fs = s.fontSize || d.fontSize || 14;
    const ff = s.fontFamily || d.fontFamily || 'Inter, sans-serif';
    const roughness = sketchy ? (s.roughness || d.roughness || 1.2) : 0;
    const bowing = sketchy ? (s.bowing || d.bowing || 1.5) : 0;
    const fillStyle = s.fillStyle || d.fillStyle || 'solid';
    const rng = new SeededRandom(node.id.length + 42);

    let el = '';
    const commonFill = `fill="${fill}"`;
    const commonStroke = `stroke="${stroke}" stroke-width="${sw}"`;
    const fillOpacity = s.opacity ?? 1;
    const fid = `rough-${node.id.replace(/[^a-zA-Z0-9]/g, '')}`;

    if (sketchy && roughness > 0) {
      // ── Rough/Hand-drawn rendering ──────────────────────────────────
      switch (node.shape) {
        case 'diamond': {
          const pts: [number, number][] = [[cx, y], [x + w, cy], [cx, y + h], [x, cy]];
          const path = roughPolygon(pts, rng, { roughness, bowing, strokeWidth: sw });
          el = `    <path d="${path}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9" filter="url(#sketch)"/>\n`;
          break;
        }
        case 'circle': {
          const path = roughEllipse(cx, cy, w / 2, h / 2, rng, { roughness, bowing, strokeWidth: sw });
          el = `    <path d="${path}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9" filter="url(#sketch)"/>\n`;
          break;
        }
        case 'hexagon': {
          const pts: [number, number][] = [
            [cx, y], [x + w, y + h * 0.25], [x + w, y + h * 0.75],
            [cx, y + h], [x, y + h * 0.75], [x, y + h * 0.25],
          ];
          const path = roughPolygon(pts, rng, { roughness, bowing, strokeWidth: sw });
          el = `    <path d="${path}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9" filter="url(#sketch)"/>\n`;
          break;
        }
        case 'parallelogram': {
          const pts: [number, number][] = [[x + 15, y], [x + w, y], [x + w - 15, y + h], [x, y + h]];
          const path = roughPolygon(pts, rng, { roughness, bowing, strokeWidth: sw });
          el = `    <path d="${path}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9" filter="url(#sketch)"/>\n`;
          break;
        }
        case 'cylinder': {
          const ry = 12;
          const rectPath = roughRectangle(x, y + ry, w, h - ry * 2, rng, { roughness, bowing: bowing * 0.5, strokeWidth: sw });
          const topArc = roughArc(cx, y + ry, w / 2, Math.PI, 0, rng, { roughness, bowing: bowing * 0.5, strokeWidth: sw });
          const botArc = roughArc(cx, y + h - ry, w / 2, 0, Math.PI, rng, { roughness, bowing: bowing * 0.5, strokeWidth: sw });
          el = `    <path d="${rectPath}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
          el += `    <path d="${topArc}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
          el += `    <path d="${botArc}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
          break;
        }
        case 'actor': {
          const r = Math.min(w, h * 0.3) / 2;
          const headPath = roughEllipse(cx, y + r + 4, r, r, rng, { roughness, bowing, strokeWidth: sw });
          el = `    <path d="${headPath}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" filter="url(#sketch)"/>\n`;
          el += `    <line x1="${cx}" y1="${y + r * 2 + 8}" x2="${cx}" y2="${y + h * 0.6}" stroke="${stroke}" stroke-width="${sw}" filter="url(#sketch)"/>\n`;
          el += `    <line x1="${x + 10}" y1="${y + h * 0.4}" x2="${x + w - 10}" y2="${y + h * 0.4}" stroke="${stroke}" stroke-width="${sw}" filter="url(#sketch)"/>\n`;
          el += `    <line x1="${cx - w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}" filter="url(#sketch)"/>\n`;
          el += `    <line x1="${cx + w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}" filter="url(#sketch)"/>\n`;
          el += `    <text x="${cx}" y="${y + h - 6}" text-anchor="middle" fill="${color}" font-size="${Math.min(fs, 11)}" font-family="${ff}">${this.esc(node.label)}</text>\n`;
          return el;
        }
        case 'cloud':
          el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="25" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="4,4" opacity="0.9" filter="url(#sketch)"/>\n`;
          break;
        default: {
          const path = roughRectangle(x, y, w, h, rng, { roughness, bowing, strokeWidth: sw });
          el = `    <path d="${path}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9" filter="url(#sketch)"/>\n`;
          break;
        }
      }
    } else {
      // ── Smooth/clean rendering ─────────────────────────────────────
      switch (node.shape) {
        case 'diamond':
          el = `    <polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
          break;
        case 'circle':
          el = `    <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
          break;
        case 'hexagon':
          el = `    <polygon points="${cx},${y} ${x + w},${y + h * 0.25} ${x + w},${y + h * 0.75} ${cx},${y + h} ${x},${y + h * 0.75} ${x},${y + h * 0.25}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
          break;
        case 'parallelogram':
          el = `    <polygon points="${x + 15},${y} ${x + w},${y} ${x + w - 15},${y + h} ${x},${y + h}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
          break;
        case 'cylinder': {
          const ry = 12;
          el = `    <rect x="${x}" y="${y + ry}" width="${w}" height="${h - ry * 2}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
          el += `    <ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>\n    <ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>\n`;
          break;
        }
        case 'actor': {
          const r = Math.min(w, h * 0.3) / 2;
          el = `    <circle cx="${cx}" cy="${y + r + 4}" r="${r}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${cx}" y1="${y + r * 2 + 8}" x2="${cx}" y2="${y + h * 0.6}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${x + 10}" y1="${y + h * 0.4}" x2="${x + w - 10}" y2="${y + h * 0.4}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${cx - w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}"/>\n    <line x1="${cx + w * 0.3}" y1="${y + h * 0.85}" x2="${cx}" y2="${y + h * 0.65}" stroke="${stroke}" stroke-width="${sw}"/>\n    <text x="${cx}" y="${y + h - 6}" text-anchor="middle" fill="${color}" font-size="${Math.min(fs, 11)}" font-family="${ff}">${this.esc(node.label)}</text>\n`;
          return el;
        }
        case 'cloud':
          el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="25" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" stroke-dasharray="4,4" opacity="0.9"/>\n`;
          break;
        default:
          el = `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(s as any).borderRadius || 6}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${sw}" opacity="0.9"/>\n`;
          break;
      }
    }

    // Text label
    el += `    <text x="${cx}" y="${cy + fs * 0.35}" text-anchor="middle" fill="${color}" font-size="${fs}" font-family="${ff}">${this.esc(node.label || node.id)}</text>\n`;
    return el;
  }

  private renderEdge(edge: IREdge, pad: number, theme: Theme, sketchy: boolean): string {
    const d = theme.edge || {} as any;
    const s = edge.style || {} as any;
    const stroke = s.stroke || d.stroke || '#666';
    const sw = s.strokeWidth || d.strokeWidth || 2;
    const roughness = sketchy ? (s.roughness || d.roughness || 0.8) : 0;
    const bowing = sketchy ? (s.bowing || d.bowing || 1.0) : 0;
    const dash = s.strokeStyle === 'dashed' ? ' stroke-dasharray="6,4"' : '';
    const wps = edge.waypoints || [];
    if (wps.length < 2) return '';

    const pts: [number, number][] = wps.map(p => [p.x + pad, p.y + pad]);

    let el = '';
    if (sketchy && roughness > 0) {
      const rng = new SeededRandom(edge.sourceId.length + edge.targetId.length);
      const path = roughPolyline(pts, rng, { roughness, bowing, strokeWidth: sw });
      el = `    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash} filter="url(#sketch)"/>\n`;
    } else {
      const cleanPts = pts.map(p => `${p[0]},${p[1]}`).join(' ');
      el = `    <polyline points="${cleanPts}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash}/>\n`;
    }

    // Arrowhead
    const last = wps[wps.length - 1], prev = wps[wps.length - 2];
    if (last && prev) {
      const dx = last.x - prev.x, dy = last.y - prev.y, len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const nx = dx / len, ny = dy / len, asz = 10, ax = last.x + pad, ay = last.y + pad;
        el += `    <polygon points="${ax - asz * (nx * 0.8 - ny * 0.4)},${ay - asz * (ny * 0.8 + nx * 0.4)} ${ax - asz * (nx * 0.8 + ny * 0.4)},${ay - asz * (ny * 0.8 - nx * 0.4)} ${ax},${ay}" fill="${stroke}" stroke="${stroke}" stroke-width="1"${sketchy ? ' filter="url(#sketch)"' : ''}/>\n`;
      }
    }

    // Edge label
    if (edge.label) {
      const mid = wps[Math.floor(wps.length / 2)];
      if (mid) el += `    <text x="${mid.x + pad}" y="${mid.y + pad - 8}" text-anchor="middle" fill="#555" font-size="12" font-family="Inter, sans-serif">${this.esc(edge.label)}</text>\n`;
    }
    return el;
  }

  private computeBounds(nodes: IRNode[]): Rect {
    if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y); maxX = Math.max(maxX, n.position.x + n.size.width); maxY = Math.max(maxY, n.position.y + n.size.height); }
    return { x: minX, y: minY, width: maxX - minX + 20, height: maxY - minY + 20 };
  }

  private defaultTheme(): Theme {
    return {
      id: 'default',
      name: 'Default',
      description: 'Fallback built-in theme',
      sketchy: true,
      fontFamily: 'Inter, sans-serif',
      fontSize: 14,
      palette: {
        background: '#fff', text: '#333', primary: '#3498db', secondary: '#95a5a6',
        tertiary: '#1abc9c', surface: '#f8f9fa', textMuted: '#7f8c8d', border: '#bdc3c7',
        success: '#2ecc71', warning: '#f39c12', error: '#e74c3c', info: '#3498db',
      },
      node: {}, edge: {}, group: {},
    };
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
