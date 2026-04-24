import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ASPAdapter } from './adapter'
import * as ui from './ui'

// Strip Unicode control characters (categories Cc and Cf) per rfc.md §7.2
function stripControlChars(str: string): string {
  return str.replace(/[\p{Cc}\p{Cf}]/gu, '')
}

export async function startServer(backend: ASPAdapter, opts: { port: number }): Promise<void> {
  const app = new Hono()

  app.use('*', cors())

  // Discovery header on all responses
  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('X-Agent-Search', '/.well-known/agent-search')
  })

  // GET /.well-known/agent-search — manifest (agents discover capabilities here)
  const handleManifest = async (c: any) => {
    try {
      const m = await backend.manifest()
      c.header('Cache-Control', 'public, max-age=3600')
      return c.json(m)
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : String(err), code: 'manifest_unavailable' }, 503)
    }
  }

  app.get('/.well-known/agent-search', handleManifest)
  app.get('/agent-search', handleManifest)

  // POST /.well-known/agent-search — dispatches on method field
  const handlePost = async (c: any) => {
    // §7.1 Content-Type check
    const contentType = c.req.header('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Content-Type must be application/json', code: 'invalid_request' }, 400)
    }

    // §7.3 Request size check
    const contentLength = Number(c.req.header('content-length') ?? '0')
    if (contentLength > 10240) {
      return c.json({ error: 'Request body too large (max 10KB)', code: 'request_too_large' }, 413)
    }

    const rawBody = await c.req.text()
    if (rawBody.length > 10240) {
      return c.json({ error: 'Request body too large (max 10KB)', code: 'request_too_large' }, 413)
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(rawBody)
    } catch {
      return c.json({ error: 'Invalid JSON body', code: 'invalid_request' }, 400)
    }

    // Dispatch on method — default to search for backwards compatibility
    const method = typeof body.method === 'string' ? body.method : 'search'
    c.header('Cache-Control', 'no-store')

    // ── manifest ──────────────────────────────────────
    if (method === 'manifest') {
      try {
        const m = await backend.manifest()
        c.header('Cache-Control', 'public, max-age=3600')
        return c.json(m)
      } catch (err: unknown) {
        return c.json({ error: err instanceof Error ? err.message : String(err), code: 'manifest_unavailable' }, 503)
      }
    }

    // ── status ────────────────────────────────────────
    if (method === 'status') {
      try {
        const s = await backend.status()
        return c.json(s)
      } catch (err: unknown) {
        return c.json({ error: err instanceof Error ? err.message : String(err), code: 'index_unavailable' }, 503)
      }
    }

    // ── get ───────────────────────────────────────────
    if (method === 'get') {
      if (!body.ref || typeof body.ref !== 'string') {
        return c.json({ error: 'ref is required for get', code: 'invalid_request' }, 400)
      }
      if (!(await backend.isReady())) {
        return c.json({ error: 'No index found. Run asp index <url-or-path> first.', code: 'index_unavailable' }, 503)
      }
      try {
        const doc = await backend.get(body.ref as string)
        return c.json(doc)
      } catch (err: unknown) {
        return c.json({ error: err instanceof Error ? err.message : String(err), code: 'index_unavailable' }, 503)
      }
    }

    // ── search (default) ──────────────────────────────
    if (method !== 'search') {
      return c.json({ error: `Unknown method: ${method}`, code: 'invalid_request' }, 400)
    }

    // §3 Query validation
    if (!body.query || typeof body.query !== 'string' || !body.query.trim()) {
      return c.json({ error: 'Query is required', code: 'invalid_query' }, 400)
    }

    let query = stripControlChars(body.query as string)

    // §3 Query length check
    if (query.length > 500) {
      return c.json({ error: 'Query exceeds maximum length of 500 characters', code: 'invalid_query' }, 400)
    }

    // §5 Index availability
    if (!(await backend.isReady())) {
      return c.json({ error: 'No index found. Run asp index <url-or-path> first.', code: 'index_unavailable' }, 503)
    }

    try {
      // §3 Limit clamping
      const rawLimit = body.limit
      const limit = (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0)
        ? Math.min(Math.floor(rawLimit), 20)
        : 5

      // §4 Mode handling — fall back to keyword for unrecognized values
      const validModes = ['keyword', 'vector', 'hybrid'] as const
      const requestedMode = (typeof body.mode === 'string' && validModes.includes(body.mode as any))
        ? (body.mode as 'keyword' | 'vector' | 'hybrid')
        : 'keyword'

      const start = Date.now()
      const searchResponse = await backend.search(query, requestedMode, { limit })
      const latencyMs = Date.now() - start

      c.header('X-ASP-Query-Latency-Ms', String(latencyMs))
      c.header('X-ASP-Result-Count', String(searchResponse.results.length))

      return c.json({
        results: searchResponse.results,
        query,
        mode: searchResponse.mode,
        result_count: searchResponse.result_count,
        protocol_version: '0.0.1',
      })
    } catch (err: unknown) {
      return c.json({ error: err instanceof Error ? err.message : String(err), code: 'index_unavailable' }, 503)
    }
  }

  app.post('/.well-known/agent-search', handlePost)
  app.post('/agent-search', handlePost)

  // §1 Reject other methods with 405
  const methodNotAllowed = (c: any) =>
    c.json({ error: 'Method not allowed. Use GET for manifest, POST for operations.', code: 'method_not_allowed' }, 405)

  app.all('/.well-known/agent-search', methodNotAllowed)
  app.all('/agent-search', methodNotAllowed)

  app.get('/health', async (c) =>
    c.json({ status: 'ok', indexed: await backend.isReady() })
  )

  ui.serverListening(
    `http://localhost:${opts.port}`,
    `http://localhost:${opts.port}/.well-known/agent-search`
  )
  Bun.serve({ port: opts.port, fetch: app.fetch })
}
