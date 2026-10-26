// =============================================================================
// SelDiA — Circuit schematic plugin
// =============================================================================
// The fence body is a raw netlist (SPICE subset, or a KiCad `(export …)` file
// as SKiDL writes it), carried on `ast.raw`; the DSL lexer never sees it.
// =============================================================================

import type { DiagramPlugin, PluginDiagnostic } from '../plugin/types.js';
import type { DiagramAST } from '../ast/nodes.js';
import type { DiagramIR } from '../ir/types.js';
import type { SelDiAConfig } from '../config.js';
import { DiagramType } from '../ir/types.js';
import { parseSpice } from '../circuit/spice.js';
import { parseKicadNetlist, isKicadNetlist } from '../circuit/kicad.js';
import { circuitToIR, type CircuitModel } from '../circuit/model.js';
import { SYMBOLS, symbolFor } from '../circuit/symbols.js';
import { escapeXml } from '../render/escape.js';

export function parseNetlist(raw: string, hasTitle = false): CircuitModel {
  return isKicadNetlist(raw) ? parseKicadNetlist(raw) : parseSpice(raw, { hasTitle });
}

export const circuitPlugin: DiagramPlugin = {
  id: 'seldia.circuit',
  name: 'Circuit schematic',
  version: '0.1.0',
  diagramType: DiagramType.CIRCUIT,
  description: 'SPICE / KiCad netlist to schematic',

  transform(ast: DiagramAST, _config: SelDiAConfig): DiagramIR {
    const model = parseNetlist(ast.raw ?? '', !!ast.title);
    const ir = circuitToIR(model);
    if (ast.title) ir.title = ast.title;
    return ir;
  },

  validate(ast: DiagramAST): PluginDiagnostic[] {
    const model = parseNetlist(ast.raw ?? '', !!ast.title);
    return model.warnings.map((message) => ({ severity: 'warning', message })) as PluginDiagnostic[];
  },

  renderNode(node, ctx) {
    const d = (node.data ?? {}) as any;
    const { x, y } = node.position, p = ctx.pad;
    const stroke = '#1f2933', text = '#1f2933';
    if (d.role === 'junction') {
      return ((d.dots ?? []) as Array<{ x: number; y: number }>).map((q) => `    <circle cx="${q.x + p}" cy="${q.y + p}" r="3.2" fill="${stroke}"/>\n`).join('');
    }
    const c = d.circuit;
    if (!c) return '';
    const def = d.role === 'power' ? SYMBOLS[d.kind] : symbolFor(d.kind, d.pins ?? [], d.modelType ?? '', d.value ?? '', !!d.bodyTied);
    const g = def.draw({ stroke, fill: '#ffffff', strokeWidth: 1.5, text });
    let s = `    <g transform="translate(${x + p + c.symX} ${y + p + c.symY})"><g transform="${c.transform}">${g}</g></g>\n`;
    c.lines.forEach((ln: string, i: number) => {
      s += `    <text x="${x + p + c.labelX}" y="${y + p + c.labelY + i * 14}" text-anchor="${c.anchor}" font-size="${i === 0 ? 12 : 11}" font-weight="${i === 0 ? 700 : 400}" fill="${text}" font-family="sans-serif">${escapeXml(ln)}</text>\n`;
    });
    return s;
  },

  getDefaultLayoutOptions() { return { direction: 'LR' }; },
};

/** Importer-shaped entry point (same contract as importMermaid): SPICE or KiCad text to IR. */
export function importCircuit(source: string): { ir?: DiagramIR; diagnostics: Array<{ line: number; message: string }> } {
  const model = parseNetlist(source);
  return { ir: circuitToIR(model), diagnostics: model.warnings.map((message) => ({ line: 0, message })) };
}
