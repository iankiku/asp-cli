import { defineIngestBackend } from '../protocol'
import { htmlToMarkdown } from '../crawl'
import type { IngestResult } from '../protocol'

export function createCrawleeBackend(opts?: { useJs?: boolean }) {
  return defineIngestBackend({
    name: 'crawlee',

    async ingest(url, { maxPages, depth, onPage }) {
      const results: IngestResult[] = []
      const startHostname = new URL(url).hostname

      const failedRequestHandler = async ({ request }: { request: any }) => {
        console.warn(`Failed to crawl ${request.url}: ${request.errorMessages.join(', ')}`)
      }

      if (opts?.useJs) {
        const { PlaywrightCrawler } = await import('crawlee')

        const crawler = new PlaywrightCrawler({
          maxCrawlDepth: depth,
          maxRequestsPerCrawl: maxPages,

          async requestHandler({ request, page, enqueueLinks }) {
            onPage?.(request.url)
            const html = await page.content()
            const result = await htmlToMarkdown(html, request.url)
            if (result) results.push(result)
            await enqueueLinks({ strategy: 'same-hostname' })
          },

          failedRequestHandler,
        })

        await crawler.run([url])
      } else {
        const { CheerioCrawler } = await import('crawlee')

        const crawler = new CheerioCrawler({
          maxCrawlDepth: depth,
          maxRequestsPerCrawl: maxPages,

          async requestHandler({ request, $, enqueueLinks }) {
            onPage?.(request.url)
            const html = $.html()
            const result = await htmlToMarkdown(html, request.url)
            if (result) results.push(result)
            await enqueueLinks({
              strategy: 'same-hostname',
              transformRequestFunction(req) {
                try {
                  if (new URL(req.url).hostname !== startHostname) return false
                } catch { return false }
                return req
              },
            })
          },

          failedRequestHandler,
        })

        await crawler.run([url])
      }

      return results
    },
  })
}
