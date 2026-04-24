// ASP -- Agent Search Protocol
// Re-exports for programmatic use

// New adapter API
export { ASPAdapter, defineAdapter } from './adapter'
export type {
  SearchMode,
  SearchOpts,
  SearchResult,
  SearchResponse,
  Document,
  MultiGetResponse,
  IndexStatus,
  LsResult,
  Collection,
  CollectionAddResult,
  CollectionListResult,
  CollectionRemoveResult,
  CollectionRenameResult,
  ContextHint,
  ContextAddResult,
  ContextListResult,
  ContextCheckResult,
  ContextRemoveResult,
  UpdateOpts,
  UpdateResult,
  EmbedOpts,
  EmbedResult,
  ResourceType,
} from './adapter'

// Deprecated aliases (kept for backward compatibility)
export type { SearchBackend, IngestBackend } from './adapter'
export { defineSearchBackend } from './adapter'

// Deprecated protocol.ts types
export type { IngestResult } from './protocol'
export type { CrawlResult, CrawlBackend } from './protocol'
export { defineIngestBackend, defineCrawler } from './protocol'

// QMD adapter (reference implementation)
export { createQMDAdapter, QMDAdapter } from './adapters/qmd'

// Legacy factory kept for backward compat (returns a QMDAdapter which satisfies old SearchBackend interface)
export { createQMDBackend } from './backends/qmd'

// Crawlers
export { createCrawleeBackend } from './crawlers/crawlee'
export { createFirecrawlBackend } from './crawlers/firecrawl'

// Utilities
export { savePages, htmlToMarkdown } from './crawl'
