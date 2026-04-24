import { NewStyle, RoundedBorder } from '@indiekitai/lipgloss'
import ora from 'ora'
import pkg from '../package.json'

// ── TTY Detection ───────────────────────────────
// When piped (not a TTY), all output is plain text.
// When interactive (TTY), full styled output.

export function isTTY(): boolean {
  return process.stderr.isTTY === true
}

// ── Color Palette ───────────────────────────────

const colors = {
  primary:   '#8B5CF6',
  success:   '#10B981',
  warning:   '#F59E0B',
  error:     '#EF4444',
  dim:       '#6B7280',
  text:      '#E5E7EB',
  accent:    '#06B6D4',
  title:     '#C084FC',
}

// ── Base Styles ─────────────────────────────────

const titleStyle  = NewStyle().foreground(colors.title).bold(true)
const dimStyle    = NewStyle().foreground(colors.dim)
const successStyle = NewStyle().foreground(colors.success)
const warningStyle = NewStyle().foreground(colors.warning)
const errorStyle  = NewStyle().foreground(colors.error).bold(true)
const accentStyle = NewStyle().foreground(colors.accent)

// ── Banner ──────────────────────────────────────

const bannerBox = NewStyle()
  .border(RoundedBorder)
  .borderForeground(colors.primary)
  .paddingTop(1).paddingBottom(1)
  .paddingLeft(3).paddingRight(3)

export function banner(): void {
  if (!isTTY()) return
  const content = [
    titleStyle.render('◆  ASP'),
    dimStyle.render('   Agent Search Protocol'),
    dimStyle.render(`   v${pkg.version}`),
  ].join('\n')
  process.stderr.write('\n' + bannerBox.render(content) + '\n\n')
}

// ── Step Indicators ─────────────────────────────

export function step(label: string, detail?: string): void {
  if (!isTTY()) {
    process.stderr.write(detail ? `${label} ${detail}\n` : `${label}\n`)
    return
  }
  const prefix = accentStyle.render('  ◇')
  process.stderr.write(detail
    ? `${prefix} ${label} ${dimStyle.render(detail)}\n`
    : `${prefix} ${label}\n`)
}

export function stepSuccess(label: string, detail?: string): void {
  if (!isTTY()) {
    process.stderr.write(`✓ ${label}${detail ? ' ' + detail : ''}\n`)
    return
  }
  const prefix = successStyle.render('  ✓')
  process.stderr.write(detail
    ? `${prefix} ${label} ${dimStyle.render(detail)}\n`
    : `${prefix} ${label}\n`)
}

export function stepWarning(label: string, detail?: string): void {
  if (!isTTY()) {
    process.stderr.write(`⚠ ${label}${detail ? ' ' + detail : ''}\n`)
    return
  }
  const prefix = warningStyle.render('  ⚠')
  process.stderr.write(detail
    ? `${prefix} ${warningStyle.render(label)} ${dimStyle.render(detail)}\n`
    : `${prefix} ${warningStyle.render(label)}\n`)
}

export function stepError(label: string, detail?: string): void {
  if (!isTTY()) {
    process.stderr.write(`✗ ${label}${detail ? ' ' + detail : ''}\n`)
    return
  }
  const prefix = errorStyle.render('  ✗')
  process.stderr.write(detail
    ? `${prefix} ${errorStyle.render(label)} ${dimStyle.render(detail)}\n`
    : `${prefix} ${errorStyle.render(label)}\n`)
}

// ── Spinner ─────────────────────────────────────

export function spinner(text: string) {
  if (!isTTY()) {
    process.stderr.write(`  ${text}...\n`)
    return {
      succeed: (msg: string) => process.stderr.write(`  ✓ ${msg}\n`),
      fail: (msg: string) => process.stderr.write(`  ✗ ${msg}\n`),
      warn: (msg: string) => process.stderr.write(`  ⚠ ${msg}\n`),
      stop: () => {},
      set text(v: string) {},
    }
  }
  return ora({ text: `  ${text}`, color: 'magenta', stream: process.stderr }).start()
}

// ── Search Results ──────────────────────────────

function scoreColor(score: number): string {
  if (score >= 0.7) return colors.success
  if (score >= 0.4) return colors.warning
  return colors.dim
}

export function searchHeader(query: string): void {
  if (!isTTY()) return
  process.stderr.write('\n' + titleStyle.render(`  ◆ "${query}"`) + '\n\n')
}

export function searchResult(r: { title: string; snippet: string; url: string; score: number }): void {
  if (!isTTY()) return
  const badge = NewStyle().foreground(scoreColor(r.score)).bold(true).render(r.score.toFixed(2))
  const title = NewStyle().bold(true).render(r.title)
  const url = dimStyle.render(r.url)
  const snippet = NewStyle().foreground(colors.text).render(r.snippet.replace(/\n/g, ' ').slice(0, 120))
  process.stderr.write(`  ${badge}  ${title}\n        ${url}\n        ${snippet}\n\n`)
}

export function searchFooter(total: number, timeMs: number): void {
  if (!isTTY()) return
  const time = (timeMs / 1000).toFixed(1)
  process.stderr.write(dimStyle.render(`  ─ ${total} result${total !== 1 ? 's' : ''} (${time}s)`) + '\n\n')
}

// ── Success Box ─────────────────────────────────

const successBox = NewStyle()
  .border(RoundedBorder)
  .borderForeground(colors.success)
  .paddingLeft(2).paddingRight(2)

export function success(message: string, hint?: string): void {
  if (!isTTY()) {
    process.stderr.write(`${message}${hint ? '\n' + hint : ''}\n`)
    return
  }
  const content = hint
    ? `${successStyle.render('✓')} ${message}\n${dimStyle.render('  ' + hint)}`
    : `${successStyle.render('✓')} ${message}`
  process.stderr.write('\n' + successBox.render(content) + '\n\n')
}

// ── Error Box ───────────────────────────────────

const errorBox = NewStyle()
  .border(RoundedBorder)
  .borderForeground(colors.error)
  .paddingLeft(2).paddingRight(2)

export function error(message: string, hint?: string): void {
  if (!isTTY()) {
    process.stderr.write(`Error: ${message}${hint ? '\n' + hint : ''}\n`)
    return
  }
  const content = hint
    ? `${errorStyle.render('✗')} ${message}\n${dimStyle.render('  ' + hint)}`
    : `${errorStyle.render('✗')} ${message}`
  process.stderr.write('\n' + errorBox.render(content) + '\n\n')
}

// ── Info Line ───────────────────────────────────

export function info(label: string, value: string): void {
  if (!isTTY()) {
    process.stderr.write(`${label}: ${value}\n`)
    return
  }
  const styledLabel = dimStyle.render(label.padEnd(12))
  process.stderr.write(`  ${styledLabel} ${value}\n`)
}

// ── Help ────────────────────────────────────────

export function help(): void {
  banner()

  const cmdStyle = NewStyle().foreground(colors.accent).bold(true)
  const descStyle = NewStyle().foreground(colors.text)
  const optStyle = NewStyle().foreground(colors.dim)
  const groupStyle = NewStyle().foreground(colors.dim)

  const groups: Array<{ label: string; commands: [string, string][] }> = [
    {
      label: 'Collections',
      commands: [
        ['collection add <resource> [--name <n>] [--mask <glob>]', 'Add a resource to a collection'],
        ['collection list',                                         'List all collections'],
        ['collection remove <name>',                               'Remove a collection'],
        ['collection rename <old> <new>',                         'Rename a collection'],
      ],
    },
    {
      label: 'Search',
      commands: [
        ['search <query> [--mode=keyword|vector|hybrid]', 'Search the index'],
        ['get <ref>',                                     'Retrieve a document by path or ID'],
      ],
    },
    {
      label: 'Index',
      commands: [
        ['index <resource>', 'Index a website or markdown directory'],
        ['update [--pull]',  'Rebuild the search index'],
      ],
    },
    {
      label: 'Server',
      commands: [
        ['serve',   'Expose index as ASP endpoint (POST /.well-known/agent-search)'],
        ['mcp',     'Start MCP server (stdio)'],
        ['manifest','Print the ASP manifest for this index'],
      ],
    },
    {
      label: 'Info',
      commands: [
        ['status', 'Show index, collections, and server status'],
      ],
    },
  ]

  const options: [string, string][] = [
    ['--max-pages=50',              'Crawler page limit'],
    ['--depth=3',                   'Crawler depth limit'],
    ['--limit=5',                   'Search result limit'],
    ['--backend=qmd',               'Search backend'],
    ['--crawler=crawlee|firecrawl', 'Crawler backend'],
    ['--js',                        'Use Playwright for JS sites'],
    ['--port=3000',                 'Server port'],
  ]

  const example = [
    'Quick start:',
    '',
    '  asp collection add ./docs --name my-docs   # Index a local directory',
    '  asp collection add https://docs.example.com # Index a website',
    '  asp search "how does auth work?"            # Search your index',
    '  asp serve                                   # Expose as HTTP endpoint',
  ]

  if (!isTTY()) {
    process.stderr.write('ASP — Agent Search Protocol (Research Preview)\n')
    for (const line of example) process.stderr.write(`${line}\n`)
    for (const group of groups) {
      process.stderr.write(`\n${group.label}:\n`)
      for (const [cmd, desc] of group.commands) {
        process.stderr.write(`  asp ${cmd.padEnd(42)} ${desc}\n`)
      }
    }
    process.stderr.write('\nOptions:\n')
    for (const [opt, desc] of options) process.stderr.write(`  ${opt.padEnd(28)} ${desc}\n`)
    process.stderr.write('\n')
    return
  }

  const exampleStyle = NewStyle().foreground(colors.accent)
  process.stderr.write(groupStyle.render('  Quick start') + '\n\n')
  process.stderr.write(`    ${exampleStyle.render('asp collection add ./docs --name my-docs')}   ${dimStyle.render('Index a local directory')}\n`)
  process.stderr.write(`    ${exampleStyle.render('asp search "how does auth work?"')}            ${dimStyle.render('Search your index')}\n`)
  process.stderr.write(`    ${exampleStyle.render('asp serve')}                                   ${dimStyle.render('Expose as HTTP endpoint')}\n`)
  process.stderr.write('\n')

  for (const group of groups) {
    process.stderr.write(groupStyle.render(`  ${group.label}`) + '\n\n')
    for (const [cmd, desc] of group.commands) {
      process.stderr.write(`    ${cmdStyle.render(('asp ' + cmd).padEnd(46))} ${descStyle.render(desc)}\n`)
    }
    process.stderr.write('\n')
  }
  process.stderr.write(groupStyle.render('  Options') + '\n\n')
  for (const [opt, desc] of options) {
    process.stderr.write(`    ${optStyle.render(opt.padEnd(28))} ${descStyle.render(desc)}\n`)
  }
  process.stderr.write('\n')
}

// ── Server Status ───────────────────────────────

export function serverListening(url: string, endpoint: string): void {
  if (!isTTY()) {
    process.stderr.write(`Listening on ${url}\nAgent search: ${endpoint}\n`)
    return
  }
  process.stderr.write('\n')
  stepSuccess('Listening on', accentStyle.render(url))
  stepSuccess('Agent search:', accentStyle.render(`POST ${endpoint}`))
  process.stderr.write('\n' + dimStyle.render('  Press Ctrl+C to stop') + '\n\n')
}
