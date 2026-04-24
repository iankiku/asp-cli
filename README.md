# @asp-protocol/asp

Reference CLI for the [Agent Search Protocol](../../spec/rfc.md). Index any website or local directory into a queryable knowledge base, serve the ASP HTTP endpoint, and expose search as an MCP tool.

## Install

```sh
npm install -g @asp-protocol/asp
# or
npx @asp-protocol/asp
```

Requires Node.js 18+ or Bun 1.0+.

## Commands

### `asp index <resource>`

Crawl and index a website or local markdown directory.

```sh
asp index https://docs.example.com
asp index ./docs
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--max-pages=N` | `50` | Crawler page limit |
| `--depth=N` | `3` | Link traversal depth (0 = root only) |
| `--js` | `false` | Use Playwright for JS-rendered sites |
| `--crawler=NAME` | `crawlee` | Crawler backend: `crawlee` or `firecrawl` |

---

### `asp serve`

Start the HTTP server exposing `POST /.well-known/agent-search`.

```sh
asp serve
asp serve --port=8080
```

```sh
curl -X POST http://localhost:3000/.well-known/agent-search \
  -H "Content-Type: application/json" \
  -d '{"query": "getting started", "limit": 5}'
```

---

### `asp search "<query>"`

Search the index and write JSON to stdout. Styled output goes to stderr (TTY only).

```sh
asp search "how do I configure auth?"
asp search "return policy" --limit=10
```

Output is always clean JSON — safe to pipe:

```sh
asp search "deployment guide" | jq '.results[0].url'
```

---

### `asp query "<query>"`

Semantic search with query expansion and reranking (requires embeddings). Higher quality than `search`, slower.

```sh
asp query "what authentication methods are supported?"
asp query "error handling" --limit=3
```

---

### `asp vsearch "<query>"`

Pure vector similarity search. No reranking. Best for finding conceptually similar documents.

```sh
asp vsearch "database migrations"
```

---

### `asp mcp`

Start an MCP server exposing `asp_search` and all ASP primitives as tools.

```sh
asp mcp          # stdio transport (Claude Desktop, Cursor)
asp mcp --http   # HTTP transport (multi-client)
asp mcp --http --port=9000
```

**Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "asp": {
      "command": "asp",
      "args": ["mcp"]
    }
  }
}
```

---

### `asp collection <subcommand>`

Manage named collections of indexed resources.

```sh
asp collection add https://docs.example.com --name docs
asp collection add ./internal-wiki --name wiki --mask "**/*.md"
asp collection list
asp collection remove docs
asp collection rename docs documentation
```

---

### `asp context <subcommand>`

Add semantic hints to paths to improve search quality.

```sh
asp context add /api/auth "Authentication, tokens, OAuth flows, API keys"
asp context add "General product overview and getting started guide"
asp context list
asp context check        # identify paths that would benefit from hints
asp context rm /api/auth
```

---

### `asp get <ref>`

Retrieve a single document by path or document ID.

```sh
asp get /api/auth
asp get "doc_abc123"
```

---

### `asp multi-get <pattern>`

Retrieve multiple documents by glob pattern or comma-separated refs.

```sh
asp multi-get "/api/*"
asp multi-get "/api/auth,/api/tokens"
```

---

### `asp update`

Re-index all collections with fresh content.

```sh
asp update
asp update --pull    # git pull before re-indexing git-backed resources
```

---

### `asp embed`

Generate vector embeddings for all indexed documents (required for `query` and `vsearch`).

```sh
asp embed
```

---

### `asp ls [path]`

List collections or files within a collection.

```sh
asp ls
asp ls docs
asp ls docs /api
```

---

### `asp status`

Show current index and server state.

```sh
asp status
```

---

## Configuration

All configuration via environment variables — no interactive prompts.

| Variable | Default | Description |
|----------|---------|-------------|
| `ASP_PORT` | `3000` | HTTP server port |
| `ASP_MCP_PORT` | `8182` | MCP HTTP server port |
| `ASP_INDEX_PATH` | `.asp/index.sqlite` | SQLite index location |
| `ASP_KNOWLEDGE_DIR` | `./knowledge` | Crawled markdown storage |
| `ASP_MAX_PAGES` | `50` | Crawler page limit per run |
| `ASP_CRAWL_DEPTH` | `3` | Link traversal depth |
| `ASP_USE_JS_CRAWLER` | `false` | Use Playwright for JS-heavy sites |
| `ASP_SEARCH_BACKEND` | `qmd` | Search backend name |
| `ASP_CRAWLER` | `crawlee` | Crawler backend: `crawlee` or `firecrawl` |
| `FIRECRAWL_API_KEY` | — | API key for Firecrawl crawler |
| `FIRECRAWL_URL` | — | Self-hosted Firecrawl base URL |

---

## Pluggable Architecture

### Custom Ingest Backends

```typescript
import { defineIngestBackend } from '@asp-protocol/asp'

export default defineIngestBackend({
  name: 'jina',
  async ingest(url, { maxPages, depth, onPage }) {
    const res = await fetch(`https://r.jina.ai/${url}`)
    const markdown = await res.text()
    onPage?.(url)
    return [{ url, title: 'Page', markdown }]
  }
})
```

```sh
ASP_CRAWLER=jina asp index https://docs.example.com
```

### Custom Adapters (ASPAdapter)

Adapters are the primary extension point. Implement `ASPAdapter` to connect any search backend — Pinecone, Elasticsearch, a local SQLite DB, or anything else.

```typescript
import { ASPAdapter, defineAdapter } from '@asp-protocol/asp'
import type { SearchMode, SearchOpts, SearchResponse, Document, IndexStatus, LsResult } from '@asp-protocol/asp'

class ElasticsearchAdapter extends ASPAdapter {
  name = 'elasticsearch'

  async search(query: string, mode: SearchMode, opts?: SearchOpts): Promise<SearchResponse> {
    // map mode → ES query type: 'hybrid' → multi_match+knn, 'keyword' → BM25, 'vector' → knn
    const results = await this.esClient.search({ query, mode, limit: opts?.limit ?? 5 })
    return { results, query, total: results.length, mode }
  }

  async get(ref: string): Promise<Document> {
    const doc = await this.esClient.get(ref)
    return { ref, title: doc.title, content: doc.body }
  }

  async status(): Promise<IndexStatus> {
    const stats = await this.esClient.indices.stats()
    return { status: 'ready', collections: [], total_documents: stats.total.docs.count }
  }

  async isReady(): Promise<boolean> {
    return this.esClient.ping()
  }

  async close(): Promise<void> {
    await this.esClient.close()
  }
}

export default defineAdapter(new ElasticsearchAdapter())
```

```sh
ASP_SEARCH_BACKEND=elasticsearch asp serve
```

All 16 operations are available to override. Methods you don't implement throw `"not supported"` by default — only `search`, `get`, `status`, `isReady`, and `close` are required.

#### Deprecated: defineSearchBackend

`defineSearchBackend` is still supported for backward compatibility but wraps the old `SearchBackend` interface (which only has `search(query, {limit})`). New adapters should use `ASPAdapter` directly.

---

## Protocol

The HTTP endpoint this CLI serves is defined in [`spec/rfc.md`](../../spec/rfc.md).

```
POST /.well-known/agent-search
Content-Type: application/json

{ "query": "string", "limit": 5 }
```

See the [full protocol specification](../../spec/rfc.md) for request/response schema, error codes, and conformance requirements.

---

## License

MIT — [Ian Kiku (@iankiku)](https://github.com/iankiku)
