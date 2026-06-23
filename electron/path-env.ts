import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the user's login-shell PATH. Tries a few shells; detaches stdin/stderr
 * so an interactive shell can't hang waiting for a tty. Uses the external `env`
 * command so output is colon-joined across shells (fish prints $PATH space-joined).
 */
function shellPath(): string | null {
  const shells = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean) as string[]
  for (const sh of shells) {
    try {
      const out = execFileSync(sh, ['-ilc', 'env'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const line = out.split('\n').find((l) => l.startsWith('PATH='))
      if (line) return line.slice('PATH='.length)
    } catch {
      // try the next shell
    }
  }
  return null
}

/** Well-known bin dirs where CLIs (and version managers) live, that actually exist. */
function knownBinDirs(): string[] {
  const home = homedir()
  const dirs = [
    join(home, '.local/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(home, '.volta/bin'),
    join(home, '.bun/bin'),
    join(home, '.deno/bin'),
    join(home, '.asdf/shims'),
  ]
  // Every installed nvm node version's bin (covers the active one - where `sf` often is).
  const nvmRoot = join(home, '.nvm/versions/node')
  try {
    for (const v of readdirSync(nvmRoot)) dirs.push(join(nvmRoot, v, 'bin'))
  } catch {
    // no nvm
  }
  return dirs.filter((d) => existsSync(d))
}

/**
 * Desktop-launched GUI apps (e.g. an AppImage started from the menu) inherit a
 * minimal PATH that usually omits the node / version-manager bin dirs where the
 * Salesforce CLI lives. Merge the login-shell PATH plus known bin dirs into
 * process.env.PATH so `sf` is findable. Best-effort; never throws.
 */
export function fixPathEnv(): void {
  if (process.platform === 'win32') return
  const parts: string[] = []
  const sp = shellPath()
  if (sp) parts.push(...sp.split(':'))
  parts.push(...knownBinDirs())
  parts.push(...(process.env.PATH ?? '').split(':'))
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(':')
}
