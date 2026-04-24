import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { createHash } from 'crypto'
import type { IngestResult } from './protocol'

// Minimum content length required to save a page (avoids saving near-empty pages)
const MIN_CONTENT_LENGTH = 100

// Lazy singleton for TurndownService — avoids re-allocating on every call
let _turndown: InstanceType<typeof import('turndown')> | null = null
async function getTurndown() {
  if (!_turndown) {
    const TurndownService = (await import('turndown')).default
    _turndown = new TurndownService()
  }
  return _turndown
}

/**
 * Save ingest results as markdown files with frontmatter.
 * Shared utility -- any IngestBackend's output can be saved with this.
 *
 * Security: filenames are sanitized with an explicit allowlist and prefixed
 * with the hostname to prevent cross-domain collisions. The resolved output
 * path is validated to stay within knowledgeDir (path traversal protection).
 */
export function savePages(results: IngestResult[], knowledgeDir: string, logger?: (msg: string) => void): number {
  const log = logger ?? (() => {})
  const resolvedDir = resolve(knowledgeDir)
  mkdirSync(resolvedDir, { recursive: true })
  let saved = 0

  for (const { url, title, markdown } of results) {
    if (markdown.length < MIN_CONTENT_LENGTH) {
      log(`Skipped ${url} — no extractable content`)
      continue
    }

    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_')

    // Sanitize pathname: allow only alphanumerics, hyphens, underscores, dots
    let slug = parsed.pathname.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '')
    if (!slug) slug = 'index'

    // Hash the original URL to guarantee uniqueness even after sanitization
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 8)
    const filename = `${hostname}__${slug}__${hash}.md`

    const filePath = resolve(resolvedDir, filename)
    if (!filePath.startsWith(resolvedDir + '/') && filePath !== resolvedDir) {
      log(`Blocked path traversal attempt for ${url}`)
      continue
    }

    const safeTitle = title.replace(/"/g, '\\"').replace(/\n/g, ' ')
    const content = `---\ntitle: "${safeTitle}"\nurl: ${url}\n---\n\n${markdown}`
    writeFileSync(filePath, content)
    saved++
  }

  return saved
}

/**
 * Convert raw HTML to clean markdown.
 * Used by ingest backends that return HTML (crawlee).
 * Backends that return markdown directly (firecrawl) skip this.
 */
export async function htmlToMarkdown(html: string, pageUrl: string): Promise<IngestResult | null> {
  const { load } = await import('cheerio')

  const $ = load(html)
  const title = $('title').text() || $('h1').first().text() || 'Untitled'

  $('nav, header, footer, script, style, aside, .cookie-banner, .nav, .menu, .sidebar').remove()

  const contentHtml = $('main, article, .content').html() || $('body').html() || ''
  const turndown = await getTurndown()
  const markdown = turndown.turndown(contentHtml)

  return { url: pageUrl, title, markdown }
}
