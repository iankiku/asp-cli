#!/usr/bin/env node
/**
 * Build ASP platform binaries using `bun build --compile`.
 * Run with: node scripts/build.mjs [--target <platform-arch>]
 *
 * Without --target: builds for the current platform only (fast, for local dev).
 * With --all:       builds darwin-arm64, darwin-x64, linux-x64, linux-arm64.
 *
 * Output: bin/asp-<platform>-<arch>[.exe]
 */

import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import os from 'os'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const EXTERNALS = ['--external', 'puppeteer', '--external', '@crawlee/puppeteer']
const ENTRY = 'src/cli.ts'

// bun's --target values: bun-darwin-arm64, bun-linux-x64, bun-windows-x64, etc.
const ALL_TARGETS = [
  { bun: 'bun-darwin-arm64',  out: 'bin/asp-darwin-arm64' },
  { bun: 'bun-darwin-x64',    out: 'bin/asp-darwin-x64' },
  { bun: 'bun-linux-arm64',   out: 'bin/asp-linux-arm64' },
  { bun: 'bun-linux-x64',     out: 'bin/asp-linux-x64' },
  { bun: 'bun-windows-x64',   out: 'bin/asp-win32-x64.exe' },
]

const buildAll = process.argv.includes('--all')
const targets = buildAll
  ? ALL_TARGETS
  : [{ bun: undefined, out: `bin/asp-${os.platform()}-${os.arch()}` }]

for (const { bun: bunTarget, out } of targets) {
  const args = ['build', ENTRY, '--compile', `--outfile=${out}`, ...EXTERNALS]
  if (bunTarget) args.splice(2, 0, `--target=${bunTarget}`)
  console.log(`Building → ${out}`)
  execFileSync('bun', args, { stdio: 'inherit', cwd: PKG_DIR })
}
