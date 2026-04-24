#!/usr/bin/env bun

import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs'
import { config } from './config'
import { createQMDAdapter, getIndexInfo, ensureQmd } from './adapters/qmd'
import type { ASPAdapter, IngestBackend } from './adapter'
import * as ui from './ui'

const ADAPTER_FACTORIES: Record<string, () => ASPAdapter> = {
  qmd: createQMDAdapter,
}

function resolveBackend(name?: string): ASPAdapter {
  const backendName = name ?? process.env.ASP_SEARCH_BACKEND ?? 'qmd'
  const factory = ADAPTER_FACTORIES[backendName]
  if (!factory) {
    const supported = Object.keys(ADAPTER_FACTORIES).join(', ')
    ui.error(`Unknown backend: "${backendName}"`, `Supported: ${supported}`)
    process.exit(1)
  }
  return factory()
}

const cmd = process.argv[2]
const rawArgs = process.argv.slice(3)

function parseArgs(args: string[]): { _: string[]; [key: string]: any } {
  const result: { _: string[]; [key: string]: any } = { _: [] }
  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (key.includes('=')) {
        const [k, v] = key.split('=', 2)
        result[k] = isNaN(Number(v)) ? v : Number(v)
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        const v = args[++i]
        result[key] = isNaN(Number(v)) ? v : Number(v)
      } else {
        result[key] = true
      }
    } else {
      result._.push(arg)
    }
    i++
  }
  return result
}

const args = parseArgs(rawArgs)

if (!cmd || cmd === '--help' || cmd === '-h') {
  ui.help()
  process.exit(cmd ? 0 : 1)

} else if (cmd === 'index') {
  const input = args._[0]
  if (!input) {
    ui.error('Missing argument', 'Usage: asp index <resource>')
    process.exit(1)
  }

  ui.banner()

  const isUrl = input.startsWith('http://') || input.startsWith('https://')
  let indexDir: string

  if (isUrl) {
    mkdirSync(config.knowledgeDir, { recursive: true })
    mkdirSync('./.asp', { recursive: true })

    const crawlerName = args.crawler ?? (process.env.ASP_CRAWLER || 'crawlee')
    let crawler: IngestBackend

    if (crawlerName === 'firecrawl') {
      const { createFirecrawlBackend } = await import('./crawlers/firecrawl')
      crawler = createFirecrawlBackend({
        baseUrl: process.env.FIRECRAWL_URL,
        apiKey: process.env.FIRECRAWL_API_KEY,
      })
    } else {
      const gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : ''
      if (!gi.includes('storage/')) {
        appendFileSync('.gitignore', gi.endsWith('\n') || !gi ? 'storage/\n' : '\nstorage/\n')
      }
      if (!gi.includes('.asp/')) {
        appendFileSync('.gitignore', '.asp/\n')
      }
      const useJs = args.js === true || config.useJs
      const { createCrawleeBackend } = await import('./crawlers/crawlee')
      crawler = createCrawleeBackend({ useJs })
    }

    const crawlSpinner = ui.spinner(`Crawling ${input}`)
    const results = await crawler.ingest(input, {
      maxPages: args['max-pages'] ?? config.maxPages,
      depth: args.depth ?? config.depth,
      onPage: (url) => {
        if (ui.isTTY()) (crawlSpinner as any).text = `  ${url}`
      },
    })
    crawlSpinner.succeed(`Crawled ${results.length} pages`)

    const { savePages } = await import('./crawl')
    const count = savePages(results, config.knowledgeDir)
    ui.stepSuccess(`Saved ${count} documents`, config.knowledgeDir)
    indexDir = config.knowledgeDir
  } else {
    if (!existsSync(input)) {
      ui.error(`Directory not found: ${input}`)
      process.exit(1)
    }
    mkdirSync('./.asp', { recursive: true })
    indexDir = input
  }

  if (existsSync('.env')) {
    const gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : ''
    if (!gi.includes('.env')) {
      ui.stepWarning('.env not in .gitignore', 'Add it to protect your API keys')
    }
  }

  const checkSpinner = ui.spinner('Checking search engine')
  try {
    await ensureQmd()
    checkSpinner.succeed('Search engine ready (qmd)')
  } catch (err: any) {
    checkSpinner.fail('Search engine not available')
    ui.error(err.message)
    process.exit(1)
  }

  const adapter = resolveBackend(args.backend)
  try {
    const addSpinner = ui.spinner('Adding collection')
    const addResult = await adapter.collectionAdd(indexDir, 'site')
    addSpinner.succeed('Collection added')

    const indexSpinner = ui.spinner('Building search index')
    await adapter.update()
    indexSpinner.succeed('Index complete')

    const embedSpinner = ui.spinner('Generating embeddings')
    try {
      await adapter.embed()
      embedSpinner.succeed('Embeddings ready (hybrid search available)')
    } catch {
      embedSpinner.warn('Using keyword search (BM25) — embeddings unavailable')
    }
  } catch (err: any) {
    ui.error(err.message)
    await adapter.close()
    process.exit(1)
  }
  await adapter.close()
  ui.success('Index ready', 'Next: asp search "your query"')

} else if (cmd === 'collection') {
  const sub = args._[0]
  if (!sub || !['add', 'list', 'remove', 'rename'].includes(sub)) {
    ui.error('Missing subcommand', 'Usage: asp collection <add|list|remove|rename>')
    process.exit(1)
  }
  const adapter = resolveBackend(args.backend)
  try {
    if (sub === 'add') {
      const resource = args._[1]
      if (!resource) {
        ui.error('Missing resource', 'Usage: asp collection add <resource> [--name <n>] [--mask <glob>]')
        process.exit(1)
      }
      // Validate local paths — must be a directory, not a file
      const isUrl = resource.startsWith('http://') || resource.startsWith('https://') || resource.startsWith('s3://') || resource.startsWith('git://')
      if (!isUrl) {
        const { statSync } = await import('fs')
        try {
          const stat = statSync(resource)
          if (!stat.isDirectory()) {
            ui.error('Not a directory', `"${resource}" is a file. asp collection add expects a directory path, URL, or other resource.\n  Example: asp collection add . --name my-docs`)
            process.exit(1)
          }
        } catch (e: any) {
          if (e.code === 'ENOENT') {
            ui.error('Path not found', `"${resource}" does not exist`)
            process.exit(1)
          }
        }
      }
      await adapter.collectionAdd(resource, args.name ? String(args.name) : resource, args.mask ? String(args.mask) : undefined)
      ui.stepSuccess('Collection added', resource)
    } else if (sub === 'list') {
      const result = await adapter.collectionList()
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else if (sub === 'remove') {
      const name = args._[1]
      if (!name) {
        ui.error('Missing name', 'Usage: asp collection remove <name>')
        process.exit(1)
      }
      await adapter.collectionRemove(name)
      ui.stepSuccess('Collection removed', name)
    } else if (sub === 'rename') {
      const oldName = args._[1]
      const newName = args._[2]
      if (!oldName || !newName) {
        ui.error('Missing arguments', 'Usage: asp collection rename <old> <new>')
        process.exit(1)
      }
      await adapter.collectionRename(oldName, newName)
      ui.stepSuccess('Collection renamed', `${oldName} → ${newName}`)
    }
  } catch (err: any) {
    ui.error(err.message)
    process.exit(1)
  } finally {
    await adapter.close()
  }

} else if (cmd === 'search') {
  const query = args._[0]
  if (!query) {
    ui.error('Missing argument', 'Usage: asp search <query> [--limit=5] [--mode=keyword|vector|hybrid]')
    process.exit(1)
  }
  const adapter = resolveBackend(args.backend)
  try {
    if (!(await adapter.isReady())) {
      ui.error('No index found', 'Run: asp index <resource>')
      await adapter.close()
      process.exit(1)
    }
    const start = Date.now()
    const validModes = ['keyword', 'vector', 'hybrid'] as const
    type SearchMode = typeof validModes[number]
    const mode: SearchMode = (validModes.includes(args.mode as SearchMode)) ? args.mode as SearchMode : 'hybrid'
    const result = await adapter.search(query, mode, { limit: args.limit ?? 5 })
    const elapsed = Date.now() - start

    process.stdout.write(JSON.stringify({ results: result.results, query, result_count: result.result_count }, null, 2) + '\n')

    ui.searchHeader(query)
    for (const r of result.results) ui.searchResult(r)
    ui.searchFooter(result.result_count, elapsed)
  } catch (err: any) {
    ui.error(err.message)
    process.exit(1)
  } finally {
    await adapter.close()
  }

} else if (cmd === 'get') {
  const fileOrDocId = args._[0]
  if (!fileOrDocId) {
    ui.error('Missing argument', 'Usage: asp get <file-or-docid>')
    process.exit(1)
  }
  const adapter = resolveBackend(args.backend)
  try {
    const doc = await adapter.get(fileOrDocId)
    process.stdout.write(JSON.stringify(doc, null, 2) + '\n')
  } catch (err: any) {
    ui.error(err.message)
    process.exit(1)
  } finally {
    await adapter.close()
  }

} else if (cmd === 'update') {
  const adapter = resolveBackend(args.backend)
  try {
    const result = await adapter.update({ pull: args.pull === true, collection: args.collection })
    ui.stepSuccess('Index updated')
  } catch (err: any) {
    ui.error(err.message)
    process.exit(1)
  } finally {
    await adapter.close()
  }

} else if (cmd === 'status') {
  if (ui.isTTY()) {
    process.stderr.write('\n')
    ui.step('ASP Status')
    process.stderr.write('\n')
  }
  ui.info('Index', getIndexInfo(config.indexPath))
  ui.info('Backend', args.backend ?? process.env.ASP_SEARCH_BACKEND ?? 'qmd')
  ui.info('Port', String(config.port))

  // Check server BEFORE creating adapter (adapter spawns qmd which can lock SQLite)
  let serverRunning = false
  try {
    const res = await fetch(`http://localhost:${config.port}/health`, { signal: AbortSignal.timeout(3000) })
    const data = (await res.json()) as any
    ui.info('Server', `Running (indexed: ${data.indexed})`)
    serverRunning = true
  } catch {
    ui.info('Server', 'Not running')
  }

  // Show index status via adapter
  try {
    const adapter = resolveBackend(args.backend)
    const indexStatus = await adapter.status()
    ui.info('Collections', String(indexStatus.collections.length) + ' found')
    ui.info('Documents', String(indexStatus.total_documents))
    if (indexStatus.collections.length > 0) {
      const embedded = indexStatus.collections.some(c => c.embedded)
      ui.info('Embeddings', embedded ? 'Yes (hybrid search available)' : 'No (BM25 keyword only)')
    }
    await adapter.close()
  } catch {
    process.stderr.write('Could not read index status\n')
  }

  if (ui.isTTY()) process.stderr.write('\n')

} else if (cmd === 'manifest') {
  const adapter = resolveBackend(args.backend)
  try {
    const m = await adapter.manifest()
    process.stdout.write(JSON.stringify(m, null, 2) + '\n')
  } catch (err: any) {
    ui.error(err.message)
    process.exit(1)
  } finally {
    await adapter.close()
  }

} else if (cmd === 'serve') {
  ui.banner()
  const port = args.port !== undefined ? Number(args.port) : config.port
  const adapter = resolveBackend(args.backend)
  const shutdown = async () => { await adapter.close(); process.exit(0) }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  const { startServer } = await import('./server')
  await startServer(adapter, { port })

} else if (cmd === 'mcp') {
  if (ui.isTTY()) {
    ui.banner()
    ui.stepSuccess('Mode', args.http ? 'HTTP' : 'stdio')
    ui.stepSuccess('Tool', 'asp_search')
    process.stderr.write('\n')
  }
  const port = args.port !== undefined ? Number(args.port) : config.mcpPort
  const adapter = resolveBackend(args.backend)
  const shutdown = async () => { await adapter.close(); process.exit(0) }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  const { startMCP } = await import('./mcp')
  await startMCP(adapter, { http: args.http === true, port })

} else {
  ui.help()
  process.exit(1)
}
