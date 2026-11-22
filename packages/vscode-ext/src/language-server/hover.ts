// =============================================================================
// SelDiA — LSP Hover Provider
// =============================================================================
// Shows documentation when hovering over:
//   - Node IDs → shows the node declaration details
//   - Shape notations → shows shape documentation
//   - Keywords → shows keyword documentation
//   - Arrow types → shows arrow description

import * as vscode from 'vscode';
import type { CoreEngine } from '@seldia/core';

// ── Hover Documentation Maps ────────────────────────────────────────────────

const SHAPE_DOCS: Record<string, string> = {
  '[': '**Rectangle** — Standard process/action box. Used for general steps in flowcharts.',
  '(': '**Rounded Rectangle / Ellipse** — Start/end terminal. Also used for state diagram states.',
  '{': '**Diamond** — Decision/branch point. Used for conditional logic.',
  '[/': '**Hexagon** — Parallel operation / preparation step.',
  '>': '**Parallelogram** — Input/output operation.',
  '[(Database)]': '**Cylinder** — Database or data storage.',
  '{{': '**Actor** — User or external actor in the system.',
  '(())': '**Circle** — Start/end event in state diagrams.',
};

const KEYWORD_DOCS: Record<string, string> = {
  diagram: '**`diagram`** — Start a diagram definition.\n\n```\ndiagram flowchart "My Diagram" {\n    ...\n}\n```\n\nType must be one of: flowchart, sequence, class, c4-context, c4-container, state, er, bpmn, dmn, component, deployment, usecase, activity, gantt, timeline, mindmap, network, gitgraph, form, sankey, block, table.',
  theme: '**`theme`** — Apply a built-in theme or define an inline theme.\n\n```\ntheme "sketchy-light"\n```\n\nBuilt-in themes: sketchy-light, sketchy-dark, smooth-light, smooth-dark, handdrawn, glow-dark, glow-light (also `theme glow dark|light`).',
  animate: '**`animate`** — Edge attribute: flowing dashes.\n\n```\na --> b { animate }\na --> b { animate: fast }   // fast | slow | true | false\na ~~> b                     // shorthand\n```',
  layout: '**`layout`** — Set the layout engine and options.\n\n```\nlayout dagre { direction: "TB" }\n```',
  style: '**`style`** — Apply style rules to nodes, edges, or all elements.\n\n```\nstyle node { fill: "#e8f4f8", stroke: "#2c3e50" }\n```',
  group: '**`group`** — Group nodes together (visual bounding box).\n\n```\ngroup "Group Name" { node1, node2 }\n```',
  section: '**`section`** — Define a section (used in Gantt charts and mind maps).\n\n```\nsection "Phase 1" {\n    task1: "Task 1"\n}\n```',
  participant: '**`participant`** — Declare a participant (used in sequence diagrams).\n\n```\nparticipant user: "User"\n```',
  entity: '**`entity`** — Declare a database entity (used in ER diagrams).\n\n```\nentity User {\n    +id: int PK\n    +name: varchar\n}\n```',
};

const ARROW_DOCS: Record<string, string> = {
  '-->': '**Solid arrow** → Directed edge (default). Source --> Target',
  '<--': '**Reverse solid arrow** ← Directed edge in reverse. Source <-- Target',
  '<-->': '**Bidirectional arrow** ↔ Source <--> Target',
  '---': '**Solid line** — Undirected connection. Source --- Target',
  '..>': '**Dashed arrow** ⇢ Dashed directed edge with arrowhead. Source ..> Target',
  '==>': '**Thick arrow** ⇒ Thick directed edge. Source ==> Target',
  '~~>': '**Animated arrow** Directed edge with flowing dashes. Source ~~> Target (same as `{ animate }`)',
  '..': '**Dashed line** - - Undirected dashed connection. Source .. Target',
};

// ── Hover Provider ─────────────────────────────────────────────────────────

export class SelDiAHoverProvider implements vscode.HoverProvider {
  private engine: CoreEngine;

  constructor(engine: CoreEngine) {
    this.engine = engine;
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (!word) return null;

    const line = document.lineAt(position).text;

    // ── Hover over node IDs → show declaration ────────────────────────────
    const nodeInfo = this.findNodeDeclaration(document, word);
    if (nodeInfo) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**Node: \`${nodeInfo.id}\`**  \n`);
      md.appendMarkdown(`Shape: \`${nodeInfo.shape}\`  \n`);
      if (nodeInfo.label) md.appendMarkdown(`Label: "${nodeInfo.label}"  \n`);
      if (nodeInfo.description) md.appendMarkdown(`Description: ${nodeInfo.description}  \n`);
      return new vscode.Hover(md);
    }

    // ── Hover over keywords ───────────────────────────────────────────────
    if (KEYWORD_DOCS[word]) {
      return new vscode.Hover(new vscode.MarkdownString(KEYWORD_DOCS[word]));
    }

    // ── Hover over shape notations ────────────────────────────────────────
    for (const [notation, doc] of Object.entries(SHAPE_DOCS)) {
      if (line.includes(notation)) {
        return new vscode.Hover(new vscode.MarkdownString(doc));
      }
    }

    // ── Hover over arrow types ────────────────────────────────────────────
    for (const [arrow, doc] of Object.entries(ARROW_DOCS)) {
      if (line.includes(arrow)) {
        return new vscode.Hover(new vscode.MarkdownString(doc));
      }
    }

    // ── Hover over theme names ────────────────────────────────────────────
    const builtinThemes = ['sketchy-light', 'sketchy-dark', 'smooth-light', 'smooth-dark', 'handdrawn', 'glow-dark', 'glow-light'];
    if (builtinThemes.includes(word)) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**Theme: \`${word}\`**  \n`);
      if (word.includes('sketchy')) md.appendMarkdown('Rendered with SVG displacement filter for hand-drawn effect.');
      if (word.includes('smooth')) md.appendMarkdown('Clean SVG rendering without sketch effect.');
      if (word === 'handdrawn') md.appendMarkdown('Exaggerated hand-drawn aesthetic with stronger wobble.');
      if (word.startsWith('glow')) md.appendMarkdown('PAiRS-style: tinted nodes, accent bars, glow on focus. ');
      if (word.includes('light')) md.appendMarkdown('Light background (default).');
      if (word.includes('dark')) md.appendMarkdown('Dark background.');
      return new vscode.Hover(md);
    }

    return null;
  }

  /**
   * Find a node declaration matching the given word.
   */
  private findNodeDeclaration(
    document: vscode.TextDocument,
    word: string
  ): { id: string; label: string; shape: string; description?: string } | null {
    const text = document.getText();
    // Match:  nodeId: (Shape) "Label"  or  nodeId: [Shape]
    const pattern = new RegExp(
      `^[\\s]*${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(\\S+)\\s*(?:"([^"]*)")?\\s*(?:///(.*))?$`,
      'm'
    );
    const match = text.match(pattern);
    if (match) {
      return {
        id: word,
        shape: match[1],
        label: match[2] || word,
        description: match[3]?.trim(),
      };
    }
    return null;
  }
}
