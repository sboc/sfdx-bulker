import { execFileSync } from 'node:child_process'

/**
 * Desktop-launched GUI apps (e.g. an AppImage started from the menu) inherit a
 * minimal PATH that usually omits the node / version-manager bin dirs where the
 * Salesforce CLI lives (nvm, volta, asdf, Homebrew...). Resolve the user's
 * login-shell PATH and merge it into process.env so `sf` is findable.
 *
 * Uses the external `env` command (not `echo $PATH`) so the output is
 * colon-joined regardless of shell - fish prints $PATH space-separated.
 */
export function fixPathEnv(): void {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || '/bin/bash'
  try {
    const out = execFileSync(shell, ['-ilc', 'env'], { encoding: 'utf8', timeout: 5000 })
    const line = out.split('\n').find((l) => l.startsWith('PATH='))
    if (!line) return
    const shellPath = line.slice('PATH='.length)
    process.env.PATH = [...new Set([...shellPath.split(':'), ...(process.env.PATH ?? '').split(':')])]
      .filter(Boolean)
      .join(':')
  } catch {
    // Leave PATH untouched; sfcli surfaces a clear "CLI not found" error.
  }
}
