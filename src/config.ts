import { resolve } from 'path'

export const config = {
  port:         Number(process.env.ASP_PORT         ?? 3000),
  // Per-project index directory — qmd cache is redirected here via XDG_CACHE_HOME
  indexDir:     resolve(process.env.ASP_INDEX_DIR   ?? '.asp'),
  get indexPath() { return resolve(this.indexDir, 'qmd', 'index.sqlite') },
  knowledgeDir: process.env.ASP_KNOWLEDGE_DIR        ?? './knowledge',
  maxPages:     Number(process.env.ASP_MAX_PAGES     ?? 50),
  depth:        Number(process.env.ASP_CRAWL_DEPTH   ?? 3),
  useJs:        process.env.ASP_USE_JS_CRAWLER === 'true',
  mcpPort:      Number(process.env.ASP_MCP_PORT      ?? 8182),
}
