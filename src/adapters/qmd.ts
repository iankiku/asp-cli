import { statSync } from 'fs'
import {
  ASPAdapter,
  type ASPManifest,
  type SearchMode,
  type SearchOpts,
  type SearchResponse,
  type SearchResult,
  type Document,
  type MultiGetResponse,
  type IndexStatus,
  type LsResult,
  type CollectionAddResult,
  type CollectionListResult,
  type CollectionRemoveResult,
  type CollectionRenameResult,
  type ContextAddResult,
  type ContextListResult,
  type ContextCheckResult,
  type ContextRemoveResult,
  type UpdateOpts,
  type UpdateResult,
  type EmbedOpts,
  type EmbedResult,
} from '../adapter'
import { run, qmdAvailable, ensureQmd, getIndexInfo } from './qmd-process'
import { config } from '../config'
export { run, qmdAvailable, ensureQmd, getIndexInfo }

// Module-level cache: embeddings presence doesn't change during a process lifetime
let _embeddingsCache: boolean | null = null

async function hasEmbeddings(): Promise<boolean> {
  if (_embeddingsCache !== null) return _embeddingsCache
  // Fast path: index file >2MB means embeddings are present
  // (bare FTS5 index ≈ <1MB; vector embeddings add 5-8MB for typical corpora)
  try {
    const stats = statSync(config.indexPath)
    if (stats.size > 2_000_000) {
      _embeddingsCache = true
      return true
    }
  } catch {}
  // Slow path: ask qmd directly
  try {
    const { stdout } = await run(['status'])
    const match = stdout.match(/Vectors:\s+(\d+)\s+embedded/)
    _embeddingsCache = match ? parseInt(match[1]) > 0 : false
  } catch {
    _embeddingsCache = false
  }
  return _embeddingsCache!
}

function parseSearchResults(stdout: string): SearchResult[] {
  let raw: any[]
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error('Could not parse search results from qmd')
  }
  return raw.map((r: any): SearchResult => ({
    title: r.title ?? '',
    snippet: (r.snippet || r.content?.slice(0, 200) || r.bestChunk?.slice(0, 200) || '').slice(0, 200),
    url: r.metadata?.url || (r.displayPath ? `file://${r.displayPath}` : r.file || ''),
    score: Math.max(0, Math.min(1, r.score ?? 0)),
  }))
}

// ---------------------------------------------------------------------------
// QMDAdapter
// ---------------------------------------------------------------------------

export class QMDAdapter extends ASPAdapter {
  name = 'qmd'

  // ── Manifest ──────────────────────────────────────────────────────────────

  async manifest(): Promise<ASPManifest> {
    // Detect whether embeddings are present to accurately report supported modes
    const embeddingsAvailable = await hasEmbeddings()
    const modes: SearchMode[] = embeddingsAvailable
      ? ['keyword', 'hybrid', 'vector']
      : ['keyword']

    return {
      protocol: 'asp',
      version: '0.0.1',
      name: 'QMD Knowledge Base',
      modes,
      operations: {
        required: ['manifest', 'search', 'get', 'status'],
        optional: ['multiGet', 'collection.add', 'collection.list', 'collection.remove', 'collection.rename'],
      },
      resource_types: ['markdown', 'plaintext', 'webpage'],
      limits: {
        max_results: 20,
        max_query_length: 500,
        pagination: false,
      },
      auth: {
        required: false,
      },
      mcp: {
        available: true,
        transport: 'stdio',
      },
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search(query: string, mode: SearchMode, opts?: SearchOpts): Promise<SearchResponse> {
    await ensureQmd()

    const limit = Math.min(opts?.limit ?? 5, 20)
    const qmdArgs: string[] = []

    let actualMode = mode
    if (mode === 'hybrid') {
      const embeddings = await hasEmbeddings()
      if (!embeddings) {
        // Graceful degradation: hybrid → keyword when no embeddings available
        actualMode = 'keyword'
      }
    }

    if (actualMode === 'hybrid') {
      qmdArgs.push('query', query)
    } else if (actualMode === 'vector') {
      qmdArgs.push('vsearch', query)
    } else {
      qmdArgs.push('search', query)
    }

    // For hybrid, request 3× candidates so the reranker scores a larger pool.
    // We slice back to `limit` after parsing — tokens to the caller stay constant.
    const fetchLimit = actualMode === 'hybrid' ? Math.min(limit * 3, 20) : limit
    qmdArgs.push('-n', String(fetchLimit), '--json')
    if (opts?.collection) qmdArgs.push('--collection', opts.collection)

    const { stdout, stderr, exitCode } = await run(qmdArgs)

    if (exitCode !== 0) {
      // Fallback: hybrid/vector → keyword
      if (actualMode !== 'keyword') {
        const fallbackArgs = ['search', query, '-n', String(limit), '--json']
        if (opts?.collection) fallbackArgs.push('--collection', opts.collection)
        const fallback = await run(fallbackArgs)
        if (fallback.exitCode === 0) {
          let results = parseSearchResults(fallback.stdout)
          if (opts?.minScore) results = results.filter(r => r.score >= opts.minScore!)
          return { results, query, result_count: results.length, mode: 'keyword' }
        }
      }
      throw new Error(stderr.trim() || 'Search failed')
    }

    let results = parseSearchResults(stdout)

    // URL-keyword overlap boost: when query words (≥6 chars) appear in a result's URL,
    // the reranker likely scored a broader doc over a more specific one with shared vocab.
    // A small per-match boost (0.08) corrects these cases without affecting well-ranked results.
    if (actualMode === 'hybrid') {
      const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 6)
      if (queryWords.length > 0) {
        results = results.map(r => {
          const urlLower = r.url.toLowerCase()
          const matchCount = queryWords.filter(w => urlLower.includes(w)).length
          return matchCount > 0 ? { ...r, score: Math.min(1, r.score + matchCount * 0.08) } : r
        })
        results.sort((a, b) => b.score - a.score)
      }
    }

    if (results.length > limit) results = results.slice(0, limit)

    // FTS5 uses AND logic — long queries often return nothing when any term is
    // missing from a chunk. Retry with a shorter, normalised query before giving up.
    // Normalise: strip hyphens (FTS5 tokenises "well-known" as one token, not two)
    // then take first 4 words.
    if (results.length === 0 && actualMode === 'keyword') {
      const words = query.trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean)
      if (words.length > 4) {
        const shortQuery = words.slice(0, 4).join(' ')
        const retryArgs = ['search', shortQuery, '-n', String(limit), '--json']
        if (opts?.collection) retryArgs.push('--collection', opts.collection)
        const retry = await run(retryArgs)
        if (retry.exitCode === 0) {
          const retryResults = parseSearchResults(retry.stdout)
          if (retryResults.length > 0) results = retryResults
        }
      }
    }

    if (opts?.minScore) results = results.filter(r => r.score >= opts.minScore!)
    return { results, query, result_count: results.length, mode: actualMode }
  }

  // ── Document Retrieval ────────────────────────────────────────────────────

  async get(ref: string): Promise<Document> {
    await ensureQmd()
    const { stdout, stderr, exitCode } = await run(['get', ref])
    if (exitCode !== 0) throw new Error(stderr.trim() || `get failed for ref: ${ref}`)
    try {
      const parsed = JSON.parse(stdout)
      return {
        ref: parsed.ref ?? parsed.path ?? ref,
        title: parsed.title ?? '',
        content: parsed.content ?? parsed.markdown ?? stdout,
        collection: parsed.collection,
        indexed_at: parsed.indexed_at ?? parsed.indexedAt,
      }
    } catch {
      // qmd get may return raw markdown; wrap it
      return { ref, title: ref, content: stdout }
    }
  }

  async multiGet(pattern: string, opts?: { limit?: number; maxBytes?: number }): Promise<MultiGetResponse> {
    await ensureQmd()
    const qmdArgs = ['multi-get', pattern]
    if (opts?.limit) qmdArgs.push('-n', String(opts.limit))
    if (opts?.maxBytes) qmdArgs.push('--max-bytes', String(opts.maxBytes))
    const { stdout, stderr, exitCode } = await run(qmdArgs)
    if (exitCode !== 0) throw new Error(stderr.trim() || 'multi-get failed')
    try {
      const parsed = JSON.parse(stdout)
      return {
        documents: parsed.documents ?? parsed,
        total: parsed.total ?? (parsed.documents ?? parsed).length,
      }
    } catch {
      throw new Error('Could not parse multi-get response')
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Strip qmd-specific language from error messages, replace with ASP-native wording */
  private cleanError(stderr: string, fallback: string): string {
    const msg = stderr.trim()
    if (!msg) return fallback
    // Replace qmd references with asp equivalents
    return msg
      .replace(/Run 'qmd /g, "Run 'asp ")
      .replace(/qmd collection/g, 'asp collection')
      .replace(/qmd context/g, 'asp context')
      .replace(/qmd /g, 'asp ')
  }

  // ── Collection Management ─────────────────────────────────────────────────

  async collectionAdd(resource: string, name: string, mask?: string): Promise<CollectionAddResult> {
    await ensureQmd()
    const qmdArgs = ['collection', 'add', resource, '--name', name]
    if (mask) qmdArgs.push('--mask', mask)
    const { stdout, stderr, exitCode } = await run(qmdArgs)
    if (exitCode !== 0 && !stderr.includes('already exists')) {
      throw new Error(this.cleanError(stderr, 'Failed to add collection'))
    }
    return { collection: name, resource, status: 'added', document_count: 0 }
  }

  async collectionList(): Promise<CollectionListResult> {
    await ensureQmd()
    const { stdout, stderr, exitCode } = await run(['collection', 'list', '--json'])
    if (exitCode !== 0) throw new Error(this.cleanError(stderr, 'Failed to list collections'))
    try {
      const parsed = JSON.parse(stdout)
      const items = parsed.collections ?? parsed
      return {
        collections: (Array.isArray(items) ? items : []).map((c: any) => ({
          name: c.name ?? '',
          resource: c.resource ?? '',
          document_count: c.document_count ?? c.documentCount ?? 0,
          last_indexed: c.last_indexed ?? c.lastIndexed,
          status: c.status ?? 'ready',
        })),
      }
    } catch {
      // qmd may not support --json for list; parse text output
      const lines = stdout.split('\n').filter(Boolean)
      return {
        collections: lines.map(l => ({
          name: l.trim(),
          resource: '',
          document_count: 0,
          status: 'ready' as const,
        })),
      }
    }
  }

  async collectionRemove(name: string): Promise<CollectionRemoveResult> {
    await ensureQmd()
    const { stderr, exitCode } = await run(['collection', 'remove', name])
    if (exitCode !== 0) throw new Error(this.cleanError(stderr, `Collection "${name}" not found. Run 'asp collection list' to see available collections.`))
    return { collection: name, status: 'removed' }
  }

  async collectionRename(oldName: string, newName: string): Promise<CollectionRenameResult> {
    await ensureQmd()
    const { stderr, exitCode } = await run(['collection', 'rename', oldName, newName])
    if (exitCode !== 0) throw new Error(this.cleanError(stderr, `Collection "${oldName}" not found. Run 'asp collection list' to see available collections.`))
    return { old: oldName, new: newName, status: 'renamed' }
  }

  // ── Context Management ────────────────────────────────────────────────────

  async contextAdd(path: string, text: string): Promise<ContextAddResult> {
    await ensureQmd()
    const { stderr, exitCode } = await run(['context', 'add', path, text])
    if (exitCode !== 0) throw new Error(this.cleanError(stderr, 'Failed to add context'))
    return { path, status: 'added' }
  }

  async contextList(): Promise<ContextListResult> {
    await ensureQmd()
    const { stdout, stderr, exitCode } = await run(['context', 'list'])
    if (exitCode !== 0) throw new Error(this.cleanError(stderr, 'Failed to list contexts'))
    try {
      const parsed = JSON.parse(stdout)
      return { contexts: parsed.contexts ?? parsed }
    } catch {
      // parse text output
      const lines = stdout.split('\n').filter(Boolean)
      return {
        contexts: lines.map(l => {
          const [path, ...rest] = l.split(/\s+/)
          return { path: path ?? l, text: rest.join(' ') }
        }),
      }
    }
  }

  async contextCheck(): Promise<ContextCheckResult> {
    await ensureQmd()
    const { stdout, stderr, exitCode } = await run(['context', 'check'])
    if (exitCode !== 0) throw new Error(stderr.trim() || 'context check failed')
    try {
      const parsed = JSON.parse(stdout)
      return { missing_context: parsed.missing_context ?? parsed }
    } catch {
      return { missing_context: [] }
    }
  }

  async contextRemove(path: string): Promise<ContextRemoveResult> {
    await ensureQmd()
    const { stderr, exitCode } = await run(['context', 'rm', path])
    if (exitCode !== 0) throw new Error(stderr.trim() || 'context remove failed')
    return { path, status: 'removed' }
  }

  // ── Indexing ──────────────────────────────────────────────────────────────

  async update(opts?: UpdateOpts): Promise<UpdateResult> {
    await ensureQmd()
    const start = Date.now()
    const qmdArgs = ['update']
    if (opts?.pull) qmdArgs.push('--pull')
    if (opts?.collection) qmdArgs.push('--collection', opts.collection)
    const { stderr, exitCode } = await run(qmdArgs)
    if (exitCode !== 0) throw new Error(stderr.trim() || 'update failed')
    return {
      collections_updated: opts?.collection ? [opts.collection] : [],
      documents_indexed: 0,
      duration_ms: Date.now() - start,
      status: 'complete',
    }
  }

  async embed(opts?: EmbedOpts): Promise<EmbedResult> {
    await ensureQmd()
    const start = Date.now()
    const qmdArgs = ['embed']
    if (opts?.force) qmdArgs.push('--force')
    if (opts?.collection) qmdArgs.push('--collection', opts.collection)
    const { stderr, exitCode } = await run(qmdArgs)
    if (exitCode !== 0) throw new Error(stderr.trim() || 'embed failed')
    return {
      documents_embedded: 0,
      skipped: 0,
      duration_ms: Date.now() - start,
      status: 'complete',
    }
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  async ls(collection?: string, path?: string): Promise<LsResult> {
    await ensureQmd()
    const qmdArgs = ['ls']
    if (collection) qmdArgs.push(collection)
    if (path) qmdArgs.push(path)
    const { stdout, stderr, exitCode } = await run(qmdArgs)
    if (exitCode !== 0) throw new Error(stderr.trim() || 'ls failed')
    try {
      return JSON.parse(stdout)
    } catch {
      // text output: each line is a collection or file
      const lines = stdout.split('\n').filter(Boolean)
      if (collection) {
        return {
          collection,
          path,
          files: lines.map(l => ({ ref: l.trim(), title: l.trim() })),
          total: lines.length,
        }
      }
      return { collections: lines.map(l => l.trim()) }
    }
  }

  async status(): Promise<IndexStatus> {
    await ensureQmd()
    try {
      const { stdout, exitCode } = await run(['status', '--json'])
      if (exitCode === 0) {
        const parsed = JSON.parse(stdout)
        return {
          status: parsed.status ?? 'ready',
          collections: (parsed.collections ?? []).map((c: any) => ({
            name: c.name,
            document_count: c.document_count ?? c.documentCount ?? 0,
            embedded: c.embedded ?? false,
            last_indexed: c.last_indexed ?? c.lastIndexed,
          })),
          total_documents: parsed.total_documents ?? parsed.totalDocuments ?? 0,
          index_size_bytes: parsed.index_size_bytes ?? parsed.indexSizeBytes,
        }
      }
    } catch {}

    // Fallback: parse text status output
    try {
      const { stdout } = await run(['status'])
      const docMatch = stdout.match(/Documents?:\s+(\d+)/)
      const vectorMatch = stdout.match(/Vectors:\s+(\d+)\s+embedded/)
      const total = docMatch ? parseInt(docMatch[1]) : 0
      const embedded = vectorMatch ? parseInt(vectorMatch[1]) > 0 : false

      const colResult = await run(['collection', 'list'])
      const colLines = colResult.exitCode === 0
        ? colResult.stdout.split('\n').filter(Boolean)
        : []

      return {
        status: total > 0 ? 'ready' : 'empty',
        collections: colLines.map(l => ({
          name: l.trim(),
          document_count: 0,
          embedded,
        })),
        total_documents: total,
      }
    } catch {
      return { status: 'empty', collections: [], total_documents: 0 }
    }
  }

  async isReady(): Promise<boolean> {
    if (!(await qmdAvailable())) return false
    try {
      const { stdout, exitCode } = await run(['collection', 'list'])
      return exitCode === 0 && stdout.trim().length > 0 && !stdout.includes('No collections found')
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    // qmd is a subprocess — nothing to clean up
  }

}

export function createQMDAdapter(): QMDAdapter {
  return new QMDAdapter()
}
