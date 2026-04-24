import { defineIngestBackend } from '../protocol'
import type { IngestResult } from '../protocol'

/**
 * Firecrawl ingest adapter.
 *
 * Supports two modes:
 *   1. Self-hosted: FIRECRAWL_URL=http://localhost:3002 (Docker, zero cost)
 *   2. Cloud: FIRECRAWL_API_KEY=fc-xxx (firecrawl.dev, paid)
 *
 * Self-hosted setup:
 *   git clone https://github.com/mendableai/firecrawl.git
 *   cd firecrawl && docker compose up -d
 *   # Firecrawl runs at http://localhost:3002
 *
 * Firecrawl returns markdown directly -- no HTML-to-markdown conversion needed.
 * Handles JS-rendered pages, anti-bot, deep nesting, and link following.
 */
export function createFirecrawlBackend(opts?: { apiKey?: string; baseUrl?: string }) {
  return defineIngestBackend({
    name: 'firecrawl',

    async ingest(url, { maxPages, depth, onPage }) {
      const baseUrl = opts?.baseUrl || process.env.FIRECRAWL_URL || undefined
      const apiKey = opts?.apiKey || process.env.FIRECRAWL_API_KEY || (baseUrl ? 'fc-local' : '')

      if (!apiKey && !baseUrl) {
        throw new Error(
          'Firecrawl not configured. Either:\n' +
          '  1. Self-host: FIRECRAWL_URL=http://localhost:3002 (docker compose up)\n' +
          '  2. Cloud: FIRECRAWL_API_KEY=fc-xxx (firecrawl.dev)'
        )
      }

      let FirecrawlApp: any
      try {
        FirecrawlApp = (await import('@mendable/firecrawl-js')).default
      } catch (e: any) {
        if (e?.code === 'MODULE_NOT_FOUND' || e?.message?.includes('Cannot find module')) {
          throw new Error('Firecrawl SDK not installed. Run: bun add @mendable/firecrawl-js')
        }
        throw e
      }

      const appOpts: any = { apiKey }
      if (baseUrl) appOpts.apiUrl = baseUrl
      const app = new FirecrawlApp(appOpts)

      const response = await app.crawlUrl(url, {
        limit: maxPages,
        maxDepth: depth,
        scrapeOptions: {
          formats: ['markdown'],
        },
      })

      if (!response.success) {
        throw new Error(`Firecrawl error: ${response.error || 'unknown'}`)
      }

      const results: IngestResult[] = []

      for (const page of response.data || []) {
        const pageUrl = page.metadata?.sourceURL || page.metadata?.url || url
        onPage?.(pageUrl)

        results.push({
          url: pageUrl,
          title: page.metadata?.title || page.metadata?.ogTitle || 'Untitled',
          markdown: page.markdown || '',
        })
      }

      return results
    },
  })
}
