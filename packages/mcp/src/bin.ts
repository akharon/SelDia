#!/usr/bin/env node
// =============================================================================
// SelDiA MCP — stdio entry point
// =============================================================================
// Standard local MCP server pattern: connect an McpServer to stdio and let
// the client (Claude Desktop, an IDE integration, etc.) drive it. Run as
// `seldia-mcp` once this package is installed.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('seldia-mcp fatal error:', err);
  process.exit(1);
});
