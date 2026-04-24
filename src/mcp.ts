/**
 * ASP MCP — starts an MCP server with asp_* tools backed by the ASPAdapter.
 */

import type { ASPAdapter } from './adapter'

export async function startMCP(
  adapter: ASPAdapter,
  opts: { http?: boolean; port?: number },
): Promise<void> {
  if (opts.http) {
    process.stderr.write('asp mcp: HTTP transport is not yet supported. Use stdio mode.\n')
    process.exit(1)
  }

  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { z } = await import('zod')

  const server = new McpServer({
    name: 'asp-mcp-server',
    version: '0.0.1',
  })

  server.tool(
    'asp_manifest',
    'Return the ASP manifest for this knowledge source',
    {},
    async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await adapter.manifest(), null, 2) }],
    }),
  )

  server.tool(
    'asp_search',
    'Search the knowledge base using the Agent Search Protocol',
    {
      query: z.string().describe('Search query (max 500 chars)'),
      mode: z.enum(['keyword', 'hybrid', 'vector']).default('hybrid').describe('Search mode'),
      limit: z.number().min(1).max(20).default(5).describe('Max results (1–20, default 5)'),
    },
    async ({ query, mode, limit }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await adapter.search(query, mode, { limit }), null, 2) }],
    }),
  )

  server.tool(
    'asp_get',
    'Retrieve a document by reference (path or document ID)',
    {
      ref: z.string().describe('Document path or opaque ID'),
    },
    async ({ ref }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await adapter.get(ref), null, 2) }],
    }),
  )

  server.tool(
    'asp_status',
    'Return the current index status',
    {},
    async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await adapter.status(), null, 2) }],
    }),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)

  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve()
  })
}
