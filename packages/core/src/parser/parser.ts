// =============================================================================
// SelDiA — DSL Recursive-Descent Parser
// =============================================================================
// Hand-written parser replacing the Peggy grammar. Avoids Peggy's limitation
// with special characters (like `}`) in grammar rules and gives us full
// control over error messages and recovery.

import type { DiagramAST, ASTStatement, ASTNodeDecl, ASTEdgeDecl, ASTThemeDecl, ASTGroupDecl, ASTComment } from '../ast/nodes.js';
import type { Diagnostic, Result, SourceLocation } from '../types/common.js';
import { DiagnosticSeverity } from '../types/common.js';
import { ShapeType } from '../types/shapes.js';

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export interface Token {
  type: TokenType;
  value: string;
  offset: number;
  line: number;
  col: number;
}

enum TokenType {
  // Literals
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  IDENT = 'IDENT',
  // Keywords (matched case-insensitively from identifiers)
  KW_DIAGRAM = 'DIAGRAM',
  KW_THEME = 'THEME',
  KW_GROUP = 'GROUP',
  KW_SECTION = 'SECTION',
  KW_LAYOUT = 'LAYOUT',
  KW_STYLE = 'STYLE',
  // Symbols
  COLON = 'COLON',         // :
  COMMA = 'COMMA',         // ,
  LBRACE = 'LBRACE',       // {
  RBRACE = 'RBRACE',       // }
  ARROW = 'ARROW',         // ->  -->  <--  <-->  ---  ..>  ==>
  PIPE = 'PIPE',           // |
  COMMENT = 'COMMENT',     // // ...
  SHAPE = 'SHAPE',         // [...], (...), {text}, [/.../], etc.
  EOF = 'EOF',
}

interface CharPos {
  offset: number;
  line: number;
  col: number;
}

class Tokenizer {
  private source: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  // Stack tracking, for each currently-open `{`, whether it is a
  // diagram/group/section *body* brace or an *attribute-block* brace
  // (`{ key: value, ... }`). Statements — including the legacy diamond-shape
  // literal `key: {text}` — live directly inside a body brace; nested
  // object values (`layout: { x: 300, y: 200 }`) live inside an already-open
  // attribute-block brace. This lets `{` immediately after a COLON be
  // resolved correctly: diamond-shape only when the *nearest enclosing*
  // brace is a body (or we're at the top level), nested-object-value
  // whenever the nearest enclosing brace is itself an attribute block.
  //
  // Each pushed brace is classified by what precedes it:
  //  - preceded by STRING/IDENT-type-alias/KW_DIAGRAM/KW_GROUP/KW_SECTION
  //    (i.e. NOT immediately preceded by SHAPE, another attribute brace, or
  //    COLON) → 'body'
  //  - preceded by SHAPE, RBRACE (closing a shape), COLON, or already inside
  //    an 'attr' brace → 'attr'
  private braceStack: Array<'body' | 'attr'> = [];

  private inAttrContext(): boolean {
    return this.braceStack.length > 0 && this.braceStack[this.braceStack.length - 1] === 'attr';
  }

  constructor(source: string) {
    this.source = source;
  }

  private posInfo(): CharPos {
    return { offset: this.pos, line: this.line, col: this.col };
  }

  private advance(n = 1): void {
    for (let i = 0; i < n && this.pos < this.source.length; i++) {
      if (this.source[this.pos] === '\n') { this.line++; this.col = 1; }
      else { this.col++; }
      this.pos++;
    }
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] || '';
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /[ \t\n\r]/.test(this.peek())) {
      this.advance();
    }
  }

  private makeToken(type: TokenType, value: string, start: CharPos): Token {
    return { type, value, offset: start.offset, line: start.line, col: start.col };
  }

  private readString(): Token {
    const start = this.posInfo();
    this.advance(); // skip opening "
    let value = '';
    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance();
        const esc = this.peek();
        // Decode common escapes to their real characters so consumers never
        // see the raw two-character sequence (previously `\n` in DSL source
        // became the literal letter "n" here — the backslash was silently
        // dropped — which broke every downstream `\n`-as-newline convention).
        if (esc === 'n') value += '\n';
        else if (esc === 't') value += '\t';
        else value += esc;
      }
      else { value += this.peek(); }
      this.advance();
    }
    if (this.peek() === '"') this.advance(); // skip closing "
    else throw new ParseError('Unclosed string literal', start);
    return this.makeToken(TokenType.STRING, value, start);
  }

  private readIdentOrKeyword(start: CharPos): Token {
    let value = '';
    while (this.pos < this.source.length && /[a-zA-Z0-9_-]/.test(this.peek())) {
      // A hyphen that begins an arrow (`->`, `-->`, `---`) terminates the
      // identifier so that `a-->b` tokenizes as `a` `-->` `b` (not `a--`).
      // A hyphen inside an identifier (`my-node`) is followed by a name char.
      if (this.peek() === '-' && (this.peek(1) === '-' || this.peek(1) === '>')) break;
      value += this.peek();
      this.advance();
    }
    const lower = value.toLowerCase();
    switch (lower) {
      case 'diagram': return this.makeToken(TokenType.KW_DIAGRAM, value, start);
      case 'theme':   return this.makeToken(TokenType.KW_THEME, value, start);
      case 'group':   return this.makeToken(TokenType.KW_GROUP, value, start);
      case 'section': return this.makeToken(TokenType.KW_SECTION, value, start);
      case 'layout':  return this.makeToken(TokenType.KW_LAYOUT, value, start);
      case 'style':   return this.makeToken(TokenType.KW_STYLE, value, start);
      default:        return this.makeToken(TokenType.IDENT, value, start);
    }
  }

  private readArrow(start: CharPos): Token | null {
    const c1 = this.peek(), c2 = this.peek(1), c3 = this.peek(2), c4 = this.peek(3);
    const patterns: [string, string][] = [
      ['<-->', '<-->'], ['<->', '<->'], ['-->', '-->'], ['->', '->'],
      ['<--', '<--'], ['---', '---'], ['--', '--'],
      ['..>', '..>'], ['==>', '==>'],
    ];
    for (const [pat] of patterns) {
      if (this.source.startsWith(pat, this.pos)) {
        this.advance(pat.length);
        return this.makeToken(TokenType.ARROW, pat, start);
      }
    }
    return null;
  }

  private readShape(start: CharPos): Token | null {
    // Multi-char shape brackets checked first
    const multiShapes: [string, string][] = [
      ['[||', '||]'], ['[()', '()]'], ['[//', '//]'],
      ['[\\\\', '\\\\]'], ['[/', '/]'], ['[\\', '\\]'],
      ['[[', ']]'], ['((', '))'], ['[(', ')]'],
    ];
    for (const [open, close] of multiShapes) {
      if (this.source.startsWith(open, this.pos)) {
        this.advance(open.length);
        let value = '';
        while (this.pos < this.source.length && !this.source.startsWith(close, this.pos)) {
          value += this.peek();
          this.advance();
        }
        if (this.source.startsWith(close, this.pos)) {
          this.advance(close.length);
          return this.makeToken(TokenType.SHAPE, open + value + close, start);
        }
        throw new ParseError(`Unclosed shape bracket "${open}"`, start);
      }
    }
    // Single-char shape: @...@
    if (this.peek() === '@') {
      const delim = this.peek();
      this.advance();
      let value = '';
      while (this.pos < this.source.length && this.peek() !== delim) {
        value += this.peek();
        this.advance();
      }
      if (this.peek() === delim) { this.advance(); return this.makeToken(TokenType.SHAPE, delim + value + delim, start); }
      throw new ParseError(`Unclosed shape delimiter "${delim}"`, start);
    }
    // Simple brackets: [...], (...), <...>
    const simplePairs: [string, string][] = [['[', ']'], ['(', ')'], ['<', '>']];
    for (const [open, close] of simplePairs) {
      if (this.peek() === open) {
        this.advance();
        let value = '';
        let depth = 1;
        while (this.pos < this.source.length && depth > 0) {
          if (this.peek() === open) depth++;
          else if (this.peek() === close) depth--;
          if (depth > 0) { value += this.peek(); this.advance(); }
        }
        if (depth === 0) { this.advance(); return this.makeToken(TokenType.SHAPE, open + value + close, start); }
        throw new ParseError(`Unclosed "${open}" bracket`, start);
      }
    }
    return null;
  }

  private readComment(start: CharPos): Token {
    this.advance(2); // skip //
    let value = '';
    while (this.pos < this.source.length && this.peek() !== '\n') {
      value += this.peek();
      this.advance();
    }
    return this.makeToken(TokenType.COMMENT, value, start);
  }

  private readNumber(start: CharPos): Token {
    let value = '';
    while (this.pos < this.source.length && /[0-9.]/.test(this.peek())) {
      value += this.peek();
      this.advance();
    }
    return this.makeToken(TokenType.NUMBER, value, start);
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) break;
      const start = this.posInfo();
      const ch = this.peek();

      // Comments
      if (ch === '/' && this.peek(1) === '/') {
        tokens.push(this.readComment(start));
        continue;
      }

      // String literals
      if (ch === '"') { tokens.push(this.readString()); continue; }

      // Arrows: -, <, =, .
      if (ch === '-' || ch === '<' || ch === '=' || ch === '.') {
        const arr = this.readArrow(start);
        if (arr) { tokens.push(arr); continue; }
      }

      // Shape brackets: [, (, @
      // Note: colon : is NOT here — it's handled as COLON token (actor shapes use :: syntax handled at parser level)
      if (ch === '[' || ch === '(' || ch === '@') {
        const shape = this.readShape(start);
        if (shape) { tokens.push(shape); continue; }
      }

      // LBRACE / RBRACE
      if (ch === '}') {
        this.advance();
        tokens.push(this.makeToken(TokenType.RBRACE, '}', start));
        this.braceStack.pop();
        continue;
      }
      if (ch === '{') {
        // Diamond shape {text} only when preceded by colon (old syntax) AND
        // the nearest enclosing brace is a body brace (or we're at the top
        // level) — inside an attribute block, a COLON-then-`{` is a nested
        // object value instead (`layout: { x: 300, y: 200 }`). Without this
        // context check, that inner `{` was misread as a diamond-shape
        // literal, silently truncating the outer attribute block.
        const prevTok = tokens.length > 0 ? tokens[tokens.length - 1] : null;
        if (prevTok && prevTok.type === TokenType.COLON && !this.inAttrContext()) {
          this.advance(); // skip {
          let raw = '';
          while (this.pos < this.source.length && this.peek() !== '}') {
            raw += this.peek();
            this.advance();
          }
          if (this.peek() === '}') this.advance();
          tokens.push(this.makeToken(TokenType.SHAPE, '{' + raw + '}', start));
          continue;
        }
        this.advance();
        tokens.push(this.makeToken(TokenType.LBRACE, '{', start));
        // Classify the brace we just opened: an attribute block if it's
        // nested inside another attribute block, or immediately preceded by
        // a COLON (nested value) or a SHAPE token (attribute block following
        // a node/edge's bracket shape, e.g. `a (Start) { x: 1 }`). A body
        // brace (diagram/group/section) is only ever opened right after the
        // diagram-header sequence — KW_DIAGRAM's type IDENT, a type-alias
        // IDENT, KW_GROUP's name, or KW_SECTION's label — optionally
        // followed by a title STRING. We identify that specifically by
        // scanning back past at most one STRING to find KW_DIAGRAM,
        // KW_GROUP, KW_SECTION, or an IDENT/STRING acting as a header name
        // — anything else preceding a STRING (e.g. a node id) means the
        // STRING was a *label*, so the brace is an attribute block.
        let isAttrOpen: boolean;
        if (this.inAttrContext()) {
          isAttrOpen = true;
        } else if (prevTok && (prevTok.type === TokenType.COLON || prevTok.type === TokenType.SHAPE)) {
          isAttrOpen = true;
        } else if (prevTok && prevTok.type === TokenType.STRING) {
          // Could be a diagram/group/section title STRING (body) or a node's
          // label STRING (attr, e.g. `a "Label" { x: 1 }`). Distinguish by
          // what precedes the STRING: KW_DIAGRAM/KW_GROUP/KW_SECTION or a
          // bare header IDENT with nothing before it (or preceded only by
          // KW_DIAGRAM) means body; a node/edge id followed directly by a
          // label STRING means attr.
          // NB: the LBRACE itself was already pushed above, so it sits at
          // tokens[length-1] and the title STRING at [length-2] — the token
          // *before* the STRING is therefore [length-3], not [length-2].
          const beforeStr = tokens.length > 2 ? tokens[tokens.length - 3] : null;
          // Diagram/group/section header keyword before the title STRING,
          // OR this is the type-alias header form (`fl "Title" {`) where the
          // STRING is the very first or second token of the whole file (an
          // IDENT type-alias with no id before it, since a real node
          // declaration is never the first statement of the source).
          const isDiagramKeywordHeader = !!beforeStr && (
            beforeStr.type === TokenType.KW_DIAGRAM ||
            beforeStr.type === TokenType.KW_GROUP ||
            beforeStr.type === TokenType.KW_SECTION);
          // The canonical header `diagram <type> "Title" {` puts the *type*
          // IDENT — not KW_DIAGRAM — directly before the title STRING, so
          // isDiagramKeywordHeader misses it. Look one token further back for
          // KW_DIAGRAM. Without this the diagram's own body brace is
          // classified 'attr', which makes inAttrContext() true for every
          // statement in the file and silently demotes the diamond-shape form
          // `id: {Gateway?}` to a nested-object-value brace.
          const beforeType = tokens.length > 3 ? tokens[tokens.length - 4] : null;
          const isTypedDiagramHeader = !!beforeStr && beforeStr.type === TokenType.IDENT &&
            !!beforeType && beforeType.type === TokenType.KW_DIAGRAM;
          const isTypeAliasHeader = !!beforeStr && beforeStr.type === TokenType.IDENT &&
            tokens.length === 3; // exactly [IDENT type-alias, STRING title, LBRACE]
          isAttrOpen = !(isDiagramKeywordHeader || isTypedDiagramHeader || isTypeAliasHeader);
        } else {
          isAttrOpen = false;
        }
        this.braceStack.push(isAttrOpen ? 'attr' : 'body');
        continue;
      }
      if (ch === ':') { this.advance(); tokens.push(this.makeToken(TokenType.COLON, ':', start)); continue; }
      if (ch === ',') { this.advance(); tokens.push(this.makeToken(TokenType.COMMA, ',', start)); continue; }
      if (ch === '|') { this.advance(); tokens.push(this.makeToken(TokenType.PIPE, '|', start)); continue; }

      // Identifiers or keywords (include + and / for path-like names)
      if (/[a-zA-Z_]/.test(ch)) { tokens.push(this.readIdentOrKeyword(start)); continue; }

      // Numbers
      if (/[0-9]/.test(ch)) { tokens.push(this.readNumber(start)); continue; }

      // Other characters: +, /, *, etc. — include as raw IDENT
      // so the parser can handle them (e.g. +id in class diagrams)
      this.advance();
      tokens.push(this.makeToken(TokenType.IDENT, ch, start));
      continue;
    }
    tokens.push({ type: TokenType.EOF, value: '', offset: this.pos, line: this.line, col: this.col });
    return tokens;
  }
}

// ---------------------------------------------------------------------------
// Shape keyword lookup
// ---------------------------------------------------------------------------

const SHAPE_KEYWORDS = new Set([
  'rounded', 'rect', 'rectangle', 'diamond', 'circle', 'ellipse',
  'hexagon', 'hex', 'parallelogram', 'para', 'cylinder', 'cyli', 'db',
  'cloud', 'stadium', 'flag', 'actor', 'person', 'participant', 'system', 'queue',
  'boundary', 'control', 'entity', 'database', 'storage',
  'container', 'component', 'gateway',
]);

/**
 * Re-join tokens of an unquoted label using their original columns, so
 * `GET /authorize` doesn't come back as `GET / authorize`. Tokens on one line
 * are gap-reconstructed from `col`; a quoted segment keeps its quotes, since
 * the tokenizer strips them from `value` (`Click "Login"`).
 */
function joinTokenText(toks: Token[]): string {
  let out = '';
  let prevEnd = -1;
  for (const t of toks) {
    const text = t.type === TokenType.STRING ? `"${t.value}"` : t.value;
    if (prevEnd >= 0 && t.col > prevEnd) out += ' '.repeat(Math.min(t.col - prevEnd, 2));
    out += text;
    prevEnd = t.col + text.length;
  }
  return out.trim();
}

function isShapeKeyword(word: string): boolean {
  // Strip C4 _Ext / _ext suffix so system_Ext matches 'system'
  const normalized = word.replace(/_ext$/i, '');
  return SHAPE_KEYWORDS.has(normalized.toLowerCase());
}

function shapeKeywordToShapeType(word: string): ShapeType {
  // Normalize: strip _Ext / _ext suffix before lookup
  const normalized = word.replace(/_ext$/i, '').toLowerCase();
  switch (normalized) {
    case 'rounded': case 'round': return ShapeType.ROUNDED_RECTANGLE;
    case 'rect': case 'rectangle': return ShapeType.RECTANGLE;
    case 'diamond': return ShapeType.DIAMOND;
    case 'circle': case 'ellipse': return ShapeType.CIRCLE;
    case 'hexagon': case 'hex': return ShapeType.HEXAGON;
    case 'parallelogram': case 'para': return ShapeType.PARALLELOGRAM;
    case 'cylinder': case 'cyli': case 'db': case 'database': case 'storage': return ShapeType.CYLINDER;
    case 'cloud': return ShapeType.CLOUD;
    case 'stadium': return ShapeType.STADIUM;
    case 'flag': case 'note': return ShapeType.NOTE;
    case 'actor': case 'person': case 'user': case 'participant': return ShapeType.ACTOR;
    case 'gateway': return ShapeType.DIAMOND;
    case 'system': case 'container': case 'component':
    case 'queue': case 'boundary':
    case 'control': case 'entity': return ShapeType.RECTANGLE;
    default: return ShapeType.RECTANGLE;
  }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

class ParseError extends Error {
  start: CharPos;
  constructor(msg: string, start: CharPos) {
    super(msg);
    this.start = start;
    this.name = 'ParseError';
  }
}

function toDiagnostic(err: ParseError, filePath?: string): Diagnostic {
  return {
    severity: DiagnosticSeverity.ERROR,
    message: err.message,
    source: {
      file: filePath || '<unknown>',
      startLine: err.start.line,
      startColumn: err.start.col,
      endLine: err.start.line,
      endColumn: err.start.col + 1,
      offset: err.start.offset,
    },
    code: 'PARSE_ERROR',
  };
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

function detectShape(text: string): { shape: ShapeType; label: string } {
  let shape: ShapeType = ShapeType.RECTANGLE;

  if (text.startsWith('[||')) shape = ShapeType.CYLINDER;
  else if (text.startsWith('[()')) shape = ShapeType.STADIUM;
  else if (text.startsWith('[//') || text.startsWith('[\\\\')) shape = ShapeType.PARALLELOGRAM;
  else if (text.startsWith('[/') || text.startsWith('[\\')) shape = ShapeType.PARALLELOGRAM;
  else if (text.startsWith('((')) shape = ShapeType.CIRCLE;
  else if (text.startsWith('[[')) shape = ShapeType.RECTANGLE;
  else if (text.startsWith('[')) shape = ShapeType.RECTANGLE;
  else if (text.startsWith('(')) shape = ShapeType.ROUNDED_RECTANGLE;
  else if (text.startsWith('{')) shape = ShapeType.DIAMOND;
  else if (text.startsWith('<')) shape = ShapeType.HEXAGON;
  else if (text.startsWith('@')) shape = ShapeType.CLOUD;
  else if (text.startsWith(':')) shape = ShapeType.ACTOR;

  // Extract label from brackets
  const multiPairs: [string, string][] = [
    ['[||', '||]'], ['[()', '()]'], ['[//', '//]'],
    ['[\\\\', '\\\\]'], ['[/', '/]'], ['[\\', '\\]'],
    ['[[', ']]'], ['((', '))'], ['[(', ')]'],
  ];
  for (const [open, close] of multiPairs) {
    if (text.startsWith(open) && text.endsWith(close)) {
      return { shape, label: text.slice(open.length, text.length - close.length).trim() };
    }
  }
  const simplePairs: [string, string][] = [
    ['{', '}'], ['[', ']'], ['(', ')'], ['<', '>'],
    ['@', '@'], [':', ':'],
  ];
  for (const [open, close] of simplePairs) {
    if (text.startsWith(open) && text.endsWith(close)) {
      return { shape, label: text.slice(open.length, text.length - close.length).trim() };
    }
  }
  return { shape, label: text };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  }

  private consume(): Token {
    return this.tokens[this.pos++] || this.tokens[this.tokens.length - 1];
  }

  private expect(type: TokenType, msg?: string): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new ParseError(msg || `Expected ${type} but got "${t.value || t.type}"`, t);
    }
    return this.consume();
  }

  private match(...types: TokenType[]): Token | null {
    const t = this.peek();
    if (types.includes(t.type)) return this.consume();
    return null;
  }

  /**
   * Consume an identifier-like token: a plain IDENT, or one of the reserved
   * keyword tokens (theme/group/section/layout/style) used as a node name —
   * e.g. `theme --> dd` where `theme` is a node id, not the theme decl.
   */
  private expectIdentLike(msg: string): Token {
    const t = this.peek();
    const isIdentLike = t.type === TokenType.IDENT || t.type === TokenType.KW_THEME ||
      t.type === TokenType.KW_GROUP || t.type === TokenType.KW_SECTION ||
      t.type === TokenType.KW_LAYOUT || t.type === TokenType.KW_STYLE ||
      t.type === TokenType.KW_DIAGRAM;
    if (!isIdentLike) throw new ParseError(msg, t);
    return this.consume();
  }

  loc(tok: Token): SourceLocation {
    return {
      file: '<unknown>',
      startLine: tok.line,
      startColumn: tok.col,
      endLine: tok.line,
      endColumn: tok.col + tok.value.length,
      offset: tok.offset,
    };
  }

  locSpan(start: Token, end: Token): SourceLocation {
    return {
      file: '<unknown>',
      startLine: start.line,
      startColumn: start.col,
      endLine: end.line,
      endColumn: end.col + end.value.length,
      offset: start.offset,
    };
  }

  // ── Diagram ──────────────────────────────────────────────────────────────
  parseDiagram(): DiagramAST {
    // Skip leading comments before the diagram keyword
    while (this.peek().type === TokenType.COMMENT) this.consume();

    const firstTok = this.peek();

    // New syntax: type alias directly (fl "Title" { ... })
    // Looahead: if it's an IDENT and next is STRING, LBRACE, or another
    // IDENT that looks like a subtype (for chart subtypes, etc.)
    const isTypeAlias = firstTok.type === TokenType.IDENT &&
      (this.peek(1).type === TokenType.STRING || this.peek(1).type === TokenType.LBRACE ||
       (this.peek(1).type === TokenType.IDENT && (this.peek(2).type === TokenType.STRING || this.peek(2).type === TokenType.LBRACE)));

    // Legacy syntax: diagram <type> "Title" { ... }
    const isLegacy = firstTok.type === TokenType.KW_DIAGRAM;

    if (!isTypeAlias && !isLegacy) {
      throw new ParseError(
        'Expected diagram type (e.g. fl, seq, cls) or "diagram" keyword',
        firstTok
      );
    }

    let typeTok: Token;
    if (isLegacy) {
      this.consume(); // skip 'diagram'
      typeTok = this.expect(TokenType.IDENT, 'Expected diagram type (e.g. flowchart)');
    } else {
      typeTok = this.consume();
    }

    let type = typeTok.value.toLowerCase();

    // Map type aliases to canonical names
    const TYPE_ALIASES: Record<string, string> = {
      fl: 'flowchart', seq: 'sequence', cls: 'class', er: 'er',
      st: 'state', uc: 'usecase', act: 'activity',
      comp: 'component', deploy: 'deployment',
      bpmn: 'bpmn', dmn: 'dmn', gantt: 'gantt',
      mind: 'mindmap', net: 'network',
      chart: 'chart', git: 'gitgraph',
      form: 'form', sankey: 'sankey',
      block: 'block', time: 'timeline',
      wireframe: 'wireframe', cloud: 'cloud',
      workitem: 'workitem', wi: 'workitem', work: 'workitem',
      trace: 'workitem', backlog: 'workitem',
    };
    type = TYPE_ALIASES[type] || type;

    // Handle multi-word types like "c4 context"
    if (type === 'c4' || type === 'c4c' || type === 'c4con' || type === 'c4comp' || type === 'c4code') {
      if (type === 'c4c') type = 'c4-context';
      else if (type === 'c4con') type = 'c4-container';
      else if (type === 'c4comp') type = 'c4-component';
      else if (type === 'c4code') type = 'c4-code';
      else {
        type = 'c4';
        const sub = this.peek().type === TokenType.IDENT ? this.consume().value.toLowerCase() : '';
        if (sub === 'context') type = 'c4-context';
        else if (sub === 'container') type = 'c4-container';
        else if (sub === 'component') type = 'c4-component';
        else if (sub === 'code') type = 'c4-code';
      }
    }

    // chart sub-types
    if (type === 'chart') {
      const sub = this.peek().type === TokenType.IDENT ? this.consume().value.toLowerCase() : '';
      if (sub) type = 'chart-' + sub;
    }

    let title: string | undefined;
    if (this.peek().type === TokenType.STRING) {
      title = this.consume().value;
    }
    this.expect(TokenType.LBRACE, 'Expected "{" after diagram header');
    const body = this.parseStatements();
    this.expect(TokenType.RBRACE, 'Expected "}" after diagram body');

    return {
      kind: 'Diagram',
      type: type as any,
      title,
      metadata: {},
      body,
      loc: this.locSpan(typeTok, this.peek(-1)),
    };
  }

  // ── Statements ───────────────────────────────────────────────────────────
  parseStatements(): ASTStatement[] {
    const stmts: ASTStatement[] = [];
    while (this.peek().type !== TokenType.RBRACE && this.peek().type !== TokenType.EOF) {
      // Handle inline shape nodes used as edge sources: [*] -> New
      if (this.peek().type === TokenType.SHAPE && this.peek(1).type === TokenType.ARROW) {
        const srcNode = this.parseInlineNodeDecl();
        stmts.push(srcNode); // emit the node
        // Now parse the edge using the inline node as source
        const edgeTok = this.consume(); // ARROW
        let direction: 'right' | 'left' | 'both' | 'none' = 'right';
        switch (edgeTok.value) {
          case '->': case '-->': direction = 'right'; break;
          case '<--': direction = 'left'; break;
          case '<->': case '<-->': direction = 'both'; break;
          case '--': case '---': direction = 'none'; break;
          case '..>': case '==>': direction = 'right'; break;
        }
        let label: string | undefined;
        if (this.peek().type === TokenType.PIPE) {
          this.consume();
          const labelTok = this.expect(TokenType.STRING, 'Expected string in edge label');
          this.expect(TokenType.PIPE, 'Expected closing "|"');
          label = labelTok.value;
        }
        // Target can be IDENT or SHAPE (inline node like [*])
        let tgtTok: Token;
        let tgtId: string;
        if (this.peek().type === TokenType.SHAPE) {
          const shapeTok = this.consume();
          const detected = detectShape(shapeTok.value);
          tgtId = detected.label.replace(/[^a-zA-Z0-9_-]/g, '_') || 'target';
          tgtTok = shapeTok;
          // Also emit the target node
          stmts.push({
            kind: 'NodeDecl', id: tgtId, shape: detected.shape, label: detected.label,
            description: undefined, style: undefined,
            loc: this.loc(shapeTok),
          } as any);
        } else {
          tgtTok = this.expectIdentLike('Expected target node identifier');
          tgtId = tgtTok.value;
        }
        // Optional label after target: : "label" (state/sequence syntax)
        if (!label && this.peek().type === TokenType.COLON) {
          this.consume();
          if (this.peek().type === TokenType.STRING) {
            label = this.consume().value;
          } else if (this.peek().type === TokenType.IDENT) {
            // An unquoted label runs to the end of its own line and no
            // further. There's no NEWLINE token, so the line number is the
            // only terminator available — without it this loop ran to the
            // closing brace and swallowed every following statement into one
            // label (a whole sequence diagram collapsed to a single edge).
            const labelLine = this.peek().line;
            const labelToks: Token[] = [];
            while (this.peek().type !== TokenType.EOF && this.peek().type !== TokenType.RBRACE &&
                   this.peek().type !== TokenType.KW_DIAGRAM &&
                   this.peek().line === labelLine) {
              labelToks.push(this.consume());
            }
            label = joinTokenText(labelToks);
          }
        }
        stmts.push({
          kind: 'EdgeDecl', sourceId: srcNode.id, targetId: tgtId,
          direction, label, style: undefined, routing: 'straight',
          loc: {
            file: '<unknown>',
            startLine: srcNode.loc.startLine,
            startColumn: srcNode.loc.startColumn,
            endLine: tgtTok.line,
            endColumn: tgtTok.col + tgtTok.value.length,
            offset: srcNode.loc.offset,
          } as any,
        });
        continue;
      }
      // Handle chained edges: a --> b --> c
      // After an edge declaration, if next token is ARROW, chain to target
      if (this.peek().type === TokenType.ARROW && stmts.length > 0) {
        const prev = stmts[stmts.length - 1];
        if (prev.kind === 'EdgeDecl') {
          const prevEdge = prev as ASTEdgeDecl;
          const srcId = Array.isArray(prevEdge.targetId) ? prevEdge.targetId[0] : prevEdge.targetId;
          stmts.push(this.parseChainedEdge(srcId));
          continue;
        }
      }
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  /** Parse a chained edge after another edge: `-> target [... more chains]` */
  parseChainedEdge(sourceId: string): ASTEdgeDecl {
    const arrowTok = this.expect(TokenType.ARROW, 'Expected arrow in chained edge');
    let direction: 'right' | 'left' | 'both' | 'none' = 'right';
    switch (arrowTok.value) {
      case '->': case '-->': direction = 'right'; break;
      case '<--': direction = 'left'; break;
      case '<->': case '<-->': direction = 'both'; break;
      case '--': case '---': direction = 'none'; break;
      case '..>': case '==>': direction = 'right'; break;
    }
    let label: string | undefined;
    if (this.peek().type === TokenType.PIPE) {
      this.consume();
      const labelTok = this.expect(TokenType.STRING, 'Expected string in edge label');
      this.expect(TokenType.PIPE, 'Expected closing pipe');
      label = labelTok.value;
    }
    let tgtId: string;
    if (this.peek().type === TokenType.SHAPE) {
      const shapeTok = this.consume();
      const detected = detectShape(shapeTok.value);
      tgtId = detected.label.replace(/[^a-zA-Z0-9_-]/g, '_') || 'target';
    } else {
      const tgtTok = this.expectIdentLike('Expected target identifier in chained edge');
      tgtId = tgtTok.value;
    }
    if (!label && this.peek().type === TokenType.COLON) {
      this.consume();
      if (this.peek().type === TokenType.STRING) {
        label = this.consume().value;
      } else if (this.peek().type === TokenType.IDENT) {
        let parts = '';
        while (this.peek().type !== TokenType.EOF && this.peek().type !== TokenType.RBRACE) {
          parts += this.consume().value + ' ';
        }
        label = parts.trim();
      }
    }
    return {
      kind: 'EdgeDecl', sourceId, targetId: tgtId,
      direction, label, style: undefined, routing: 'straight',
      loc: { file: '<unknown>', startLine: arrowTok.line, startColumn: arrowTok.col, endLine: arrowTok.line, endColumn: arrowTok.col + arrowTok.value.length, offset: arrowTok.offset },
    };
  }

  // Sequence-diagram control fragments (`alt`/`else`/`opt`/`loop`/`par`, all
  // closed by `end`) are documented in user_guide.md but had no grammar at
  // all, so a file using them failed to parse outright. They're consumed here
  // as line-scoped markers: the fragment's own header/`end` lines produce no
  // statement, and the messages inside them parse normally as edges. That
  // renders the file correctly minus the fragment's visual box — a nesting
  // bracket around a time range of messages, which IRGroup (a bounding box
  // over member *nodes*) can't express. Keeping the marker keyword and label
  // on the AST so a future sequence-fragment renderer has them to work with.
  private isFragmentKeyword(v: string): boolean {
    return /^(alt|else|opt|loop|par|critical|break)$/i.test(v);
  }

  parseStatement(): ASTStatement | null {
    // Skip comments
    if (this.peek().type === TokenType.COMMENT) {
      const tok = this.consume();
      return { kind: 'Comment', text: tok.value, loc: this.loc(tok) };
    }
    // Keywords (theme/group/section/layout/style) used as a plain node id
    // are treated as node declarations when followed by a shape, string, or
    // arrow — only treat them as keyword decls when followed by ident/string
    // that matches the keyword's expected grammar.
    const isKeywordAsIdent = (): boolean => {
      const next = this.peek(1);
      // Followed by shape bracket → definitely a node: `theme [Manager]`
      if (next.type === TokenType.SHAPE) return true;
      // Followed by arrow → edge source: `theme -> node`
      if (next.type === TokenType.ARROW) return true;
      // Followed by keyword shape name → node: `theme rect "Name"`
      if (next.type === TokenType.IDENT && isShapeKeyword(next.value) &&
          (this.peek(2).type === TokenType.STRING || this.peek(2).type === TokenType.SHAPE)) return true;
      return false;
    };
    // Theme declaration
    if (this.peek().type === TokenType.KW_THEME && !isKeywordAsIdent()) {
      return this.parseThemeDecl();
    }
    // Group declaration
    if (this.peek().type === TokenType.KW_GROUP && !isKeywordAsIdent()) {
      return this.parseGroupDecl();
    }
    // Section declaration
    if (this.peek().type === TokenType.KW_SECTION && !isKeywordAsIdent()) {
      return this.parseSectionDecl();
    }
    // Layout declaration
    if (this.peek().type === TokenType.KW_LAYOUT && !isKeywordAsIdent()) {
      return this.parseLayoutDecl();
    }
    // Style block
    if (this.peek().type === TokenType.KW_STYLE && !isKeywordAsIdent()) {
      return this.parseStyleBlock();
    }
    // Node or Edge declaration — identifier followed by shape, label, or arrow
    const isLikeIdent = (t: Token): boolean =>
      t.type === TokenType.IDENT ||
      t.type === TokenType.KW_THEME || t.type === TokenType.KW_GROUP ||
      t.type === TokenType.KW_SECTION || t.type === TokenType.KW_LAYOUT ||
      t.type === TokenType.KW_STYLE || t.type === TokenType.KW_DIAGRAM;

    if (isLikeIdent(this.peek())) {
      const tok = this.peek();
      const next = this.peek(1);
      const next2 = this.peek(2);
      const tokLower = tok.value.toLowerCase();

      // `end` closes a fragment — a bare marker with nothing after it.
      if (tokLower === 'end' && next.line !== tok.line) {
        const t = this.consume();
        return { kind: 'FragmentMarker', keyword: 'end', loc: this.loc(t) } as ASTStatement;
      }
      // `alt valid credentials` / `loop retry` / bare `par`. Only when the
      // keyword isn't being used as an ordinary node or edge id — `alt (Box)`,
      // `alt -> b` and `alt: "x"` must still declare a node called "alt".
      if (this.isFragmentKeyword(tokLower) &&
          next.type !== TokenType.SHAPE && next.type !== TokenType.ARROW &&
          next.type !== TokenType.COLON && next.type !== TokenType.STRING) {
        const kw = this.consume();
        const labelToks: Token[] = [];
        while (this.peek().type !== TokenType.EOF && this.peek().line === kw.line) {
          labelToks.push(this.consume());
        }
        const label = joinTokenText(labelToks);
        return { kind: 'FragmentMarker', keyword: tokLower, label: label || undefined, loc: this.loc(kw) } as ASTStatement;
      }

      // Bare theme name: sketchy [light|dark], smooth [light|dark], mono
      if (tokLower === 'sketchy' || tokLower === 'smooth' || tokLower === 'mono') {
        return this.parseBareTheme();
      }

      // id (Label) — bracket shape node
      if (next.type === TokenType.SHAPE) {
        return this.parseNodeDecl();
      }
      // id "Label" — default shape node
      if (next.type === TokenType.STRING) {
        return this.parseNodeDecl();
      }
      // id: (Label) / id: "Label" / id: shape "Label" — colon-separated node
      // declaration form (e.g. `start: (Start)`), used throughout some
      // example fixtures alongside the colon-less `start (Start)` form.
      // Both are accepted; parseNodeDecl() itself consumes the optional
      // colon right after the id.
      if (next.type === TokenType.COLON &&
          (next2.type === TokenType.SHAPE || next2.type === TokenType.STRING ||
           (next2.type === TokenType.IDENT && isShapeKeyword(next2.value)))) {
        return this.parseNodeDecl();
      }
      // id -> target — edge
      if (next.type === TokenType.ARROW) {
        return this.parseEdgeDecl();
      }
      // id shape "Label" — keyword shape node
      if (next.type === TokenType.IDENT && isShapeKeyword(next.value) &&
          (next2.type === TokenType.STRING || next2.type === TokenType.SHAPE || next2.type === TokenType.LBRACE)) {
        return this.parseNodeDecl();
      }
      // shape id "Label" — typed node (C4-style: rectangle server "Web Server")
      // The COLON variant (`person customer: "Bank Customer"`, `participant
      // user: "User"`) is the spelling examples/ actually uses; it reads as a
      // separate keyword form but is the same declaration, so it routes here
      // and parseTypedNodeDecl() eats the optional colon before the label.
      if (isShapeKeyword(tok.value) && next.type === TokenType.IDENT &&
          (next2.type === TokenType.STRING || next2.type === TokenType.SHAPE ||
           next2.type === TokenType.LBRACE || next2.type === TokenType.ARROW ||
           next2.type === TokenType.COLON)) {
        return this.parseTypedNodeDecl();
      }
      // id <-- or id -- or id <-> — reverse/undirected/bidirectional edge
      // (these need a separate check since next is ARROW, already handled above)
      throw new ParseError(
        `Expected shape, label, or arrow after "${tok.value}" — ` +
        `try: ${tok.value} (Label) or ${tok.value} "Label" or ${tok.value} -> target`,
        tok
      );
    }
    // Standalone inline shape node (no following arrow)
    if (this.peek().type === TokenType.SHAPE) {
      return this.parseInlineNodeDecl();
    }
    throw new ParseError(`Unexpected token "${this.peek().value}"`, this.peek());
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  parseThemeDecl(): ASTThemeDecl {
    const kw = this.consume(); // theme keyword (or bare theme name handled in parseStatement)
    // Accept bare identifiers as theme name: `sketchy light`
    // Also accept string: `theme "sketchy-light"`
    let themeName = '';
    let variant = '';

    if (this.peek().type === TokenType.STRING) {
      themeName = this.consume().value;
    } else if (this.peek().type === TokenType.IDENT) {
      themeName = this.consume().value;
      // Optional variant: sketchy light, smooth dark
      if (this.peek().type === TokenType.IDENT) {
        variant = this.consume().value;
      }
    }

    // Build the theme string from name + variant
    const theme = variant ? `${themeName}-${variant}` : themeName;
    return { kind: 'ThemeDecl', theme, loc: this.locSpan(kw, this.peek(-1)) };
  }

  /** Parse a bare theme name without the `theme` keyword.
   *  e.g. `sketchy light`, `smooth dark`, `mono` */
  parseBareTheme(): ASTThemeDecl {
    const name = this.consume().value.toLowerCase();
    let variant = '';
    if (this.peek().type === TokenType.IDENT) {
      const v = this.peek().value.toLowerCase();
      if (v === 'light' || v === 'dark') {
        variant = this.consume().value;
      }
    }
    const theme = variant ? `${name}-${variant}` : `${name}-light`;
    return { kind: 'ThemeDecl', theme, loc: this.locSpan(name as any, this.peek(-1)) };
  }

  // ── Node ─────────────────────────────────────────────────────────────────
  parseNodeDecl(): ASTNodeDecl {
    const idTok = this.consume(); // id

    // Optional colon between id and shape/label: `start: (Start)`. Purely
    // cosmetic — equivalent to the colon-less `start (Start)` form used
    // elsewhere; consumed and discarded here so the rest of this method
    // (which expects shape/label tokens to immediately follow) doesn't need
    // to change.
    if (this.peek().type === TokenType.COLON) this.consume();

    // Check if the next token is a shape keyword (id shape "Label")
    let shape: ShapeType = ShapeType.RECTANGLE;
    let label = idTok.value;

    if (this.peek().type === TokenType.SHAPE) {
      // Bracket shape: id (Label) or id [Label]
      const shapeTok = this.consume();
      const detected = detectShape(shapeTok.value);
      shape = detected.shape;
      label = detected.label;
    } else if (this.peek().type === TokenType.IDENT && isShapeKeyword(this.peek().value)) {
      // Keyword shape: id rounded "Label" or id rect "Label"
      const shapeKw = this.consume().value.toLowerCase();
      shape = shapeKeywordToShapeType(shapeKw);
      // Next should be a string label
      if (this.peek().type === TokenType.STRING) {
        label = this.consume().value;
      } else if (this.peek().type === TokenType.SHAPE) {
        // Fallback: id shape (Label) — parse bracket shape after keyword
        const shapeTok = this.consume();
        const detected = detectShape(shapeTok.value);
        label = detected.label;
      }
      // Collect extra strings as description (for C4-style metadata)
      const extra: string[] = [];
      while (this.peek().type === TokenType.STRING) {
        extra.push(this.consume().value);
      }
      if (extra.length > 0) {
        // Store description with the node's data
        const style = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
        return {
          kind: 'NodeDecl', id: idTok.value, shape, label,
          description: extra.join(' — '), style,
          loc: this.locSpan(idTok, this.peek(-1)),
        } as ASTNodeDecl;
      }
    } else if (this.peek().type === TokenType.STRING) {
      // Plain label: id "Label"
      label = this.consume().value;
      // Collect extra strings as description
      const extra: string[] = [];
      while (this.peek().type === TokenType.STRING) {
        extra.push(this.consume().value);
      }
      if (extra.length > 0) {
        const style = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
        return {
          kind: 'NodeDecl', id: idTok.value, shape, label,
          description: extra.join(' — '), style,
          loc: this.locSpan(idTok, this.peek(-1)),
        } as ASTNodeDecl;
      }
    }

    const style = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
    return {
      kind: 'NodeDecl', id: idTok.value, shape, label,
      description: undefined, style, loc: this.locSpan(idTok, this.peek(-1)),
    };
  }

  /** Parse a typed node: shape id "Label" (C4-style)
   *  e.g. `person customer "Customer"` or `system server "Web Server"` */
  parseTypedNodeDecl(): ASTNodeDecl {
    const shapeKw = this.consume().value.toLowerCase(); // shape keyword
    const shape = shapeKeywordToShapeType(shapeKw);
    const idTok = this.consume(); // node id

    // Optional colon between id and label: `participant user: "User"`.
    if (this.peek().type === TokenType.COLON) this.consume();

    let label = idTok.value;
    if (this.peek().type === TokenType.STRING) {
      label = this.consume().value;
    } else if (this.peek().type === TokenType.SHAPE) {
      const shapeTok = this.consume();
      const detected = detectShape(shapeTok.value);
      label = detected.label;
    }

    // Collect extra strings as description
    const extra: string[] = [];
    while (this.peek().type === TokenType.STRING) {
      extra.push(this.consume().value);
    }
    const description = extra.length > 0 ? extra.join(' — ') : undefined;

    const style = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
    return {
      kind: 'NodeDecl', id: idTok.value, shape, label,
      description, style, data: { typeKeyword: shapeKw },
      loc: this.locSpan(shapeKw as any, this.peek(-1)),
    } as ASTNodeDecl;
  }

  parseInlineNodeDecl(): ASTNodeDecl {
    const shapeTok = this.consume();
    const detected = detectShape(shapeTok.value);
    const id = detected.label.replace(/[^a-zA-Z0-9_-]/g, '_') || 'node';
    const style = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
    return {
      kind: 'NodeDecl', id, shape: detected.shape, label: detected.label,
      description: undefined, style, loc: this.loc(shapeTok),
    };
  }

  // ── Edge ─────────────────────────────────────────────────────────────────
  parseEdgeDecl(): ASTEdgeDecl {
    const srcTok = this.consume(); // source id
    const arrowTok = this.expect(TokenType.ARROW, 'Expected arrow (->) after source');
    let direction: 'right' | 'left' | 'both' | 'none' = 'right';
    switch (arrowTok.value) {
      case '->': case '-->': direction = 'right'; break;
      case '<--': direction = 'left'; break;
      case '<->': case '<-->': direction = 'both'; break;
      case '--': case '---': direction = 'none'; break;
      case '..>': case '==>': direction = 'right'; break;
    }
    // Optional label: |"label"|
    let label: string | undefined;
    if (this.peek().type === TokenType.PIPE) {
      this.consume(); // |
      const labelTok = this.expect(TokenType.STRING, 'Expected string in edge label');
      this.expect(TokenType.PIPE, 'Expected closing "|" after edge label');
      label = labelTok.value;
    }
    // Target can be IDENT or SHAPE (inline node like [*])
    let tgtTok: Token;
    let tgtId: string;
    if (this.peek().type === TokenType.SHAPE) {
      const shapeTok = this.consume();
      const detected = detectShape(shapeTok.value);
      tgtId = detected.label.replace(/[^a-zA-Z0-9_-]/g, '_') || 'target';
      tgtTok = shapeTok;
    } else {
      tgtTok = this.expectIdentLike('Expected target node identifier');
      tgtId = tgtTok.value;
    }

    // Optional label after target: : label (state diagram / sequence syntax)
    if (!label && this.peek().type === TokenType.COLON) {
      this.consume(); // :
      // Read the rest as label — could be: string, identifier, or mixed
      if (this.peek().type === TokenType.STRING) {
        label = this.consume().value;
      } else if (this.peek().type === TokenType.IDENT) {
        // Bounded to the label's own line — see the matching loop in
        // parseStatements(); an unterminated label otherwise consumes every
        // subsequent statement in the diagram body.
        const labelLine = this.peek().line;
        const labelToks: Token[] = [];
        while (this.peek().type !== TokenType.EOF && this.peek().type !== TokenType.RBRACE &&
               this.peek().type !== TokenType.LBRACE &&
               this.peek().type !== TokenType.KW_DIAGRAM && this.peek().type !== TokenType.KW_GROUP &&
               this.peek().line === labelLine) {
          labelToks.push(this.consume());
        }
        label = joinTokenText(labelToks);
      }
    }

    // Optional edge attribute/style block: { stroke: "...", label: "..." }
    const style = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
    if (!label && style && typeof style.label === 'string') label = style.label;

    return {
      kind: 'EdgeDecl', sourceId: srcTok.value, targetId: tgtId,
      direction, label, style, routing: 'straight', loc: this.locSpan(srcTok, tgtTok),
    };
  }

  // ── Group ────────────────────────────────────────────────────────────────
  parseGroupDecl(): ASTGroupDecl {
    const kw = this.consume(); // group
    // Accept either a bare identifier (`group cluster1 { ... }`) or a quoted
    // label used directly as the group's name (`group "Entry Points" { ... }`,
    // the idiomatic form used throughout the docs) — the id is slugified from
    // the string in the latter case.
    let id: string;
    let label: string;
    if (this.peek().type === TokenType.STRING) {
      const labelTok = this.consume();
      label = labelTok.value;
      id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'group';
    } else {
      const idTok = this.expect(TokenType.IDENT, 'Expected group identifier');
      id = idTok.value;
      label = idTok.value;
    }
    this.expect(TokenType.LBRACE, 'Expected "{" for group body');
    const body = this.parseStatements();
    this.expect(TokenType.RBRACE, 'Expected "}" after group body');
    if (this.peek().type === TokenType.STRING) {
      label = this.consume().value;
    }
    return {
      kind: 'GroupDecl', id, label, body, collapsible: false,
      loc: this.locSpan(kw, this.peek(-1)),
    };
  }

  // ── Section ──────────────────────────────────────────────────────────────
  parseSectionDecl(): ASTThemeDecl {
    const kw = this.consume(); // section
    const labelTok = this.expect(TokenType.STRING, 'Expected section label string');
    this.expect(TokenType.LBRACE, 'Expected "{" for section body');
    const body = this.parseStatements();
    this.expect(TokenType.RBRACE, 'Expected "}" after section body');
    return {
      kind: 'SectionDecl', id: labelTok.value, label: labelTok.value,
      body, loc: this.locSpan(kw, this.peek(-1)),
    } as any;
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  parseLayoutDecl(): any {
    const kw = this.consume(); // layout
    const dirMap: Record<string, string> = {
      tb: 'TB', lr: 'LR', rl: 'RL', bt: 'BT',
      'top-bottom': 'TB', 'left-right': 'LR', 'right-left': 'RL', 'bottom-top': 'BT',
    };
    let engine = 'dagre';
    const options: Record<string, any> = {};

    if (this.peek().type === TokenType.IDENT) {
      const dir = this.consume().value.toLowerCase();
      if (dirMap[dir]) {
        options.direction = dirMap[dir];
      } else {
        engine = dir; // custom engine name
      }
    } else if (this.peek().type === TokenType.STRING) {
      const val = this.consume().value.toLowerCase();
      if (dirMap[val]) {
        options.direction = dirMap[val];
      } else {
        engine = val;
      }
    }

    // spacing and rank
    while (this.peek().type === TokenType.IDENT) {
      const kwd = this.consume().value.toLowerCase();
      if ((kwd === 'spacing' || kwd === 'space') && this.peek().type === TokenType.NUMBER) {
        options.nodeSpacing = parseFloat(this.consume().value);
      } else if (kwd === 'rank' && this.peek().type === TokenType.NUMBER) {
        options.rankSpacing = parseFloat(this.consume().value);
      } else {
        break;
      }
    }

    return { kind: 'LayoutDecl', engine, options, loc: this.locSpan(kw, this.peek(-1)) };
  }

  // ── Style block ───────────────────────────────────────────────────────────
  parseStyleBlock(): any {
    const kw = this.consume(); // style
    const style = this.parseAttrBlock();
    return { kind: 'StyleDecl', target: 'all', style, loc: this.locSpan(kw, this.peek(-1)) };
  }

  // ── Inline attribute / style block: { key: value, ... } ───────────────────
  // Supports scalar values (string, number, boolean, bare identifier), nested
  // objects (e.g. `layout: { x: 300, y: 200 }`), and simple arrays. This is
  // the shared parser for node/edge style blocks and layout hints.
  parseAttrBlock(): Record<string, any> {
    this.expect(TokenType.LBRACE, 'Expected "{" to open attribute block');
    const obj: Record<string, any> = {};
    while (this.peek().type !== TokenType.RBRACE && this.peek().type !== TokenType.EOF) {
      const keyTok = this.peek();
      if (keyTok.type !== TokenType.IDENT && keyTok.type !== TokenType.STRING) {
        // Skip stray tokens (e.g. leading comma) without spinning forever.
        this.consume();
        continue;
      }
      const key = this.consume().value;
      if (this.peek().type === TokenType.COLON) {
        this.consume(); // :
        obj[key] = this.parseAttrValue();
      } else {
        obj[key] = true; // bare flag, e.g. { shadow }
      }
      if (this.peek().type === TokenType.COMMA) this.consume();
    }
    this.expect(TokenType.RBRACE, 'Expected "}" to close attribute block');
    return obj;
  }

  parseAttrValue(): any {
    const t = this.peek();
    switch (t.type) {
      case TokenType.STRING:
        this.consume();
        return t.value;
      case TokenType.NUMBER:
        this.consume();
        return parseFloat(t.value);
      case TokenType.LBRACE:
        return this.parseAttrBlock();
      case TokenType.IDENT: {
        this.consume();
        const lower = t.value.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
        return t.value;
      }
      case TokenType.SHAPE: {
        // Arrays are tokenized as a single `[a, b, c]` SHAPE token.
        this.consume();
        const raw = t.value;
        if (raw.startsWith('[') && raw.endsWith(']')) {
          const inner = raw.slice(1, -1).trim();
          if (!inner) return [];
          return inner.split(',').map((s) => {
            const v = s.trim().replace(/^"|"$/g, '');
            const n = Number(v);
            return v !== '' && !Number.isNaN(n) ? n : v;
          });
        }
        return raw;
      }
      default:
        this.consume();
        return t.value;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SyntaxCheckResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export function checkSyntax(source: string, filePath?: string): SyntaxCheckResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split('\n');

  // 1. Check for unmatched braces
  let braceDepth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    if (braceDepth < 0) {
      const lineNum = source.substring(0, i).split('\n').length;
      diagnostics.push({
        severity: DiagnosticSeverity.ERROR,
        message: 'Unmatched closing brace "}"',
        source: { file: filePath || '<unknown>', startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: 1, offset: i },
        code: 'SYNTAX_ERR',
      });
      braceDepth = 0;
    }
  }
  if (braceDepth > 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.ERROR,
      message: `Unclosed opening brace — missing ${braceDepth} closing brace(s)`,
      source: { file: filePath || '<unknown>', startLine: lines.length, startColumn: 1, endLine: lines.length, endColumn: 1, offset: source.length },
      code: 'SYNTAX_ERR',
    });
  }

  // 2. Check for unclosed string literals
  let inString = false;
  let stringStart = -1;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '"') {
      inString = !inString;
      if (inString) stringStart = i;
    }
  }
  if (inString) {
    const lineNum = source.substring(0, stringStart).split('\n').length;
    diagnostics.push({
      severity: DiagnosticSeverity.ERROR,
      message: 'Unclosed string literal',
      source: { file: filePath || '<unknown>', startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: 1, offset: stringStart },
      code: 'SYNTAX_ERR',
    });
  }

  // 3. Check for diagram type keyword
  const diagramTypes = ['fl','seq','cls','er','st','uc','act','comp','deploy',
    'bpmn','dmn','gantt','mind','net','chart','git','form','sankey','block','time',
    'c4c','c4con','c4comp','c4code','flowchart','sequence','class','state','usecase',
    'activity','component','deployment','mindmap','network','gitgraph','timeline',
    'wireframe','cloud','wire','chart-bar','chart-line','chart-pie','chart-radar','chart-scatter',
    'workitem','wi','work','trace','backlog'];
  // The tokenizer skips comments and blank lines, so this pre-check has to as
  // well — reading the raw first word made a leading `// ...` banner (which
  // every file in examples/ opens with) look like the diagram declaration and
  // rejected the file before the parser ever ran.
  let declLine = 0;
  let declText = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('//')) continue;
    declLine = i + 1;
    declText = t;
    break;
  }
  const firstWord = declText.split(/[\s"{]/)[0].toLowerCase();
  if (declText && !diagramTypes.includes(firstWord) && !/^diagram\b/i.test(declText)) {
    diagnostics.push({
      severity: DiagnosticSeverity.ERROR,
      message: 'No diagram declaration found — expected "<type> \"Title\" { ... }"',
      source: { file: filePath || '<unknown>', startLine: declLine, startColumn: 1, endLine: declLine, endColumn: 1, offset: 0 },
      code: 'SYNTAX_ERR',
    });
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

export function parseDSL(source: string, filePath?: string): Result<DiagramAST> {
  try {
    // Run syntax check first
    const syntaxResult = checkSyntax(source, filePath);
    if (!syntaxResult.valid) {
      return { ok: false, errors: syntaxResult.diagnostics };
    }

    const tokenizer = new Tokenizer(source);
    const tokens = tokenizer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parseDiagram();

    // If there are more diagrams or content, log as warning but still return the first diagram
    // (Multi-diagram files can be split by the CLI)

    return { ok: true, value: ast };
  } catch (err: any) {
    if (err instanceof ParseError) {
      return { ok: false, errors: [toDiagnostic(err, filePath)] };
    }
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.ERROR,
      message: err.message || 'Parse error',
      source: { file: filePath || '<unknown>', startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, offset: 0 },
      code: 'PARSE_ERROR',
    };
    return { ok: false, errors: [diagnostic] };
  }
}

export function parseWithGrammar(source: string, _grammar: string, filePath?: string): Result<DiagramAST> {
  // The grammar parameter is ignored — we use our built-in parser
  return parseDSL(source, filePath);
}
