# @seldia/mcp

**SelDiA MCP server** — query, validate, and mutate diagram IR over the [Model Context Protocol](https://modelcontextprotocol.io), so an agent can maintain a `.sld` (or Mermaid) diagram as a structured artifact instead of editing text blind.

This is the "AI maintains it" surface: it runs SelDiA's real parse → analyze → transform pipeline (the same one the CLI and VS Code extension use) and exposes the resulting IR — nodes, edges, dependencies — as MCP tools, plus a scoped mutation path that writes changes back to the source file.

## Installation

```bash
npm install -g @seldia/mcp
```

Or run directly with npx:

```bash
npx @seldia/mcp
```

## Configuring a client

Add it as a local stdio MCP server, e.g. in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "seldia": {
      "command": "npx",
      "args": ["-y", "@seldia/mcp"]
    }
  }
}
```

Every tool takes a `path` to a diagram file on disk (`.sld`, or `.mmd`/`.mermaid` for Mermaid import) — the server itself is stateless and re-reads the file on every call, so it plays well with a human editing the same file concurrently.

## Tools

### `load_diagram`

Parse/import a file into IR. Returns diagnostics and a structural summary (node/edge/group counts, node-type breakdown). Read-only.

```json
{ "path": "diagram.sld" }
```

### `validate_diagram`

Diagnostics only, split into `errors` and `warnings`. Cheaper than `load_diagram` when you just need a health check.

### `query_diagram`

Given a node id, returns:

- the node's own label/shape/style/data
- `dependsOn` — nodes this one has an outgoing edge to (what it needs)
- `dependedOnBy` — nodes with an outgoing edge to this one (what needs it)

```json
{ "path": "architecture.sld", "nodeId": "auth-service" }
```

This is the "what depends on auth-service?" query: call it with `nodeId: "auth-service"` and read `dependedOnBy`.

### `list_nodes` / `list_edges`

Full structural listing — every node (id, label, shape, data) or every edge (id, sourceId, targetId, label).

### `mutate_node`

Patch a single node's label and/or flat style attributes, and write the change back to the `.sld` source file:

```json
{
  "path": "architecture.sld",
  "nodeId": "auth-service",
  "patch": { "label": "Auth Service v2", "style": { "fill": "#eee" } }
}
```

**Scope**: this only supports flat, single-line node declarations of the form `id (Shape) "Label"? { key: value }` — the same syntax SelDiA's parser already round-trips. It does **not** attempt nested attribute blocks (e.g. `{ layout: { x: 1, y: 2 } }`) — the DSL's attribute-block tokenizer has a known bug with nested objects, and this tool deliberately doesn't paper over it. Mermaid files are rejected (Mermaid is a read-only import source in this engine, not a write target). The patched source is re-validated with the real parser before anything is written to disk, so a bad patch fails closed instead of corrupting the file.

### `write_diagram`

Intended as the general "persist a full IR" entry point. **Currently returns `ok: false`**: there is no general IR→DSL serializer in the codebase yet (only the flat per-node patching `mutate_node` uses). The tool is kept in the interface so it has a stable shape once a real serializer lands — use `mutate_node` for the label/style edits that are supported today.

## Design notes

- No parsing logic lives in this package — every tool goes through `@seldia/core`'s `createEngine()` (`parse` → `analyze` → `transform`) for `.sld`, or `importMermaid()` for Mermaid files.
- The server is stateless across calls by design: it always re-reads from disk, so it can't drift from what's actually on disk if something else (an editor, git) changes the file between tool calls.

## License

MIT
