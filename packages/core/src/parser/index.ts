// =============================================================================
// SelDiA — DSL Parser
// =============================================================================
// Re-exports from the hand-written recursive-descent parser.
// The custom parser (parser.ts) replaces the previous Peggy-based approach,
// giving us full control over syntax and better error messages.

export { parseDSL, parseWithGrammar, checkSyntax } from './parser.js';
export type { SyntaxCheckResult } from './parser.js';

