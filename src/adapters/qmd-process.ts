import { existsSync, statSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { config } from '../config'

export function resolveQmdJs(): string {
  const QMD_SUBPATH = ['@tobilu', 'qmd', 'dist', 'cli', 'qmd.js']

  const candidates = [
    // 1. Dev: relative to source file (works when running from source with bun)
    resolve(dirname(import.meta.dir), '..', 'node_modules', ...QMD_SUBPATH),
    // 2. Compiled binary: relative to the binary itself (works after npm install -g)
    resolve(dirname(process.execPath), '..', 'node_modules', ...QMD_SUBPATH),
    // 3. Also try two levels up (some package managers hoist differently)
    resolve(dirname(process.execPath), '..', '..', 'node_modules', ...QMD_SUBPATH),
  ]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  // 4. Last resort: global require.resolve (works if qmd is globally installed)
  try {
    return require.resolve('@tobilu/qmd/dist/cli/qmd.js')
  } catch {}

  return ''
}

export function resolveNodeBin(): string {
  const candidates = [
    process.env.NODE_PATH && resolve(process.env.NODE_PATH, '..', 'bin', 'node'),
    '/usr/local/bin/node',
    '/usr/bin/node',
  ].filter(Boolean) as string[]

  const nvmDir = process.env.NVM_DIR || resolve(process.env.HOME || '', '.nvm')
  if (existsSync(nvmDir)) {
    const nvmCurrent = resolve(nvmDir, 'current', 'bin', 'node')
    if (existsSync(nvmCurrent)) candidates.unshift(nvmCurrent)
  }

  try {
    const proc = Bun.spawnSync(['which', 'node'], { stdout: 'pipe' })
    const path = new TextDecoder().decode(proc.stdout).trim()
    if (path) candidates.unshift(path)
  } catch {}

  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return 'node'
}

const QMD_JS = resolveQmdJs()
const NODE_BIN = resolveNodeBin()

export async function run(args: string[], opts?: { cwd?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!QMD_JS) {
    throw new Error('qmd not found. Run: npm install @tobilu/qmd')
  }
  // Redirect qmd's cache to the project-local index dir so each project has its own index.
  // qmd resolves its SQLite path as: $XDG_CACHE_HOME/qmd/index.sqlite
  mkdirSync(config.indexDir, { recursive: true })
  const proc = Bun.spawn([NODE_BIN, QMD_JS, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: opts?.cwd,
    env: { ...process.env, XDG_CACHE_HOME: config.indexDir },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

export async function qmdAvailable(): Promise<boolean> {
  // QMD_JS is resolved by checking file existence at module load time — no spawn needed
  return Boolean(QMD_JS)
}

export async function ensureQmd(): Promise<void> {
  if (QMD_JS) return  // fast path: file already resolved, no subprocess needed
  const proc = Bun.spawn(['npm', 'install', '-g', '@tobilu/qmd'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error('Failed to install qmd. Run manually: npm install -g @tobilu/qmd')
  }
  // Verify the install actually worked with a real run (QMD_JS was empty before install)
  try {
    const { exitCode } = await run(['--version'])
    if (exitCode !== 0) throw new Error()
  } catch {
    throw new Error('qmd installed but not found on PATH. Restart your terminal and try again.')
  }
}

export function findQmdIndex(): string | null {
  const candidates = [
    config.indexPath,                                                           // project-local (default: .asp/qmd/index.sqlite)
    resolve(process.env.HOME || '', '.cache', 'qmd', 'index.sqlite'),          // legacy global fallback
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return null
}

export function getIndexInfo(indexPath: string): string {
  const actualPath = existsSync(indexPath) ? indexPath : findQmdIndex()
  if (!actualPath) return 'Not found (run: asp index <url-or-path>)'
  try {
    const bytes = statSync(actualPath).size
    const mb = (bytes / 1024 / 1024).toFixed(1)
    return `${actualPath} (${mb} MB)`
  } catch {
    return `${actualPath} (unreadable)`
  }
}
