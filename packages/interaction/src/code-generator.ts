// =============================================================================
// SelDiA — DSL Code Generator
// =============================================================================
// Generates idiomatic, human-readable DSL source code from IR data changes.
// Used by the bidirectional sync system to produce DSL patches from visual edits.

import type { Point } from '@seldia/core';
import type { DiagramIR } from '@seldia/core';
import type {
  CodeGenerator,
  GenerateNodeParams,
  GenerateEdgeParams,
  GenerateGroupParams,
} from './source-map-types.js';

// Map shapes to their DSL notation
const SHAPE_TO_DSL: Record<string, string> = {
  rect: '[]',
  rectangle: '[]',
  circle: '()',
  ellipse: '()',
  diamond: '{}',
  hexagon: '<>',
  cylinder: '[||]',
  stadium: '[()]',
  rounded: '()',
  parallelogram: '[/ /]',
  subroutine: '{{}}',
  cloud: '[/ /]',
  actor: '()',
};

export class SelDiACodeGenerator implements CodeGenerator {
  generateNode(params: GenerateNodeParams): string {
    const indent = ' '.repeat(params.indent);
    const shapeNotation = SHAPE_TO_DSL[params.shape] || '[]';
    const labelPart = params.label ? ` "${params.label}"` : '';
    const stylePart = params.style ? ` ${this.generateStyleBlock(params.style, 0)}` : '';
    const layoutPart = params.position ? ` ${this.generateLayoutHints(params.position, 0)}` : '';

    return `${indent}${params.id}: ${shapeNotation}${labelPart}${stylePart}${layoutPart}`;
  }

  generateEdge(params: GenerateEdgeParams): string {
    const indent = ' '.repeat(params.indent);
    const arrow = params.routing || '-->';
    const labelPart = params.label ? `|${params.label}|` : '';
    const stylePart = params.style ? ` ${this.generateStyleBlock(params.style, 0)}` : '';

    return `${indent}${params.sourceId} ${arrow}${labelPart ? ` ${labelPart} ` : ' '}${params.targetId}${stylePart}`;
  }

  generateGroup(params: GenerateGroupParams): string {
    const indent = ' '.repeat(params.indent);
    const labelPart = params.label ? ` "${params.label}"` : '';
    const stylePart = params.style ? ` ${this.generateStyleBlock(params.style, params.indent)}` : '';

    return `${indent}group ${params.id}${labelPart}${params.collapsible ? ' {collapsible}' : ''} {\n${params.childContent}\n${indent}}`;
  }

  generateStyleBlock(style: Record<string, unknown>, indent: number): string {
    const pad = ' '.repeat(indent + 4);
    const entries = Object.entries(style)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => {
        if (typeof v === 'string') return `${pad}${k}: "${v}"`;
        if (typeof v === 'number') return `${pad}${k}: ${v}`;
        if (typeof v === 'boolean') return `${pad}${k}: ${v}`;
        return `${pad}${k}: ${JSON.stringify(v)}`;
      });

    if (entries.length === 0) return '';

    return `{\n${entries.join(',\n')}\n${' '.repeat(Math.max(0, indent))}}`;
  }

  generateLayoutHints(position: Point, indent: number): string {
    const pad = ' '.repeat(indent + 4);
    return `layout: {\n${pad}x: ${Math.round(position.x)},\n${pad}y: ${Math.round(position.y)}\n${' '.repeat(Math.max(0, indent))}}`;
  }

  generateDiagram(ir: DiagramIR): string {
    const typeName = String(ir.type).toLowerCase();
    const title = ir.title ? ` "${ir.title}"` : '';
    let dsl = `diagram ${typeName}${title} {\n`;

    for (const node of ir.nodes) {
      const shape = SHAPE_TO_DSL[node.shape] || '[]';
      const label = node.label ? ` "${node.label}"` : '';
      dsl += `    ${node.id}: ${shape}${label}\n`;
    }

    dsl += '\n';

    for (const edge of ir.edges) {
      const arrow = '-->';
      const label = edge.label ? `|${edge.label}|` : '';
      dsl += `    ${edge.sourceId} ${arrow}${label ? ` ${label} ` : ' '}${edge.targetId}\n`;
    }

    dsl += '}\n';
    return dsl;
  }
}
