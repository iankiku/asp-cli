#!/usr/bin/env node
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

// Try the pre-compiled platform binary first — no Bun required on the machine
function compiledBinPath() {
  const platform = os.platform()  // darwin, linux, win32
  const arch = os.arch()          // arm64, x64
  const ext = platform === 'win32' ? '.exe' : ''
  return path.resolve(__dirname, `asp-${platform}-${arch}${ext}`)
}

const compiled = compiledBinPath()
if (fs.existsSync(compiled)) {
  const r = spawnSync(compiled, process.argv.slice(2), { stdio: 'inherit', env: process.env })
  process.exit(r.status ?? 1)
}

// Fallback: run from source via Bun (dev / unsupported platform)
function hasBun() {
  const r = spawnSync('bun', ['--version'], { encoding: 'utf8' })
  return r.status === 0 && !!r.stdout
}

if (!hasBun()) {
  const p = os.platform()
  const hint = (p === 'darwin' || p === 'linux')
    ? '  curl -fsSL https://bun.sh/install | bash'
    : p === 'win32'
    ? '  powershell -c "irm bun.sh/install.ps1 | iex"'
    : '  See https://bun.sh'
  console.error('ASP: no pre-built binary found for this platform and Bun is not installed.')
  console.error('Install Bun to run from source:')
  console.error(hint)
  process.exit(1)
}

const cli = path.resolve(__dirname, '..', 'src', 'cli.ts')
const r = spawnSync('bun', [cli, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })
process.exit(r.status ?? 1)
