// =============================================================================
// SelDiA MCP — server
// =============================================================================
// Registers the diagram-IR tools on an McpServer instance. Kept separate
// from bin.ts so tests can build a server (or call the tool functions in
// tools.ts directly) without going through stdio.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  loadDiagramTool,
  validateDiagramTool,
  queryDiagramTool,
  listNodesTool,
  listEdgesTool,
  mutateNodeTool,
  writeDiagramTool,
} from './tools.js';

const pathParam = z.string().describe('Absolute or relative path to a .sld or Mermaid (.mmd/.mermaid) diagram file');

function asToolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'seldia-mcp', version: '1.0.0' });

  server.registerTool(
    'load_diagram',
    {
      title: 'Load diagram',
      description: 'Parse/import a SelDiA (.sld) or Mermaid (.mmd/.mermaid) file into IR. Returns diagnostics and a structural summary (node/edge/group counts, node type breakdown). Does not mutate the file.',
      inputSchema: { path: pathParam },
    },
    async ({ path }) => asToolResult(loadDiagramTool(path)),
  );

  server.registerTool(
    'validate_diagram',
    {
      title: 'Validate diagram',
      description: 'Run parse/analysis diagnostics only (no transform/layout). Returns separate error and warning lists.',
      inputSchema: { path: pathParam },
    },
    async ({ path }) => asToolResult(validateDiagramTool(path)),
  );

  server.registerTool(
    'query_diagram',
    {
      title: 'Query diagram node',
      description: 'Given a node id, return its data plus what it depends on (outgoing edges / things it points at) and what depends on it (incoming edges / things pointing at it).',
      inputSchema: { path: pathParam, nodeId: z.string().describe('The IR node id to look up') },
    },
    async ({ path, nodeId }) => asToolResult(queryDiagramTool(path, nodeId)),
  );

  server.registerTool(
    'list_nodes',
    {
      title: 'List nodes',
      description: 'List every node in the diagram with id, label, shape, and plugin data.',
      inputSchema: { path: pathParam },
    },
    async ({ path }) => asToolResult(listNodesTool(path)),
  );

  server.registerTool(
    'list_edges',
    {
      title: 'List edges',
      description: 'List every edge in the diagram with id, source id, target id, and label.',
      inputSchema: { path: pathParam },
    },
    async ({ path }) => asToolResult(listEdgesTool(path)),
  );

  server.registerTool(
    'mutate_node',
    {
      title: 'Mutate node',
      description:
        'Patch a single node\'s label and/or flat style attributes (e.g. fill, stroke, textColor) and write the change back to the .sld source file. Scope: only existing, single-line flat node declarations of the form `id: (Shape) { key: value }`; nested attribute blocks and Mermaid files are rejected. The patched source is re-validated before it is written, so a bad patch never corrupts the file.',
      inputSchema: {
        path: pathParam,
        nodeId: z.string().describe('The IR node id to patch'),
        patch: z.object({
          label: z.string().optional().describe('New label text'),
          style: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Flat style/data attributes to set, e.g. { fill: "#eee", strokeWidth: 2 }'),
        }),
      },
    },
    async ({ path, nodeId, patch }) => asToolResult(mutateNodeTool({ path, nodeId, patch })),
  );

  server.registerTool(
    'write_diagram',
    {
      title: 'Write full diagram IR',
      description:
        'Persist a full DiagramIR back to a .sld source file. NOTE: no general IR->DSL serializer exists in this codebase yet, so this currently always returns ok:false with an explanation; use mutate_node for supported per-node edits. Kept as a tool so the interface is stable once a serializer lands.',
      inputSchema: {
        path: pathParam,
        ir: z.any().describe('A DiagramIR value (see @seldia/core ir/types.ts)'),
      },
    },
    async ({ path, ir }) => asToolResult(writeDiagramTool({ path, ir })),
  );

  return server;
}
