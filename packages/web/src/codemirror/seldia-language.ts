// =============================================================================
// SelDiA — CodeMirror 6 Language Mode
// =============================================================================
//
// Provides syntax highlighting, indentation, and basic autocompletion for
// SelDiA DSL (.sld) files using CodeMirror 6's StreamLanguage.
//
// The DSL grammar is:
//   diagram <type> ["Title"] {
//       node declarations
//       edge declarations
//   }
//
// With keywords: diagram, as, style, theme, direction, LR, TB, BT, RL
// Node shapes: (), [], {}, <>, (()), ([]), [()]
// Edge types: -->, ===>, -.-, <->
// Themes: sketchy-light, sketchy-dark, blueprint, monochrome, clean
// -----------------------------------------------------------------------------

import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { type Completion, type CompletionContext } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import type { Line } from '@codemirror/state';

// ── Tokenizer ────────────────────────────────────────────────────────────────

// ── Tokenizer State ──────────────────────────────────────────────────────────

interface SelDiAState {
  inString: boolean;
  inBlock: boolean;
  blockDepth: number;
  inComment: boolean;
}

// ── Keywords ─────────────────────────────────────────────────────────────────

/** Keywords recognised by the SelDiA DSL */
const KEYWORDS = new Set([
  'diagram', 'as', 'style', 'theme', 'direction',
  'LR', 'TB', 'BT', 'RL',
  'sketchy-light', 'sketchy-dark', 'blueprint', 'monochrome', 'clean',
]);

/** Diagram type names */
const DIAGRAM_TYPES = [
  'flowchart', 'sequence', 'class', 'state',
  'c4-context', 'c4-container', 'c4-component', 'c4-code',
  'component', 'deployment', 'network',
  'activity', 'bpmn', 'dmn', 'usecase',
  'entity-relationship', 'er',
  'bar', 'line', 'pie', 'radar', 'scatter', 'sankey',
  'gantt', 'timeline', 'mindmap', 'gitgraph',
  'form', 'block',
];

// ── Stream Language Parser ───────────────────────────────────────────────────

const seldiaLanguageStream: StreamParser<SelDiAState> = {
  startState(): SelDiAState {
    return { inString: false, inBlock: false, blockDepth: 0, inComment: false };
  },

  token(stream: StringStream, state: SelDiAState): string | null {
    // ── Comments (// to end of line) ──────────────────────────────────────
    if (stream.match(/\/\/.*/)) {
      return 'comment';
    }

    // ── Multi-line comments (/* ... */) ────────────────────────────────────
    if (stream.match(/\/\*/)) {
      state.inComment = true;
      return 'comment';
    }
    if (state.inComment) {
      const idx = stream.string.indexOf('*/', stream.pos);
      if (idx !== -1) {
        stream.pos = idx + 2;
        state.inComment = false;
        return 'comment';
      }
      stream.skipToEnd();
      return 'comment';
    }

    // ── Whitespace ─────────────────────────────────────────────────────────
    if (stream.eatSpace()) {
      return null;
    }

    // ── Strings (double-quoted) ────────────────────────────────────────────
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
      return 'string';
    }

    // ── Numbers ────────────────────────────────────────────────────────────
    if (stream.match(/^\d+(\.\d+)?/)) {
      return 'number';
    }

    // ── Edge operators (must come before single chars) ─────────────────────
    if (stream.match(/^={3,5}=>/)) {
      return 'operator';
    }
    if (stream.match(/^={3,5}=>/)) {
      return 'operator';
    }
    if (stream.match(/^-{2,5}-?>/)) {
      return 'operator';
    }
    if (stream.match(/^-\.-?>/)) {
      return 'operator';
    }
    if (stream.match(/^<-{2,5}-?/)) {
      return 'operator';
    }
    if (stream.match(/^<={2,5}-?/)) {
      return 'operator';
    }
    if (stream.match(/^<->/)) {
      return 'operator';
    }
    if (stream.match(/^\.-\./)) {
      return 'operator';
    }

    // ── Identifiers / keywords ─────────────────────────────────────────────
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word)) {
        return 'keyword';
      }
      if (DIAGRAM_TYPES.includes(word)) {
        return 'typeName';
      }
      return 'variableName';
    }

    // ── Node shape delimiters ─────────────────────────────────────────────
    if (stream.match(/^\(\(/)) {
      return 'bracket';
    }
    if (stream.match(/^\[\]/)) {
      return 'bracket';
    }
    if (stream.match(/^\(\)/)) {
      return 'bracket';
    }
    if (stream.match(/^\(/)) {
      return 'bracket';
    }
    if (stream.match(/^\[/)) {
      return 'bracket';
    }
    if (stream.match(/^\{/)) {
      return 'bracket';
    }
    if (stream.match(/^\)/)) {
      return 'bracket';
    }
    if (stream.match(/^\]/)) {
      return 'bracket';
    }
    if (stream.match(/^\}/)) {
      return 'bracket';
    }
    if (stream.match(/^<>/)) {
      return 'bracket';
    }

    // ── Pipe (edge label delimiter) ───────────────────────────────────────
    if (stream.match(/^\|/)) {
      return 'operator';
    }

    // ── Colon / Semicolon / Comma / Dot ───────────────────────────────────
    if (stream.match(/^:/)) {
      return 'punctuation';
    }
    if (stream.match(/^;/)) {
      return 'punctuation';
    }
    if (stream.match(/^,/)) {
      return 'punctuation';
    }

    // ── Arrow (-> => ->) ──────────────────────────────────────────────────
    if (stream.match(/^->/)) {
      return 'operator';
    }
    if (stream.match(/^=>/)) {
      return 'operator';
    }

    // ── Anything else — consume one char and return ───────────────────────
    stream.next();
    return null;
  },

  blankLine(): void {
    // No special handling for blank lines
  },
};

// ── Language Object ──────────────────────────────────────────────────────────

/** The SelDiA DSL language mode for CodeMirror 6 */
export const seldiaLanguage = StreamLanguage.define(seldiaLanguageStream);

// ── Autocompletion ───────────────────────────────────────────────────────────

/**
 * SelDiA DSL autocomplete source — provides keyword, type, and theme
 * completions based on context.
 */
export function seldiaAutocomplete(context: CompletionContext) {
  const word = context.matchBefore(/[a-zA-Z_][a-zA-Z0-9_-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const options: Completion[] = [
    // Keywords
    { label: 'diagram', type: 'keyword', detail: 'Keyword' },
    { label: 'as', type: 'keyword', detail: 'Keyword' },
    { label: 'style', type: 'keyword', detail: 'Keyword' },
    { label: 'theme', type: 'keyword', detail: 'Keyword' },
    { label: 'direction', type: 'keyword', detail: 'Keyword' },
    { label: 'LR', type: 'keyword', detail: 'Left-to-Right' },
    { label: 'TB', type: 'keyword', detail: 'Top-to-Bottom' },
    { label: 'BT', type: 'keyword', detail: 'Bottom-to-Top' },
    { label: 'RL', type: 'keyword', detail: 'Right-to-Left' },

    // Diagram types
    { label: 'flowchart', type: 'type', detail: 'Flowchart' },
    { label: 'sequence', type: 'type', detail: 'Sequence Diagram' },
    { label: 'class', type: 'type', detail: 'Class Diagram' },
    { label: 'state', type: 'type', detail: 'State Diagram' },
    { label: 'c4-context', type: 'type', detail: 'C4 Context Diagram' },
    { label: 'c4-container', type: 'type', detail: 'C4 Container Diagram' },
    { label: 'c4-component', type: 'type', detail: 'C4 Component Diagram' },
    { label: 'c4-code', type: 'type', detail: 'C4 Code Diagram' },
    { label: 'component', type: 'type', detail: 'Component Diagram' },
    { label: 'deployment', type: 'type', detail: 'Deployment Diagram' },
    { label: 'network', type: 'type', detail: 'Network Diagram' },
    { label: 'activity', type: 'type', detail: 'Activity Diagram' },
    { label: 'bpmn', type: 'type', detail: 'BPMN Diagram' },
    { label: 'dmn', type: 'type', detail: 'DMN Decision Table' },
    { label: 'usecase', type: 'type', detail: 'Use Case Diagram' },
    { label: 'entity-relationship', type: 'type', detail: 'ER Diagram' },
    { label: 'er', type: 'type', detail: 'ER Diagram (alias)' },
    { label: 'bar', type: 'type', detail: 'Bar Chart' },
    { label: 'line', type: 'type', detail: 'Line Chart' },
    { label: 'pie', type: 'type', detail: 'Pie Chart' },
    { label: 'radar', type: 'type', detail: 'Radar Chart' },
    { label: 'scatter', type: 'type', detail: 'Scatter Chart' },
    { label: 'sankey', type: 'type', detail: 'Sankey Diagram' },
    { label: 'gantt', type: 'type', detail: 'Gantt Chart' },
    { label: 'timeline', type: 'type', detail: 'Timeline' },
    { label: 'mindmap', type: 'type', detail: 'Mind Map' },
    { label: 'gitgraph', type: 'type', detail: 'Git Graph' },
    { label: 'form', type: 'type', detail: 'Form Definition' },
    { label: 'block', type: 'type', detail: 'Block Diagram' },

    // Themes
    { label: 'sketchy-light', type: 'keyword', detail: 'Theme' },
    { label: 'sketchy-dark', type: 'keyword', detail: 'Theme' },
    { label: 'blueprint', type: 'keyword', detail: 'Theme' },
    { label: 'monochrome', type: 'keyword', detail: 'Theme' },
    { label: 'clean', type: 'keyword', detail: 'Theme' },
  ];

  return {
    from: word.from,
    options,
    validFor: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
  };
}

// ── Indentation ──────────────────────────────────────────────────────────────

/** Compute indentation for SelDiA DSL based on brace depth */
export function seldiaIndent(context: { state: EditorState }) {
  const head = context.state.selection.main.head;
  const doc = context.state.doc;
  const line: Line = doc.lineAt(head);
  const prevLineNum = Math.max(1, line.number - 1);
  const prevLine: Line = doc.line(prevLineNum);

  // Increase indent if prev line ends with opening brace
  if (prevLine.text.trimEnd().endsWith('{')) {
    return { column: prevLine.text.search(/\S|$/) + 2 };
  }

  // Check for de-indent if this line starts with closing brace
  if (line.text.trimStart().startsWith('}')) {
    const baseIndent = prevLine.text.search(/\S|$/);
    return { column: Math.max(0, baseIndent - 2) };
  }

  return undefined;
}

// ── Default export ───────────────────────────────────────────────────────────

export default seldiaLanguage;
