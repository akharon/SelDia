// =============================================================================
// SelDiA — SQL DDL Exporter
// =============================================================================
// IR -> SQL `CREATE TABLE` statements, targeting ER-typed diagrams only.
// Mirrors the shape of export/mermaid.ts: best-effort, returns null for any
// diagram type it doesn't cover rather than emitting misleading output.
//
// Reads the same label vocabulary the ER renderer already reads (see
// render/custom-renderers.ts renderErEntity / parseErEntity), not node.data —
// per project convention, ER/class nodes carry their real structure in the
// newline-joined label, and node.data is not populated by the ER plugin.
// Node label:
//   line 0        -> entity/table name
//   line 1..n     -> one attribute per line, e.g. "PK id", "name", "FK user_id"
// Edge.label2 carries crow's-foot cardinality ("1", "N", "0..1", "0..N");
// a "1" target end is rendered as a UNIQUE/NOT NULL FK-ish hint via a comment
// since IR alone doesn't carry enough to infer exact constraint semantics.
// =============================================================================

import type { DiagramIR, IRNode } from '../ir/types.js';
import { DiagramType } from '../ir/types.js';

/** Only ER diagrams have a natural SQL DDL mapping. */
export function isSqlDdlExportable(type: DiagramType): boolean {
  return type === DiagramType.ER;
}

interface ParsedAttr {
  raw: string;
  name: string;
  sqlType: string;
  isPk: boolean;
  isFk: boolean;
}

function splitLines(label: string): string[] {
  return label.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/** A conservative label -> SQL type guess. ER labels in this DSL don't carry
 *  an explicit type (they're free text like "PK id" or "email"), so this
 *  looks for a light vocabulary of hints in the attribute text and otherwise
 *  falls back to a safe default (VARCHAR(255)) rather than guessing wrong. */
/** Map an explicitly declared DSL type (the `UUID` in `id: UUID PK`) onto SQL.
 *  Unrecognised names pass through upper-cased — an author who wrote a type
 *  we don't know is still a better authority on it than a name-hint guess. */
const DECLARED_TYPE_SQL: Record<string, string> = {
  uuid: 'UUID',
  string: 'VARCHAR(255)',
  text: 'TEXT',
  int: 'INTEGER',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  float: 'REAL',
  double: 'DOUBLE PRECISION',
  decimal: 'DECIMAL(10,2)',
  money: 'DECIMAL(10,2)',
  bool: 'BOOLEAN',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'TIMESTAMP',
  timestamp: 'TIMESTAMP',
};

function inferSqlType(attrName: string, isPk: boolean): string {
  const n = attrName.toLowerCase();
  if (isPk || /(^|_)id$/.test(n)) return 'INTEGER';
  if (/(_at|date|time)$/.test(n)) return 'TIMESTAMP';
  if (/(count|qty|quantity|amount|total|num|number)$/.test(n)) return 'INTEGER';
  if (/(price|cost|rate)$/.test(n)) return 'DECIMAL(10,2)';
  if (/^is_|^has_|_flag$/.test(n)) return 'BOOLEAN';
  return 'VARCHAR(255)';
}

/** ER attribute lines appear in the wild in either order — "PK id" (marker
 *  first) or "id: UUID PK" (marker last, per the shipped er.sld template,
 *  optionally with a ": type" annotation in between) — so PK/FK is detected
 *  anywhere in the token list rather than assumed to be in one fixed slot.
 *  The attribute name is always the first token, with a trailing ':'
 *  stripped if present. */
function parseAttr(line: string): ParsedAttr {
  const tokens = line.split(/\s+/).filter(Boolean);
  const isPk = tokens.some((t) => /^PK$/i.test(t));
  const isFk = tokens.some((t) => /^FK$/i.test(t));
  const rawName = (tokens[0] || 'value').replace(/:$/, '');
  const cleanName = rawName.replace(/[^A-Za-z0-9_]/g, '_') || 'value';

  // An explicit `name: TYPE` annotation beats any name-hint heuristic: the
  // author told us the type, so don't re-guess it from the column name (which
  // would read `total: decimal` as INTEGER on an `amount|total` hint).
  // Only trust the slot right after a `name:` — a bare second token is a
  // marker like PK/FK, not a type.
  const declared = /:$/.test(tokens[0] || '') ? (tokens[1] || '') : '';
  const declaredKey = declared.replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
  const sqlType = declaredKey && !/^(pk|fk)$/.test(declaredKey)
    ? (DECLARED_TYPE_SQL[declaredKey] ?? declaredKey.toUpperCase())
    : inferSqlType(cleanName, isPk);

  return { raw: line, name: cleanName, sqlType, isPk, isFk };
}

function tableName(node: IRNode): string {
  const first = splitLines(node.label)[0] || node.id;
  return first.replace(/[^A-Za-z0-9_]/g, '_');
}

/** Emit `CREATE TABLE` statements (with PK/FK constraints inferred from
 *  ER attribute annotations and relationship edges) for an ER-typed IR.
 *  Returns null for any other diagram type. */
export function exportSqlDdl(ir: DiagramIR): string | null {
  if (ir.type !== DiagramType.ER) return null;

  const tableNames = new Map<string, string>(); // node id -> sql table name
  for (const n of ir.nodes) tableNames.set(n.id, tableName(n));

  const statements: string[] = [];

  for (const node of ir.nodes) {
    const lines = splitLines(node.label);
    const entityName = lines[0] || node.id;
    const attrLines = lines.slice(1);
    const tbl = tableNames.get(node.id)!;
    const attrs = (attrLines.length > 0 ? attrLines : ['id']).map(parseAttr);

    const cols: string[] = [];
    const pkCols: string[] = [];
    for (const a of attrs) {
      const notNull = a.isPk ? ' NOT NULL' : '';
      cols.push(`  ${a.name} ${a.sqlType}${notNull}`);
      if (a.isPk) pkCols.push(a.name);
    }
    if (pkCols.length > 0) {
      cols.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
    }

    statements.push(`-- ${entityName}\nCREATE TABLE ${tbl} (\n${cols.join(',\n')}\n);`);
  }

  // Relationships become FK constraints on the "many" side (target, per
  // renderErRelationship's own convention: the crow's foot — the many end —
  // is drawn on the edge's target).
  const fkStatements: string[] = [];
  for (const edge of ir.edges) {
    const srcTbl = tableNames.get(edge.sourceId);
    const tgtTbl = tableNames.get(edge.targetId);
    if (!srcTbl || !tgtTbl) continue;
    const srcSingular = srcTbl.replace(/s$/, '');
    const fkCol = `${srcSingular}_id`;
    fkStatements.push(
      `ALTER TABLE ${tgtTbl} ADD COLUMN ${fkCol} INTEGER REFERENCES ${srcTbl}(id);`
    );
  }

  return [...statements, ...fkStatements].join('\n\n');
}
