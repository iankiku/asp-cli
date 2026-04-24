/**
 * ASP -- Agent Search Protocol
 * The canonical types that define the protocol contract.
 */

// ── Search ──────────────────────────────────────

export type ResourceType = 'webpage' | 'markdown' | 'pdf' | 'plaintext' | 'api' | 'database'

export interface ResultMetadata {
  source_type?: ResourceType
  retrieval_method?: 'semantic' | 'keyword' | 'hybrid'
  freshness?: string
  content_length?: number
  section?: string
  [key: string]: unknown
}

export interface SourceInfo {
  url?: string
  registry_verified?: boolean
  [key: string]: unknown
}

export interface SearchResult {
  title: string
  snippet: string
  url: string
  score: number
  resource_type?: ResourceType
  metadata?: ResultMetadata
}

export interface SearchResponse {
  results: SearchResult[]
  query: string
  result_count: number
  source?: SourceInfo
  protocol_version?: string
}

export type ProtocolMode = 'indexed' | 'live'

export interface SearchBackend {
  name: string

  /** Index a directory of markdown files. Replaces any existing index. */
  index(dir: string, opts?: {
    onProgress?: (info: { current: number; total: number }) => void
  }): Promise<void>

  /** Search the index. Returns results sorted by relevance. */
  search(query: string, opts: { limit: number }): Promise<SearchResult[]>

  /** Whether the backend has a valid, queryable index. */
  isReady(): Promise<boolean>

  /** Release all resources (DB connections, LLM models). */
  close(): Promise<void>
}

// ── Ingest ──────────────────────────────────────

export interface IngestResult {
  url: string
  title: string
  markdown: string
}

/** @deprecated Use IngestResult instead */
export type CrawlResult = IngestResult

export interface IngestBackend {
  name: string

  /** Ingest a resource and return content as markdown. */
  ingest(url: string, opts: {
    maxPages: number
    depth: number
    onPage?: (pageUrl: string) => void
  }): Promise<IngestResult[]>
}

/** @deprecated Use IngestBackend instead */
export type CrawlBackend = IngestBackend

// ── Define helpers ──────────────────────────────

/**
 * Define a custom ingest backend. Returns a typed IngestBackend.
 *
 * @example
 * ```typescript
 * import { defineIngestBackend } from 'asp'
 *
 * export default defineIngestBackend({
 *   name: 'jina',
 *   async ingest(url, { maxPages, depth, onPage }) {
 *     const res = await fetch(`https://r.jina.ai/${url}`)
 *     const markdown = await res.text()
 *     return [{ url, title: 'Page', markdown }]
 *   }
 * })
 * ```
 */
export function defineIngestBackend(def: IngestBackend): IngestBackend {
  if (!def.name) throw new Error('defineIngestBackend: name is required')
  if (!def.ingest) throw new Error('defineIngestBackend: ingest() is required')
  return { name: def.name, ingest: def.ingest }
}

/** @deprecated Use defineIngestBackend instead */
export function defineCrawler(def: CrawlBackend): CrawlBackend {
  if (!def.name) throw new Error('defineCrawler: name is required')
  if (!(def as any).crawl && !(def as any).ingest) throw new Error('defineCrawler: ingest() is required')
  return def
}

/**
 * Define a custom search backend. Returns a typed SearchBackend.
 *
 * @example
 * ```typescript
 * import { defineSearchBackend } from 'asp'
 *
 * export default defineSearchBackend({
 *   name: 'elasticsearch',
 *   async index(dir) { ... },
 *   async search(query, { limit }) { ... },
 *   async isReady() { ... },
 *   async close() { ... },
 * })
 * ```
 */
export function defineSearchBackend(def: SearchBackend): SearchBackend {
  if (!def.name) throw new Error('defineSearchBackend: name is required')
  if (!def.index) throw new Error('defineSearchBackend: index() is required')
  if (!def.search) throw new Error('defineSearchBackend: search() is required')
  if (!def.isReady) throw new Error('defineSearchBackend: isReady() is required')
  if (!def.close) throw new Error('defineSearchBackend: close() is required')
  return {
    name: def.name,
    index: def.index,
    search: def.search,
    isReady: def.isReady,
    close: def.close,
  }
}

