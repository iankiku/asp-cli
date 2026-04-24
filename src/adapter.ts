/**
 * ASP -- Agent Search Protocol
 * ASPAdapter: the single abstract class all adapters must implement.
 *
 * Mirrors the 6 operation groups in spec/operations.yml and spec/primitives.md.
 * Implementers map these 16 operations to their stack (qmd, Pinecone, Elasticsearch, etc.).
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type SearchMode = 'hybrid' | 'keyword' | 'vector'

export type ResourceType = 'webpage' | 'markdown' | 'pdf' | 'plaintext' | 'api' | 'database'

export interface SearchOpts {
  limit?: number
  collection?: string
  minScore?: number
}

export interface SearchResult {
  title: string
  snippet: string
  url: string
  score: number
  resource_type?: ResourceType
  metadata?: Record<string, unknown>
}

export interface SearchResponse {
  results: SearchResult[]
  query: string
  result_count: number
  mode?: string
  source?: { url?: string; registry_verified?: boolean }
  protocol_version?: string
}

export interface Document {
  ref: string
  title: string
  content: string
  collection?: string
  indexed_at?: string
}

export interface MultiGetResponse {
  documents: Array<{ ref: string; title: string; content: string }>
  result_count: number
}

export interface Collection {
  name: string
  resource: string
  document_count: number
  last_indexed?: string
  status: 'ready' | 'empty' | 'indexing' | 'error'
}

export interface CollectionAddResult {
  collection: string
  resource: string
  status: 'added'
  document_count: number
}

export interface CollectionListResult {
  collections: Collection[]
}

export interface CollectionRemoveResult {
  collection: string
  status: 'removed'
}

export interface CollectionRenameResult {
  old: string
  new: string
  status: 'renamed'
}

export interface ContextHint {
  path: string
  text: string
}

export interface ContextAddResult {
  path: string
  status: 'added'
}

export interface ContextListResult {
  contexts: ContextHint[]
}

export interface ContextCheckResult {
  missing_context: Array<{ path: string; document_count: number; reason: string }>
}

export interface ContextRemoveResult {
  path: string
  status: 'removed'
}

export interface UpdateOpts {
  collection?: string
  pull?: boolean
}

export interface UpdateResult {
  collections_updated: string[]
  documents_indexed: number
  duration_ms: number
  status: 'complete' | 'partial' | 'failed'
}

export interface EmbedOpts {
  collection?: string
  force?: boolean
}

export interface EmbedResult {
  documents_embedded: number
  skipped: number
  duration_ms: number
  status: 'complete' | 'failed'
}

export interface IndexStatus {
  status: 'ready' | 'empty' | 'indexing' | 'degraded'
  collections: Array<{
    name: string
    document_count: number
    embedded: boolean
    last_indexed?: string
  }>
  total_documents: number
  index_size_bytes?: number
}

export interface LsResult {
  collections?: string[]
  collection?: string
  path?: string
  files?: Array<{ ref: string; title: string }>
  result_count?: number
}

// ---------------------------------------------------------------------------
// ASPManifest — returned by manifest() and GET /.well-known/agent-search
// ---------------------------------------------------------------------------

/**
 * Machine-readable self-description of an ASP endpoint.
 *
 * Agents read this once to know what the source supports — which search modes,
 * which optional operations, resource types, limits, and whether MCP is
 * available. No docs, no probing.
 *
 * Analogous to package.json: a knowledge source's manifest declares its
 * identity and capabilities so agents can adapt without per-source integration.
 */
export interface ASPManifest {
  /** Always "asp" */
  protocol: 'asp'
  /** Protocol version this server conforms to */
  version: string
  /** Human-readable name for this knowledge source */
  name: string
  /** Canonical URL or local path of the content source */
  source?: string
  /** Search modes this server supports */
  modes: SearchMode[]
  operations: {
    /** The four required verbs every ASP server implements */
    required: ('manifest' | 'search' | 'get' | 'status')[]
    /** Optional verbs this server has declared support for */
    optional: string[]
  }
  /** Document/resource types available in this index */
  resource_types?: ResourceType[]
  limits: {
    max_results: number
    max_query_length: number
    pagination: boolean
  }
  auth: {
    required: boolean
  }
  mcp?: {
    available: boolean
    /** 'stdio' | 'http' */
    transport?: string
  }
}

// ---------------------------------------------------------------------------
// ASPAdapter abstract class
// ---------------------------------------------------------------------------

/**
 * Abstract base for all ASP adapters. Extend this class and implement the
 * required methods. Optional methods default to throwing "not supported".
 *
 * @example
 * ```typescript
 * import { ASPAdapter, defineAdapter } from 'asp'
 *
 * class MyAdapter extends ASPAdapter {
 *   name = 'my-backend'
 *
 *   async search(query: string, mode: SearchMode, opts?: SearchOpts): Promise<SearchResponse> { ... }
 *   async get(ref: string): Promise<Document> { ... }
 *   async status(): Promise<IndexStatus> { ... }
 *   async isReady(): Promise<boolean> { ... }
 *   async close(): Promise<void> { ... }
 * }
 *
 * export default defineAdapter(new MyAdapter())
 * ```
 */
export abstract class ASPAdapter {
  abstract name: string

  // ── Required: Manifest ───────────────────────────────────────────────────

  /**
   * Return the manifest for this knowledge source.
   *
   * Called by `GET /.well-known/agent-search` and `asp manifest`.
   * Agents read this to discover modes, operations, limits, and MCP availability
   * without probing or reading documentation.
   */
  abstract manifest(): Promise<ASPManifest>

  // ── Required: Search ────────────────────────────────────────────────────

  /**
   * Search the index. `mode` selects the retrieval strategy:
   * - `'hybrid'`  – semantic query with reranking (requires embeddings)
   * - `'keyword'` – BM25 full-text (no embeddings required)
   * - `'vector'`  – nearest-neighbor vector search (requires embeddings)
   *
   * Adapters that don't support a given mode should fall back gracefully
   * (e.g. hybrid → keyword) and set `response.mode` to the actual mode used.
   */
  abstract search(query: string, mode: SearchMode, opts?: SearchOpts): Promise<SearchResponse>

  // ── Required: Document Retrieval ─────────────────────────────────────────

  /** Retrieve a single document by path or opaque document ID. */
  abstract get(ref: string): Promise<Document>

  // ── Required: Discovery ──────────────────────────────────────────────────

  /** Report the current state of the index. */
  abstract status(): Promise<IndexStatus>

  /** Whether the adapter has a valid, queryable index. */
  abstract isReady(): Promise<boolean>

  // ── Required: Lifecycle ──────────────────────────────────────────────────

  /** Release all resources (DB connections, running processes). */
  abstract close(): Promise<void>

  // ── Optional: Document Retrieval ─────────────────────────────────────────

  /** Retrieve multiple documents by glob pattern or comma-separated refs. */
  async multiGet(pattern: string, opts?: { limit?: number; maxBytes?: number }): Promise<MultiGetResponse> {
    throw new Error(`${this.name}: multiGet() is not supported`)
  }

  // ── Optional: Collection Management ─────────────────────────────────────

  /** Register a content source as a named collection. */
  async collectionAdd(resource: string, name: string, mask?: string): Promise<CollectionAddResult> {
    throw new Error(`${this.name}: collectionAdd() is not supported`)
  }

  /** List all registered collections. */
  async collectionList(): Promise<CollectionListResult> {
    throw new Error(`${this.name}: collectionList() is not supported`)
  }

  /** Remove a collection and all its indexed documents. */
  async collectionRemove(name: string): Promise<CollectionRemoveResult> {
    throw new Error(`${this.name}: collectionRemove() is not supported`)
  }

  /** Rename a collection without re-indexing. */
  async collectionRename(oldName: string, newName: string): Promise<CollectionRenameResult> {
    throw new Error(`${this.name}: collectionRename() is not supported`)
  }

  // ── Optional: Context Management ─────────────────────────────────────────

  /** Add a semantic context hint for a path. */
  async contextAdd(path: string, text: string): Promise<ContextAddResult> {
    throw new Error(`${this.name}: contextAdd() is not supported`)
  }

  /** List all registered context hints. */
  async contextList(): Promise<ContextListResult> {
    throw new Error(`${this.name}: contextList() is not supported`)
  }

  /** Identify paths that would benefit from context hints. */
  async contextCheck(): Promise<ContextCheckResult> {
    throw new Error(`${this.name}: contextCheck() is not supported`)
  }

  /** Remove the context hint for a path. */
  async contextRemove(path: string): Promise<ContextRemoveResult> {
    throw new Error(`${this.name}: contextRemove() is not supported`)
  }

  // ── Optional: Indexing ───────────────────────────────────────────────────

  /** Re-index all collections (or a specific collection) with fresh content. */
  async update(opts?: UpdateOpts): Promise<UpdateResult> {
    throw new Error(`${this.name}: update() is not supported`)
  }

  /** Generate vector embeddings for indexed documents. */
  async embed(opts?: EmbedOpts): Promise<EmbedResult> {
    throw new Error(`${this.name}: embed() is not supported`)
  }

  // ── Optional: Discovery ──────────────────────────────────────────────────

  /** List collections, or list files within a collection. */
  async ls(collection?: string, path?: string): Promise<LsResult> {
    throw new Error(`${this.name}: ls() is not supported`)
  }
}

// ---------------------------------------------------------------------------
// defineAdapter helper
// ---------------------------------------------------------------------------

/**
 * Type-check and return an ASPAdapter. Use this to get compile-time
 * verification that your adapter satisfies the contract.
 *
 * @example
 * ```typescript
 * export default defineAdapter(new QMDAdapter())
 * ```
 */
export function defineAdapter(adapter: ASPAdapter): ASPAdapter {
  if (!adapter.name) throw new Error('defineAdapter: adapter.name is required')
  if (typeof adapter.manifest !== 'function') throw new Error('defineAdapter: manifest() is required')
  if (typeof adapter.search !== 'function') throw new Error('defineAdapter: search() is required')
  if (typeof adapter.get !== 'function') throw new Error('defineAdapter: get() is required')
  if (typeof adapter.status !== 'function') throw new Error('defineAdapter: status() is required')
  if (typeof adapter.isReady !== 'function') throw new Error('defineAdapter: isReady() is required')
  if (typeof adapter.close !== 'function') throw new Error('defineAdapter: close() is required')
  return adapter
}

// ---------------------------------------------------------------------------
// Backward-compatibility aliases
// ---------------------------------------------------------------------------
// The old SearchBackend and IngestBackend interfaces are preserved here so
// existing custom backends don't break. They map to the relevant subset of
// ASPAdapter. New code should implement ASPAdapter directly.

/** @deprecated Implement ASPAdapter instead */
export interface SearchBackend {
  name: string
  index(dir: string, opts?: { onProgress?: (info: { current: number; total: number }) => void }): Promise<void>
  search(query: string, opts: { limit: number }): Promise<SearchResult[]>
  isReady(): Promise<boolean>
  close(): Promise<void>
}

/** @deprecated Implement ASPAdapter instead */
export interface IngestBackend {
  name: string
  ingest(url: string, opts: { maxPages: number; depth: number; onPage?: (pageUrl: string) => void }): Promise<Array<{ url: string; title: string; markdown: string }>>
}

/** @deprecated Use defineAdapter instead */
export function defineSearchBackend(def: SearchBackend): SearchBackend {
  if (!def.name) throw new Error('defineSearchBackend: name is required')
  if (!def.index) throw new Error('defineSearchBackend: index() is required')
  if (!def.search) throw new Error('defineSearchBackend: search() is required')
  if (!def.isReady) throw new Error('defineSearchBackend: isReady() is required')
  if (!def.close) throw new Error('defineSearchBackend: close() is required')
  return { name: def.name, index: def.index, search: def.search, isReady: def.isReady, close: def.close }
}
