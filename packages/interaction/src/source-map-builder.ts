// =============================================================================
// SelDiA — Source Map Builder
// =============================================================================
// Constructs a SourceMap from DSL source text and (optionally) parsed AST.
// Maps every IR element (node, edge, group) back to its originating source
// location, enabling bidirectional sync between visual edits and DSL code.

import type { ID, Point, SourceLocation } from '@seldia/core';
import type {
  SourceMap, SourceMapEntry,
  NodeSourceMapEntry, EdgeSourceMapEntry, GroupSourceMapEntry,
} from './source-map-types.js';
import type { DiagramIR } from '@seldia/core';

// -------------------------------------------------------------------------
// Line-based pattern matching helpers
// -------------------------------------------------------------------------

// Node declaration:   nodeId: (label)  or  nodeId: [label]  or  nodeId: {label}  etc.
const NODE_DECL_RE = /^\s*([\w-]+)\s*:\s*(\(|\[|\{|<|\[\(|\[\[|\{\{|\[\/|\[\\|\|\|)/;

// Edge declaration:   nodeId --> nodeId  or  nodeId ..> nodeId  etc.
const EDGE_DECL_RE = /^\s*([\w-]+)\s*(?:--\>|\.\.\>|==\>|\-\-\-|<--\>|\.\.|\-\.\.\->)\s*([\w-]+)/;

// Edge with label:    nodeId -->|label| nodeId
const EDGE_LABEL_RE = /-->\|([^|]*)\|/;

// Group declaration:  group nodeId "label" {
const GROUP_OPEN_RE = /^\s*(?:group|boundary)\s+([\w-]+)\s*(?:"([^"]*)")?\s*\{/;

// Participant / actor / entity declarations
const PARTICIPANT_RE = /^\s*(?:participant|actor|entity|class|system|person|system_Ext|container|containerDb|startEvent|task|endEvent|gateway)\s+([\w-]+)/;

// Style block: { ... }
const STYLE_BLOCK_RE = /\{[^}]*\}/;

// Label in quotes: "label"
const QUOTED_LABEL_RE = /"([^"]*)"/;

export function buildSourceMap(
  sourceText: string,
  filePath: string,
  ir?: DiagramIR
): SourceMap {
  const entries = new Map<ID, SourceMapEntry>();
  const offsetToId = new Map<number, ID>();
  const lines = sourceText.split('\n');
  let currentGroupId: string | null = null;
  const groupStack: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineOffset = getLineOffset(lines, lineIdx);

    // Track group open/close for nesting
    if (GROUP_OPEN_RE.test(line)) {
      const m = line.match(GROUP_OPEN_RE)!;
      const groupId = m[1];
      const label = m[2] || '';
      const declLen = line.length;

      const entry: GroupSourceMapEntry = {
        elementType: 'group',
        irId: groupId,
        declarationLoc: makeLoc(filePath, lineIdx, 0, lineIdx, line.length, lineOffset, sourceText.length),
        closingLoc: makeLoc(filePath, lineIdx, 0, lineIdx, line.length, lineOffset, sourceText.length),
        labelLoc: m[2] ? makeLoc(filePath, lineIdx, line.indexOf(`"${label}"`), lineIdx, line.indexOf(`"${label}"`) + label.length + 2, lineOffset, sourceText.length) : undefined,
      };
      entries.set(groupId, entry);
      offsetToId.set(lineOffset, groupId);
      groupStack.push(groupId);
      currentGroupId = groupId;
    }

    // Track group close
    if (/^\s*\}\s*$/.test(line) && groupStack.length > 0) {
      currentGroupId = groupStack.pop() || null;
      // Update closingLoc for the group
      const prevEntry = currentGroupId ? entries.get(currentGroupId) : null;
      if (prevEntry && prevEntry.elementType === 'group') {
        (prevEntry as GroupSourceMapEntry).closingLoc = makeLoc(filePath, lineIdx, 0, lineIdx, line.length, lineOffset, sourceText.length);
      }
      currentGroupId = groupStack.length > 0 ? groupStack[groupStack.length - 1] : null;
    }

    // Node declaration
    const nodeMatch = line.match(NODE_DECL_RE);
    if (nodeMatch) {
      const nodeId = nodeMatch[1];
      const shapeDelim = nodeMatch[2];
      const label = extractLabel(line);

      // Find shape closing delimiter position
      const shapeEnd = findShapeClose(line, shapeDelim);

      // Find label position
      const labelQuoteIdx = line.indexOf('"');

      const entry: NodeSourceMapEntry = {
        elementType: 'node',
        irId: nodeId,
        declarationLoc: makeLoc(filePath, lineIdx, 0, lineIdx, line.length, lineOffset, sourceText.length),
        idLoc: makeLoc(filePath, lineIdx, line.indexOf(nodeId), lineIdx, line.indexOf(nodeId) + nodeId.length, lineOffset, sourceText.length),
        labelLoc: labelQuoteIdx >= 0
          ? makeLoc(filePath, lineIdx, labelQuoteIdx, lineIdx, line.lastIndexOf('"') + 1, lineOffset, sourceText.length)
          : undefined,
        shapeLoc: makeLoc(filePath, lineIdx, line.indexOf(shapeDelim), lineIdx, shapeEnd, lineOffset, sourceText.length),
        styleLoc: undefined,
        layoutLoc: undefined,
        irSnapshot: {
          position: { x: 0, y: 0 },
          size: { width: 140, height: 60 },
          label,
          shape: shapeDelim,
        },
      };

      // Check for style block { ... }
      const styleMatch = line.match(STYLE_BLOCK_RE);
      if (styleMatch) {
        entry.styleLoc = makeLoc(filePath, lineIdx, styleMatch.index!, lineIdx, styleMatch.index! + styleMatch[0].length, lineOffset, sourceText.length);
      }

      // Check for layout hints
      const layoutIdx = line.search(/\blayout\s*:/);
      if (layoutIdx >= 0) {
        entry.layoutLoc = makeLoc(filePath, lineIdx, layoutIdx, lineIdx, line.length, lineOffset, sourceText.length);
      }

      entries.set(nodeId, entry);
      offsetToId.set(lineOffset, nodeId);
      continue;
    }

    // Participant / actor / entity declarations
    const partMatch = line.match(PARTICIPANT_RE);
    if (partMatch) {
      const nodeId = partMatch[1];
      if (!entries.has(nodeId)) {
        const label = extractLabel(line);
        const entry: NodeSourceMapEntry = {
          elementType: 'node',
          irId: nodeId,
          declarationLoc: makeLoc(filePath, lineIdx, 0, lineIdx, line.length, lineOffset, sourceText.length),
          idLoc: makeLoc(filePath, lineIdx, line.indexOf(nodeId), lineIdx, line.indexOf(nodeId) + nodeId.length, lineOffset, sourceText.length),
          labelLoc: undefined,
          shapeLoc: makeLoc(filePath, lineIdx, 0, lineIdx, 0, lineOffset, sourceText.length),
          styleLoc: undefined,
          layoutLoc: undefined,
          irSnapshot: { position: { x: 0, y: 0 }, size: { width: 140, height: 60 }, label, shape: 'rect' },
        };
        entries.set(nodeId, entry);
        offsetToId.set(lineOffset, nodeId);
      }
      continue;
    }

    // Edge declaration
    const edgeMatch = line.match(EDGE_DECL_RE);
    if (edgeMatch) {
      const srcId = edgeMatch[1];
      const tgtId = edgeMatch[2];

      // Use edge operator as unique edge ID
      const edgeOp = line.match(/(?:--\>|\.\.\>|==\>|\-\-\-|<--\>|\.\.|\-\.\.\->)/)?.[0] || '-->';
      const edgeId = `${srcId}${edgeOp}${tgtId}`;

      // Extract label from |...| syntax
      const labelMatch = line.match(EDGE_LABEL_RE);
      const label = labelMatch ? labelMatch[1] : extractQuotedLabel(line);

      const entry: EdgeSourceMapEntry = {
        elementType: 'edge',
        irId: edgeId,
        declarationLoc: makeLoc(filePath, lineIdx, 0, lineIdx, line.length, lineOffset, sourceText.length),
        sourceIdLoc: makeLoc(filePath, lineIdx, line.indexOf(srcId), lineIdx, line.indexOf(srcId) + srcId.length, lineOffset, sourceText.length),
        targetIdLoc: makeLoc(filePath, lineIdx, line.lastIndexOf(tgtId), lineIdx, line.lastIndexOf(tgtId) + tgtId.length, lineOffset, sourceText.length),
        labelLoc: labelMatch
          ? makeLoc(filePath, lineIdx, line.indexOf(`|${label}|`), lineIdx, line.indexOf(`|${label}|`) + label.length + 2, lineOffset, sourceText.length)
          : undefined,
        styleLoc: undefined,
        irSnapshot: { label },
      };

      entries.set(edgeId, entry);
      offsetToId.set(lineOffset, edgeId);
      continue;
    }
  }

  return {
    filePath,
    sourceText,
    entries,
    offsetToId,
    generatedAt: Date.now(),
  };
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function getLineOffset(lines: string[], lineIdx: number): number {
  let offset = 0;
  for (let i = 0; i < lineIdx; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  return offset;
}

function makeLoc(
  file: string,
  startLine: number, startCol: number,
  endLine: number, endCol: number,
  offset: number,
  totalLen: number
): SourceLocation {
  return {
    file,
    startLine: startLine + 1, // 1-based
    startColumn: startCol + 1,
    endLine: endLine + 1,
    endColumn: endCol + 1,
    offset,
  };
}

function extractLabel(line: string): string {
  const qm = line.match(QUOTED_LABEL_RE);
  return qm ? qm[1] : '';
}

function extractQuotedLabel(line: string): string {
  const qm = line.match(QUOTED_LABEL_RE);
  return qm ? qm[1] : '';
}

function findShapeClose(line: string, openDelim: string): number {
  const delimPairs: Record<string, string> = {
    '(': ')', '[': ']', '{': '}', '<': '>',
    '[(': ')]', '[[': ']]', '{{': '}}',
    '[/': '/]', '[\\': '\\]',
  };
  const close = delimPairs[openDelim] || openDelim;
  const ci = line.indexOf(close, line.indexOf(openDelim) + openDelim.length);
  return ci >= 0 ? ci + close.length : line.length;
}
