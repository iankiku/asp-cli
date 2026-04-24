/**
 * ASP + Vercel AI SDK — CLI-first agent example
 *
 * Demonstrates an AI agent that:
 * 1. Receives a user question
 * 2. Runs `asp search "<query>"` as a subprocess (no server needed)
 * 3. Parses the JSON stdout and feeds results to the model via a tool
 * 4. Synthesizes the results into a final answer
 *
 * Prerequisites:
 *   1. Index a site: asp index https://docs.example.com
 *   2. Set ANTHROPIC_API_KEY
 *   3. Run: bun examples/with-vercel-aisdk.ts "How does authentication work?"
 *
 * No HTTP server required — this is the zero-setup path.
 */

import { generateText, tool } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const MODEL = 'claude-sonnet-4-20250514'

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

// ── Main ───────────────────────────────────────────────

const userQuestion = process.argv[2]
if (!userQuestion) {
  console.error('Usage: bun examples/with-vercel-aisdk.ts "your question here"')
  process.exit(1)
}

console.log(`\nQuestion: ${userQuestion}\n`)

const { text } = await generateText({
  model: anthropic(MODEL),
  system:
    'You are a helpful assistant with access to a knowledge base via the asp_search tool. ' +
    'When the user asks a question, search the knowledge base for relevant information, ' +
    'then provide a clear, grounded answer citing the sources.',
  prompt: userQuestion,
  tools: {
    asp_search: tool({
      description:
        'Search the indexed knowledge base. Returns relevant document snippets with titles, URLs, and relevance scores.',
      parameters: z.object({
        query: z.string().describe('The search query'),
        limit: z.number().optional().describe('Maximum number of results to return (default: 5)'),
      }),
      execute: async ({ query, limit }) => {
        console.log(`[Tool Call] asp_search(${JSON.stringify({ query, limit })})`)
        const raw = await runAspSearch(query, limit)
        const parsed = JSON.parse(raw)
        console.log(`[Results] ${parsed.total} results found\n`)
        return raw
      },
    }),
  },
  maxSteps: 5,
})

console.log(`Answer:\n${text}`)
