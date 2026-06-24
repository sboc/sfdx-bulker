import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CliOrg } from '../src/shared/types'

const pexec = promisify(execFile)

// Try the modern `sf` first, then legacy `sfdx`. Both accept the same args used here.
const BINARIES = ['sf', 'sfdx']
let cachedBin: string | null = null

const NOT_FOUND =
  'Salesforce CLI not found. Install the `sf` CLI and run `sf org login web` to authenticate an org.'

async function resolveBin(): Promise<string> {
  if (cachedBin) return cachedBin
  for (const bin of BINARIES) {
    try {
      await pexec(bin, ['--version'])
      cachedBin = bin
      return bin
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      // Ran but exited non-zero - still a usable binary.
      cachedBin = bin
      return bin
    }
  }
  throw new Error(NOT_FOUND)
}

/** True if an `sf`/`sfdx` binary is available. Used by the UI to pick a login path. */
export async function cliAvailable(): Promise<boolean> {
  try {
    await resolveBin()
    return true
  } catch {
    return false
  }
}

interface CliEnvelope<T> {
  status: number
  result: T
  message?: string
}

async function runCli<T>(args: string[]): Promise<T> {
  const bin = await resolveBin()
  try {
    const { stdout } = await pexec(bin, args, { maxBuffer: 16 * 1024 * 1024 })
    return (JSON.parse(stdout) as CliEnvelope<T>).result
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string }
    if (err.code === 'ENOENT') throw new Error(NOT_FOUND, { cause: e })
    // The CLI emits a JSON error payload on stdout even when it exits non-zero.
    let cliMessage: string | undefined
    if (err.stdout) {
      try {
        cliMessage = (JSON.parse(err.stdout) as CliEnvelope<unknown>).message
      } catch {
        /* stdout was not JSON */
      }
    }
    throw new Error(cliMessage || err.message || 'Salesforce CLI command failed', { cause: e })
  }
}

interface CliOrgListEntry {
  username: string
  alias?: string
  aliases?: string[]
  instanceUrl?: string
  orgId?: string
}

export interface CliOrgListResult {
  nonScratchOrgs?: CliOrgListEntry[]
  scratchOrgs?: CliOrgListEntry[]
  sandboxes?: CliOrgListEntry[]
  devHubs?: CliOrgListEntry[]
  other?: CliOrgListEntry[]
}

/** Flatten + dedupe the `sf org list --json` result into a sorted org list. (Pure.) */
export function parseCliOrgList(result: CliOrgListResult): CliOrg[] {
  const groups = [
    result.nonScratchOrgs,
    result.scratchOrgs,
    result.sandboxes,
    result.devHubs,
    result.other,
  ]
  const byUser = new Map<string, CliOrg>()
  for (const group of groups) {
    for (const o of group ?? []) {
      if (!o.username || byUser.has(o.username)) continue
      byUser.set(o.username, {
        username: o.username,
        alias: o.alias ?? o.aliases?.[0],
        instanceUrl: o.instanceUrl ?? '',
        orgId: o.orgId ?? '',
      })
    }
  }
  return [...byUser.values()].sort((a, b) => a.username.localeCompare(b.username))
}

/** List every org the Salesforce CLI has authenticated. */
export async function listCliOrgs(): Promise<CliOrg[]> {
  return parseCliOrgList(await runCli<CliOrgListResult>(['org', 'list', '--json']))
}

interface CliOrgDisplay {
  accessToken?: string
  instanceUrl?: string
  username?: string
  id?: string
}

/**
 * Launch the CLI web login (`sf org login web`). Opens the system browser and
 * blocks until the user completes authentication. Returns the new org's username.
 */
export async function loginCliOrg(opts: {
  alias?: string
  instanceUrl: string
}): Promise<{ username: string }> {
  const args = ['org', 'login', 'web', '--instance-url', opts.instanceUrl, '--json']
  if (opts.alias?.trim()) args.push('--alias', opts.alias.trim())
  const r = await runCli<{ username?: string }>(args)
  if (!r.username) throw new Error('Login did not return a username.')
  return { username: r.username }
}

/** Log an org out of the Salesforce CLI. */
export async function logoutCliOrg(username: string): Promise<void> {
  await runCli(['org', 'logout', '--target-org', username, '--no-prompt', '--json'])
}

/** Get a fresh access token + instance URL for a CLI-authenticated org. */
export async function getCliOrgAuth(
  username: string,
): Promise<{ accessToken: string; instanceUrl: string }> {
  const r = await runCli<CliOrgDisplay>([
    'org',
    'display',
    '--target-org',
    username,
    '--verbose',
    '--json',
  ])
  if (!r.accessToken || !r.instanceUrl) {
    throw new Error(`Salesforce CLI returned no access token for ${username}. Re-authenticate it.`)
  }
  return { accessToken: r.accessToken, instanceUrl: r.instanceUrl }
}
