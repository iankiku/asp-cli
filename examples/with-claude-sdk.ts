/**
 * ASP + Claude SDK — CLI-first agent example
 *
 * Demonstrates an AI agent that:
 * 1. Receives a user question
 * 2. Runs `asp search "<query>"` as a subprocess (no server needed)
 * 3. Parses the JSON stdout and feeds results to Claude as a tool result
 * 4. Synthesizes the results into a final answer
 *
 * Prerequisites:
 *   1. Index a site: asp index https://docs.example.com
 *   2. Set ANTHROPIC_API_KEY
 *   3. Run: bun examples/with-claude-sdk.ts "How does authentication work?"
 *
 * No HTTP server required — this is the zero-setup path.
 */

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-20250514'

// ── Resolve asp binary ─────────────────────────────────

const ASP_BIN = process.env.ASP_BIN ?? 'asp'

// ── Tool definition ────────────────────────────────────

const aspSearchTool: Anthropic.Messages.Tool = {
  name: 'asp_search',
  description:
    'Search the indexed knowledge base. Returns relevant document snippets with titles, URLs, and relevance scores.',
  input_schema: {
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
}

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
  console.error('Usage: bun examples/with-claude-sdk.ts "your question here"')
  process.exit(1)
}

console.log(`\nQuestion: ${userQuestion}\n`)

const anthropic = new Anthropic()

const messages: Anthropic.Messages.MessageParam[] = [
  { role: 'user', content: userQuestion },
]

let response = await anthropic.messages.create({
  model: MODEL,
  max_tokens: 1024,
  system:
    'You are a helpful assistant with access to a knowledge base via the asp_search tool. ' +
    'When the user asks a question, search the knowledge base for relevant information, ' +
    'then provide a clear, grounded answer citing the sources.',
  tools: [aspSearchTool],
  messages,
})

// Agent loop — let Claude decide when to search
while (response.stop_reason === 'tool_use') {
  const assistantMessage = response.content
  messages.push({ role: 'assistant', content: assistantMessage })

  const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []

  for (const block of assistantMessage) {
    if (block.type !== 'tool_use') continue

    console.log(`[Tool Call] ${block.name}(${JSON.stringify(block.input)})`)

    if (block.name === 'asp_search') {
      const input = block.input as { query: string; limit?: number }
      try {
        const raw = await runAspSearch(input.query, input.limit)
        const parsed = JSON.parse(raw)
        console.log(`[Results] ${parsed.total} results found\n`)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: raw,
        })
      } catch (err: unknown) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Search error: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        })
      }
    }
  }

  messages.push({ role: 'user', content: toolResults })

  response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      'You are a helpful assistant with access to a knowledge base via the asp_search tool. ' +
      'When the user asks a question, search the knowledge base for relevant information, ' +
      'then provide a clear, grounded answer citing the sources.',
    tools: [aspSearchTool],
    messages,
  })
}

// Print final answer
for (const block of response.content) {
  if (block.type === 'text') {
    console.log(`Answer:\n${block.text}`)
  }
}
