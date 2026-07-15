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
  KW_PARTICIPANT = 'PARTICIPANT',
  // Symbols
  COLON = 'COLON',         // :
  COMMA = 'COMMA',         // ,
  LBRACE = 'LBRACE',       // {
  RBRACE = 'RBRACE',       // }
  ARROW = 'ARROW',         // -->  <--  <-->  ---  ..>  ==>
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
      case 'participant':
      case 'person':
      case 'actor':
      case 'system':
      case 'container':
      case 'database':
      case 'queue':
      case 'boundary':
      case 'control':
      case 'entity': return this.makeToken(TokenType.KW_PARTICIPANT, value, start);
      default:        return this.makeToken(TokenType.IDENT, value, start);
    }
  }

  private readArrow(start: CharPos): Token | null {
    const c1 = this.peek(), c2 = this.peek(1), c3 = this.peek(2), c4 = this.peek(3);
    const patterns: [string, string][] = [
      ['<-->', '<-->'], ['-->', '-->'], ['->', '->'], ['<--', '<--'],
      ['---', '---'], ['..>', '..>'], ['==>', '==>'],
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
      if (ch === '}') { this.advance(); tokens.push(this.makeToken(TokenType.RBRACE, '}', start)); continue; }
      if (ch === '{') {
        // Check if this is a diamond shape {text} right after :
        const prevTok = tokens.length > 0 ? tokens[tokens.length - 1] : null;
        if (prevTok && prevTok.type === TokenType.COLON) {
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
      t.type === TokenType.KW_DIAGRAM || t.type === TokenType.KW_PARTICIPANT;
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
    const kw = this.expect(TokenType.KW_DIAGRAM, 'Expected "diagram" keyword');
    const typeTok = this.expect(TokenType.IDENT, 'Expected diagram type (e.g. flowchart)');
    let type = typeTok.value.toLowerCase();
    // Handle multi-word types like "c4 context". The sub-type word may itself
    // tokenize as a keyword (e.g. "container" is KW_PARTICIPANT, reused for
    // C4 container declarations), so accept IDENT or KW_PARTICIPANT here.
    if (type === 'c4' && (this.peek().type === TokenType.IDENT || this.peek().type === TokenType.KW_PARTICIPANT)) {
      type += '-' + this.consume().value.toLowerCase();
    }
    if (type === 'chart' && this.peek().type === TokenType.IDENT) {
      type += '-' + this.consume().value.toLowerCase();
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
      loc: this.locSpan(kw, this.peek(-1)),
    };
  }

  // ── Statements ───────────────────────────────────────────────────────────
  parseStatements(): ASTStatement[] {
    const stmts: ASTStatement[] = [];
    while (this.peek().type !== TokenType.RBRACE && this.peek().type !== TokenType.EOF) {
      // Handle inline shape nodes used as edge sources: [*] --> New
      if (this.peek().type === TokenType.SHAPE && this.peek(1).type === TokenType.ARROW) {
        const srcNode = this.parseInlineNodeDecl();
        stmts.push(srcNode); // emit the node
        // Now parse the edge using the inline node as source
        const edgeTok = this.consume(); // ARROW
        let direction: 'right' | 'left' | 'both' | 'none' = 'right';
        switch (edgeTok.value) {
          case '-->': case '->': direction = 'right'; break;
          case '<--': direction = 'left'; break;
          case '<-->': direction = 'both'; break;
          case '---': direction = 'none'; break;
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
            let parts = '';
            while (this.peek().type !== TokenType.EOF && this.peek().type !== TokenType.RBRACE &&
                   this.peek().type !== TokenType.KW_DIAGRAM) {
              const t = this.consume();
              parts += t.value + ' ';
            }
            label = parts.trim();
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

  /** Parse a chained edge after another edge: `--> target [... more chains]` */
  parseChainedEdge(sourceId: string): ASTEdgeDecl {
    const arrowTok = this.expect(TokenType.ARROW, 'Expected arrow in chained edge');
    let direction: 'right' | 'left' | 'both' | 'none' = 'right';
    switch (arrowTok.value) {
      case '-->': direction = 'right'; break;
      case '->':  direction = 'right'; break;
      case '<--': direction = 'left'; break;
      case '<-->': direction = 'both'; break;
      case '---': direction = 'none'; break;
      case '..>': direction = 'right'; break;
      case '==>': direction = 'right'; break;
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

  parseStatement(): ASTStatement | null {
    // Skip comments
    if (this.peek().type === TokenType.COMMENT) {
      const tok = this.consume();
      return { kind: 'Comment', text: tok.value, loc: this.loc(tok) };
    }
    // Keywords (theme/group/section/layout/style) used as a plain node id
    // (e.g. `layout: [Layout Engine]`, `style --> other`) are re-tokenized as
    // node/edge declarations rather than the keyword's own decl grammar —
    // only treat them as keyword decls when NOT immediately followed by ":"
    // or an arrow, i.e. when they're being used in decl position.
    const isKeywordAsIdent = (): boolean => {
      const next = this.peek(1);
      return next.type === TokenType.COLON || next.type === TokenType.ARROW;
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
    // Node or Edge declaration — identifier followed by : or arrow
    // (keyword tokens used as plain identifiers fall through to here too)
    const curType = this.peek().type;
    const isKeywordToken = curType === TokenType.KW_THEME || curType === TokenType.KW_GROUP ||
      curType === TokenType.KW_SECTION || curType === TokenType.KW_LAYOUT || curType === TokenType.KW_STYLE ||
      curType === TokenType.KW_DIAGRAM || curType === TokenType.KW_PARTICIPANT;
    if (curType === TokenType.IDENT || (isKeywordToken && isKeywordAsIdent())) {
      const idTok = this.peek();
      const next = this.peek(1);
      if (next.type === TokenType.COLON) {
        return this.parseNodeDecl();
      }
      if (next.type === TokenType.ARROW) {
        return this.parseEdgeDecl();
      }
      // Check for typed node: keyword id: "label" (e.g. system_Ext mainframe: "Bank")
      // The node id token may itself be a keyword (theme/group/section/layout/style)
      // used as a plain identifier, e.g. `block theme: "Theme Manager"`.
      const nextIsIdentLike = next.type === TokenType.IDENT || next.type === TokenType.KW_THEME ||
        next.type === TokenType.KW_GROUP || next.type === TokenType.KW_SECTION ||
        next.type === TokenType.KW_LAYOUT || next.type === TokenType.KW_STYLE ||
        next.type === TokenType.KW_DIAGRAM || next.type === TokenType.KW_PARTICIPANT;
      if (nextIsIdentLike && this.peek(2).type === TokenType.COLON) {
        // Read the type keyword and skip it — use id as the node identifier
        const typeTok = this.consume(); // consume type keyword
        const idTok2 = this.consume(); // consume node id
        this.expect(TokenType.COLON, 'Expected ":" after node identifier');
        let label = idTok2.value;
        if (this.peek().type === TokenType.SHAPE) {
          const shapeTok = this.consume();
          const detected = detectShape(shapeTok.value);
          const shapeStyle = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
          return {
            kind: 'NodeDecl', id: idTok2.value, shape: detected.shape, label: detected.label,
            description: undefined, style: shapeStyle, loc: this.locSpan(typeTok, this.peek(-1)),
          };
        } else if (this.peek().type === TokenType.STRING) {
          label = this.consume().value;
        }
        // C4-style rich metadata: additional string literals after the label
        // (e.g. `system_Ext mainframe: "Mainframe Banking" "Core banking system"`,
        // or `container spa: "SPA" "React" "Client-side application"` where the
        // middle string is a technology tag). Collect any extra strings into
        // the node description, joined with " — ".
        const extra: string[] = [];
        while (this.peek().type === TokenType.STRING) {
          extra.push(this.consume().value);
        }
        const description = extra.length > 0 ? extra.join(' — ') : undefined;
        const typedStyle = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
        return {
          kind: 'NodeDecl', id: idTok2.value, shape: 'rectangle' as any, label,
          description, style: typedStyle, data: { typeKeyword: typeTok.value },
          loc: this.locSpan(typeTok, this.peek(-1)),
        };
      }
      throw new ParseError(`Expected ":" or arrow after identifier "${idTok.value}"`, idTok);
    }
    // Standalone inline shape node (no following arrow)
    if (this.peek().type === TokenType.SHAPE) {
      return this.parseInlineNodeDecl();
    }
    // Participant keyword (sequence diagrams / C4 person, system, container, etc.)
    // used as a plain node id (e.g. `database --> auth`, `system: [Cloud]`) —
    // only treat as the participant-decl keyword when followed by a name.
    if (this.peek().type === TokenType.KW_PARTICIPANT &&
        this.peek(1).type !== TokenType.COLON && this.peek(1).type !== TokenType.ARROW) {
      const kwTok = this.consume(); // participant / person / system / container / ...
      const idTok = this.expect(TokenType.IDENT, 'Expected participant identifier');
      let label = idTok.value;
      if (this.peek().type === TokenType.COLON) {
        this.consume(); // :
        label = this.expect(TokenType.STRING, 'Expected participant label string').value;
      }
      // C4-style rich metadata: additional string literals after the label
      // (e.g. `person customer: "Customer" "A bank customer"`, or
      // `container spa: "SPA" "React" "Client-side application"` where the
      // middle string is a technology tag). Collect extras into description.
      const extra: string[] = [];
      while (this.peek().type === TokenType.STRING) {
        extra.push(this.consume().value);
      }
      const description = extra.length > 0 ? extra.join(' — ') : undefined;
      const partStyle = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
      return {
        kind: 'NodeDecl', id: idTok.value, shape: 'actor' as any,
        label, description, style: partStyle, data: { typeKeyword: kwTok.value },
        loc: this.locSpan(kwTok, this.peek(-1)),
      };
    }
    throw new ParseError(`Unexpected token "${this.peek().value}"`, this.peek());
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  parseThemeDecl(): ASTThemeDecl {
    const kw = this.consume(); // theme
    const themeTok = this.peek().type === TokenType.STRING || this.peek().type === TokenType.IDENT
      ? this.consume()
      : (() => { throw new ParseError('Expected theme name (string or identifier)', this.peek()); })();
    return { kind: 'ThemeDecl', theme: themeTok.value, loc: this.locSpan(kw, themeTok) };
  }

  // ── Node ─────────────────────────────────────────────────────────────────
  parseNodeDecl(): ASTNodeDecl {
    const idTok = this.consume(); // id
    this.expect(TokenType.COLON);
    let shape: ShapeType = ShapeType.RECTANGLE;
    let label = idTok.value;

    if (this.peek().type === TokenType.SHAPE) {
      const shapeTok = this.consume();
      const detected = detectShape(shapeTok.value);
      shape = detected.shape;
      label = detected.label;
    } else if (this.peek().type === TokenType.STRING) {
      label = this.consume().value;
    } else {
      throw new ParseError('Expected shape or string literal after ":"', this.peek());
    }

    const style = this.peek().type === TokenType.LBRACE ? (this.parseAttrBlock() as any) : undefined;
    return {
      kind: 'NodeDecl', id: idTok.value, shape, label,
      description: undefined, style, loc: this.locSpan(idTok, this.peek(-1)),
    };
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
    const arrowTok = this.expect(TokenType.ARROW, 'Expected arrow (-->) after source');
    let direction: 'right' | 'left' | 'both' | 'none' = 'right';
    switch (arrowTok.value) {
      case '-->': direction = 'right'; break;
      case '->':  direction = 'right'; break;
      case '<--': direction = 'left'; break;
      case '<-->': direction = 'both'; break;
      case '---': direction = 'none'; break;
      case '..>': direction = 'right'; break;
      case '==>': direction = 'right'; break;
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
        let parts = '';
        while (this.peek().type !== TokenType.EOF && this.peek().type !== TokenType.RBRACE &&
               this.peek().type !== TokenType.LBRACE &&
               this.peek().type !== TokenType.KW_DIAGRAM && this.peek().type !== TokenType.KW_GROUP) {
          const t = this.consume();
          parts += t.value + ' ';
        }
        label = parts.trim();
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

  // ── Layout (stub) ────────────────────────────────────────────────────────
  parseLayoutDecl(): any {
    const kw = this.consume(); // layout
    const engineTok = this.peek().type === TokenType.IDENT || this.peek().type === TokenType.STRING
      ? this.consume()
      : (() => { throw new ParseError('Expected layout engine name', this.peek()); })();
    return { kind: 'LayoutDecl', engine: engineTok.value, options: {}, loc: this.locSpan(kw, this.peek(-1)) };
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

  // 3. Check for diagram keyword
  if (!/diagram\s+/i.test(source)) {
    diagnostics.push({
      severity: DiagnosticSeverity.ERROR,
      message: 'No diagram declaration found — expected "diagram <type> { ... }"',
      source: { file: filePath || '<unknown>', startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, offset: 0 },
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
