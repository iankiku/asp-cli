/**
 * ASP + Pi (custom agent framework) — CLI-first agent example
 *
 * Demonstrates how to wire `asp search` into a Pi-style agent tool definition.
 * Pi agents are defined with `pi.defineAgent({ tools: [...] })` — this example
 * shows the tool pattern so it's ready to drop in.
 *
 * Demonstrates:
 * 1. Defining a typed ASP search tool compatible with Pi's tool spec
 * 2. Running `asp search "<query>"` as a subprocess (no server needed)
 * 3. Parsing JSON stdout and returning results to the agent framework
 *
 * Prerequisites:
 *   1. Index a site: asp index https://docs.example.com
 *   2. Run: bun examples/with-pi-mono.ts "How does authentication work?"
 *
 * No HTTP server required — this is the zero-setup path.
 *
 * To integrate with Pi:
 *   const agent = pi.defineAgent({ tools: [aspSearchTool], ... })
 */

// ── Resolve asp binary ─────────────────────────────────

const ASP_BIN = process.env.ASP_BIN ?? 'asp'

// ── asp search subprocess ──────────────────────────────

async function runAspSearch(query: string, limit?: number): Promise<string> {
  const limitArgs = limit ? ['--limit', String(limit)] : []
  const proc = Bun.spawn([ASP_BIN, 'search', query, ...limitArgs], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `asp search exited with code ${exitCode}`)
  }

  return stdout
}

// ── Pi-compatible tool definition ──────────────────────
//
// Pi tools are objects with: name, description, parameters, execute().
// Drop `aspSearchTool` into your pi.defineAgent({ tools: [...] }) call.

export const aspSearchTool = {
  name: 'asp_search',
  description:
    'Search the indexed knowledge base. Returns relevant document snippets with titles, URLs, and relevance scores.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5)',
      },
    },
    required: ['query'],
  },

  async execute(input: { query: string; limit?: number }): Promise<string> {
    return runAspSearch(input.query, input.limit)
  },
}

// ── Standalone demo (no Pi runtime needed) ─────────────
//
// Shows the tool executing directly — paste this pattern into your Pi agent.

const userQuestion = process.argv[2]
if (!userQuestion) {
  console.error('Usage: bun examples/with-pi-mono.ts "your question here"')
  process.exit(1)
}

console.log(`\nQuestion: ${userQuestion}`)
console.log(`\n[Tool Call] asp_search(${JSON.stringify({ query: userQuestion })})`)

const raw = await aspSearchTool.execute({ query: userQuestion })
const parsed = JSON.parse(raw)

console.log(`[Results] ${parsed.total} results found\n`)

for (const r of parsed.results) {
  console.log(`  [${r.score.toFixed(2)}] ${r.title}`)
  console.log(`         ${r.url}`)
  console.log(`         ${r.snippet.replace(/\n/g, ' ').slice(0, 120)}`)
  console.log()
}

// To wire into Pi, replace the above with:
//   const agent = pi.defineAgent({
//     tools: [aspSearchTool],
//     system: 'You are a helpful assistant with access to a knowledge base.',
//   })
//   const answer = await agent.run(userQuestion)
//   console.log(answer)
