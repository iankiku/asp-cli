import { run, ensureQmd, qmdAvailable, getIndexInfo } from '../adapters/qmd-process'
import { defineSearchBackend } from '../protocol'
import type { SearchResult } from '../protocol'

export { getIndexInfo }

function parseResults(stdout: string): SearchResult[] {
  let raw: any[]
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error('Could not parse search results')
  }
  return raw.map((r: any): SearchResult => ({
    title: r.title ?? '',
    snippet: (r.snippet || r.content?.slice(0, 200) || r.bestChunk?.slice(0, 200) || '').slice(0, 200),
    url: r.metadata?.url || (r.displayPath ? `file://${r.displayPath}` : r.file || ''),
    score: Math.max(0, Math.min(1, r.score ?? 0)),
  }))
}

async function hasEmbeddings(): Promise<boolean> {
  try {
    const { stdout } = await run(['status'])
    const match = stdout.match(/Vectors:\s+(\d+)\s+embedded/)
    return match ? parseInt(match[1]) > 0 : false
  } catch {
    return false
  }
}

export function createQMDBackend() {
  return defineSearchBackend({
    name: 'qmd',

    async index(dir) {
      await ensureQmd()

      const addResult = await run(['collection', 'add', dir, '--name', 'site'])
      if (addResult.exitCode !== 0 && !addResult.stderr.includes('already exists')) {
        throw new Error(`Failed to create collection: ${addResult.stderr.trim()}`)
      }

      await run(['context', 'add', '/', 'Knowledge base'])

      const updateResult = await run(['update'])
      if (updateResult.exitCode !== 0) {
        throw new Error('Indexing failed')
      }

      const embedResult = await run(['embed'])
      if (embedResult.exitCode !== 0) {
        throw new Error('Embedding generation failed -- keyword search (BM25) will be used')
      }
    },

    async search(query, { limit }) {
      await ensureQmd()

      const useHybrid = await hasEmbeddings()
      const cmd = useHybrid ? 'query' : 'search'

      const { stdout, stderr, exitCode } = await run([cmd, query, '-n', String(limit), '--json'])

      if (exitCode !== 0) {
        if (useHybrid) {
          const fallback = await run(['search', query, '-n', String(limit), '--json'])
          if (fallback.exitCode === 0) {
            return parseResults(fallback.stdout)
          }
        }
        throw new Error(stderr.trim() || 'Search failed')
      }

      return parseResults(stdout)
    },

    async isReady() {
      if (!(await qmdAvailable())) return false
      const { stdout, exitCode } = await run(['collection', 'list'])
      return exitCode === 0 && stdout.trim().length > 0 && !stdout.includes('No collections found')
    },

    async close() {},
  })
}
