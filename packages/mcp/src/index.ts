// =============================================================================
// @seldia/mcp — Public API
// =============================================================================
// Exposes the server factory and the individual tool functions so they can
// be embedded in another process (tested directly, or composed into a
// different transport) without going through stdio.

export { createServer } from './server.js';
export {
  loadDiagramTool,
  validateDiagramTool,
  queryDiagramTool,
  listNodesTool,
  listEdgesTool,
  mutateNodeTool,
  writeDiagramTool,
} from './tools.js';
export { loadDiagram, validateDiagram, isMermaidFile, getEngine } from './diagram-store.js';
export { summarize, queryNode, listNodes, listEdges } from './query.js';
export { applyNodePatch, SldWriteError } from './sld-writer.js';
export type { NodePatch } from './sld-writer.js';
