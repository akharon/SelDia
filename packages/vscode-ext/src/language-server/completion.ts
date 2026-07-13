// =============================================================================
// SelDiA — LSP Completion Provider
// =============================================================================
// Provides autocomplete for:
//   - Diagram type keywords (flowchart, sequence, class, c4, etc.)
//   - Shape notations ([...], (...), {...}, <...>)
//   - Arrow types (-->, ..>, ==>, <--)
//   - Theme names
//   - DSL keywords (diagram, theme, group, style, layout, participant)
//   - Common node IDs within the current document

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';

// ── Completion Data ─────────────────────────────────────────────────────────

const DIAGRAM_TYPES = [
  { label: 'flowchart', detail: 'Flowchart diagram', doc: 'Processes, workflows, and algorithms' },
  { label: 'sequence', detail: 'Sequence diagram', doc: 'Interaction flows between participants' },
  { label: 'class', detail: 'Class diagram', doc: 'Object-oriented class structures' },
  { label: 'c4', detail: 'C4 diagram (context/container/component/code)', doc: 'Architecture levels: context, container, component, code' },
  { label: 'state', detail: 'State diagram', doc: 'State machine transitions' },
  { label: 'er', detail: 'ER diagram', doc: 'Entity-relationship data modeling' },
  { label: 'bpmn', detail: 'BPMN diagram', doc: 'BPMN 2.0 process modeling' },
  { label: 'component', detail: 'Component diagram', doc: 'Software component dependencies' },
  { label: 'deployment', detail: 'Deployment diagram', doc: 'Physical deployment of artifacts' },
  { label: 'usecase', detail: 'Use case diagram', doc: 'System use cases and actors' },
  { label: 'activity', detail: 'Activity diagram', doc: 'Activity and action flows' },
  { label: 'gantt', detail: 'Gantt chart', doc: 'Project schedule and timelines' },
  { label: 'timeline', detail: 'Timeline', doc: 'Chronological event sequences' },
  { label: 'mindmap', detail: 'Mind map', doc: 'Radial idea organization' },
  { label: 'network', detail: 'Network diagram', doc: 'Network topology and connections' },
  { label: 'chart', detail: 'Chart (bar/line/pie/radar/scatter)', doc: 'Data visualization charts' },
  { label: 'gitgraph', detail: 'Git graph', doc: 'Git branch and commit history' },
  { label: 'form', detail: 'Form definition', doc: 'Form layouts and fields' },
  { label: 'sankey', detail: 'Sankey diagram', doc: 'Flow quantity visualization' },
  { label: 'block', detail: 'Block diagram', doc: 'System block architecture' },
];

const SHAPES = [
  { label: '[Node Label]', detail: 'Rectangle (process/action)', insertText: '[${1:label}]' },
  { label: '(Node Label)', detail: 'Rounded rectangle / ellipse (start/end)', insertText: '(${1:label})' },
  { label: '{Decision?}', detail: 'Diamond (decision/branch)', insertText: '{${1:decision}?}' },
  { label: '[/Parallel/]', detail: 'Hexagon (parallel operation)', insertText: '[/${1:parallel}/]' },
  { label: '>Input<', detail: 'Parallelogram (input/output)', insertText: '>${1:input}<' },
  { label: '[(Database)]', detail: 'Cylinder (database/storage)', insertText: '\[(${1:database})\]' },
  { label: '{{Actor}}', detail: 'Actor (person/user)', insertText: '{{${1:actor}}}' },
  { label: '(())', detail: 'Circle / event', insertText: '(())' },
];

const ARROWS = [
  { label: '-->', detail: 'Directed edge (solid arrow)', insertText: ' --> ' },
  { label: '<--', detail: 'Reversed directed edge', insertText: ' <-- ' },
  { label: '<-->', detail: 'Bidirectional edge', insertText: ' <--> ' },
  { label: '---', detail: 'Undirected edge (solid line)', insertText: ' --- ' },
  { label: '..>', detail: 'Dashed directed edge', insertText: ' ..> ' },
  { label: '==>', detail: 'Thick directed edge', insertText: ' ==> ' },
  { label: '..', detail: 'Dashed undirected edge', insertText: ' .. ' },
];

const DSL_KEYWORDS = [
  { label: 'diagram', detail: 'Start a diagram block', doc: 'diagram <type> "<title>" { ... }' },
  { label: 'theme', detail: 'Set a theme', doc: 'theme "<name>" or theme { ... }' },
  { label: 'layout', detail: 'Set layout engine', doc: 'layout <engine> { options }' },
  { label: 'style', detail: 'Apply style rules', doc: 'style node { fill: "#fff" }' },
  { label: 'group', detail: 'Create a group', doc: 'group "name" { node1, node2 }' },
  { label: 'section', detail: 'Create a section (gantt/mindmap)', doc: 'section "name" { ... }' },
  { label: 'participant', detail: 'Declare a participant (sequence)', doc: 'participant id: "Label"' },
  { label: 'entity', detail: 'Declare an entity (ER)', doc: 'entity Name { +id: int PK }' },
  { label: 'class', detail: 'Declare a class (class diagram)', doc: 'class Name { +attr: type }' },
];

const THEMES = [
  { label: 'sketchy-light', detail: 'Light theme with sketchy rendering (default)' },
  { label: 'sketchy-dark', detail: 'Dark theme with sketchy rendering' },
  { label: 'smooth-light', detail: 'Clean light theme without sketch effect' },
  { label: 'smooth-dark', detail: 'Clean dark theme without sketch effect' },
  { label: 'handdrawn', detail: 'Exaggerated hand-drawn aesthetic' },
];

// ── Completion Provider ─────────────────────────────────────────────────────

export class SelDiACompletionProvider implements vscode.CompletionItemProvider {
  private engine: CoreEngine;

  constructor(engine: CoreEngine) {
    this.engine = engine;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const lineText = document.lineAt(position).text.trim();

    // Determine context: inside a diagram block or at top level?
    const text = document.getText();
    const isInsideDiagram = this.isInsideDiagramBlock(text, position);

    // ── Top-level: suggest diagram keyword ────────────────────────────────
    if (!isInsideDiagram && !lineText) {
      items.push(...DSL_KEYWORDS.map((k) => {
        const item = new vscode.CompletionItem(k.label, vscode.CompletionItemKind.Keyword);
        item.detail = k.detail;
        item.documentation = k.doc;
        return item;
      }));
    }

    // ── After "diagram" keyword: suggest diagram types ─────────────────────
    const diagramMatch = linePrefix.match(/diagram\s+(\w*)$/i);
    if (diagramMatch) {
      const prefix = diagramMatch[1].toLowerCase();
      for (const dt of DIAGRAM_TYPES) {
        if (dt.label.startsWith(prefix)) {
          const item = new vscode.CompletionItem(dt.label, vscode.CompletionItemKind.Enum);
          item.detail = dt.detail;
          item.documentation = dt.doc;
          items.push(item);
        }
      }
      return items;
    }

    // ── Inside a diagram body: suggest shapes, arrows, keywords ────────────
    if (isInsideDiagram) {
      // Check if we're on a new line (node/edge declaration context)
      const isNewStmt = /^[\s]*$/.test(lineText) || /^[\s]*(participant|entity|class|section)\s/.test(lineText);

      if (isNewStmt) {
        // Suggest shape notations
        for (const s of SHAPES) {
          const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Snippet);
          item.detail = s.detail;
          item.insertText = new vscode.SnippetString(s.insertText);
          items.push(item);
        }
        // Suggest arrow types
        for (const a of ARROWS) {
          const item = new vscode.CompletionItem(a.label, vscode.CompletionItemKind.Operator);
          item.detail = a.detail;
          item.insertText = new vscode.SnippetString(a.insertText);
          items.push(item);
        }
        // Suggest keywords valid inside diagram body
        const bodyKeywords = ['participant', 'entity', 'class', 'section', 'group', 'style', 'layout', 'theme'];
        for (const kw of bodyKeywords) {
          const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
          item.detail = DSL_KEYWORDS.find(k => k.label === kw)?.detail || '';
          item.documentation = DSL_KEYWORDS.find(k => k.label === kw)?.doc || '';
          items.push(item);
        }
      }

      // Suggest node IDs that exist in the document (for edge targets)
      if (linePrefix.includes('>') || linePrefix.includes('-')) {
        const nodeIds = this.extractNodeIds(text);
        for (const nid of nodeIds) {
          const item = new vscode.CompletionItem(nid, vscode.CompletionItemKind.Variable);
          item.detail = `Node: ${nid}`;
          items.push(item);
        }
      }
    }

    // ── Suggest theme names after "theme" keyword ─────────────────────────
    const themeMatch = linePrefix.match(/theme\s+['"]?(\w*)$/i);
    if (themeMatch) {
      const prefix = themeMatch[1].toLowerCase();
      for (const t of THEMES) {
        if (t.label.startsWith(prefix)) {
          const item = new vscode.CompletionItem(t.label, vscode.CompletionItemKind.Enum);
          item.detail = t.detail;
          items.push(item);
        }
      }
    }

    return items;
  }

  /**
   * Check if the cursor is inside a diagram block { ... }.
   */
  private isInsideDiagramBlock(text: string, position: vscode.Position): boolean {
    const offset = text.split('\n').slice(0, position.line).join('\n').length + position.character;
    let braceDepth = 0;
    let inDiagram = false;
    let i = 0;
    const lines = text.split('\n');

    for (let lineIdx = 0; lineIdx <= position.line; lineIdx++) {
      const line = lines[lineIdx];
      if (!line) continue;
      const isLastLine = lineIdx === position.line;
      const endCol = isLastLine ? position.character : line.length;

      for (let col = 0; col < endCol; col++) {
        const ch = line[col];
        // Skip strings
        if (ch === '"') {
          col++;
          while (col < endCol && line[col] !== '"') col++;
          continue;
        }
        if (ch === '{') {
          braceDepth++;
          if (braceDepth === 1) inDiagram = true;
        } else if (ch === '}') {
          braceDepth--;
          if (braceDepth === 0) inDiagram = false;
        }
      }
    }
    return inDiagram;
  }

  /**
   * Extract node IDs from a SelDiA document by finding declarations.
   */
  private extractNodeIds(text: string): string[] {
    const ids = new Set<string>();
    // Match patterns like:  nodeId: (Shape)
    const nodePattern = /^[\s]*([a-zA-Z_]\w*)\s*:/gm;
    let match;
    while ((match = nodePattern.exec(text)) !== null) {
      ids.add(match[1]);
    }
    return Array.from(ids);
  }
}
