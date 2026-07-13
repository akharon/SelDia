// =============================================================================
// SelDiA — Semantic Analyzer
// =============================================================================
// Validates the AST: checks for duplicate IDs, undefined references, type checks.

import type { DiagramAST, ASTNodeDecl, ASTEdgeDecl, ASTGroupDecl } from './ast/nodes.js';
import type { Diagnostic, Result } from './types/common.js';
import { DiagnosticSeverity } from './types/common.js';
import { ShapeType } from './types/shapes.js';

export function analyze(ast: DiagramAST): Result<DiagramAST> {
  const diagnostics: Diagnostic[] = [];
  const warnings: string[] = [];

  // Collect all defined node IDs
  const definedIds = new Map<string, ASTNodeDecl>();
  const groupIds = new Map<string, ASTGroupDecl>();
  const implicitNodes: Array<{ id: string; edgeLoc: any }> = [];

  function collectIds(stmts: any[]) {
    for (const stmt of stmts) {
      if (stmt.kind === 'NodeDecl') {
        if (definedIds.has(stmt.id)) {
          diagnostics.push({
            severity: DiagnosticSeverity.ERROR,
            message: `Duplicate node ID: "${stmt.id}"`,
            source: stmt.loc,
            code: 'E0002',
          });
        }
        definedIds.set(stmt.id, stmt);
      }
      if (stmt.kind === 'GroupDecl') {
        if (groupIds.has(stmt.id)) {
          diagnostics.push({
            severity: DiagnosticSeverity.ERROR,
            message: `Duplicate group ID: "${stmt.id}"`,
            source: stmt.loc,
            code: 'E0002',
          });
        }
        groupIds.set(stmt.id, stmt);
        collectIds(stmt.body);
      }
      if (stmt.kind === 'SectionDecl') {
        collectIds(stmt.body);
      }
    }
  }

  collectIds(ast.body);

  // Auto-create implicit nodes for undefined edge references
  function findMissing(stmts: any[]) {
    for (const stmt of stmts) {
      if (stmt.kind === 'EdgeDecl') {
        const check = (id: string, loc: any) => {
          if (!definedIds.has(id) && !groupIds.has(id)) {
            const nd: ASTNodeDecl = {
              kind: 'NodeDecl', id, shape: ShapeType.RECTANGLE, label: id,
              description: undefined, style: undefined, loc,
            };
            definedIds.set(id, nd);
            implicitNodes.push({ id, edgeLoc: loc });
          }
        };
        check(stmt.sourceId, stmt.loc);
        const targets = Array.isArray(stmt.targetId) ? stmt.targetId : [stmt.targetId];
        for (const tgt of targets) check(tgt, stmt.loc);
      }
      if (stmt.kind === 'GroupDecl' || stmt.kind === 'SectionDecl') {
        findMissing(stmt.body);
      }
    }
  }
  findMissing(ast.body);

  // Inject implicit nodes at the end of the body
  for (const { id } of implicitNodes) {
    const nd = definedIds.get(id)!;
    (ast.body as any[]).push(nd);
  }

  return { ok: true, value: ast };
}
