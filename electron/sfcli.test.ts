import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock child_process so no real `sf` CLI runs. promisify(execFile) honours the
// custom-promisify symbol, so we attach our impl there (returns {stdout,stderr}).
vi.mock('node:child_process', () => {
  const PROMISIFY = Symbol.for('nodejs.util.promisify.custom')
  const impl = (_file: string, args: string[]) => {
    ;(globalThis as Record<string, unknown>).__sfCalls ??= []
    ;((globalThis as Record<string, unknown>).__sfCalls as string[][]).push(args)
    const a = args.join(' ')
    if (args.includes('--version')) return Promise.resolve({ stdout: '@salesforce/cli/2.0', stderr: '' })
    if (a.startsWith('org list')) {
      return Promise.resolve({
        stdout: JSON.stringify({
          status: 0,
          result: {
            nonScratchOrgs: [{ username: 'prod@x', alias: 'prod', instanceUrl: 'https://p', orgId: '00Dp' }],
            sandboxes: [{ username: 'uat@x', instanceUrl: 'https://u', orgId: '00Du' }],
          },
        }),
      })
    }
    if (a.startsWith('org display')) {
      if (args.includes('notoken@x')) {
        return Promise.resolve({ stdout: JSON.stringify({ result: { username: 'notoken@x' } }) })
      }
      const user = args[args.indexOf('--target-org') + 1]
      return Promise.resolve({
        stdout: JSON.stringify({ result: { accessToken: 'TOK', instanceUrl: 'https://i', username: user } }),
      })
    }
    if (a.startsWith('org login web')) {
      return Promise.resolve({ stdout: JSON.stringify({ result: { username: 'new@x' } }) })
    }
    if (a.startsWith('org logout')) {
      if (args.includes('fail@x')) {
        const e = Object.assign(new Error('exit 1'), {
          stdout: JSON.stringify({ status: 1, message: 'Logout failed' }),
        })
        return Promise.reject(e)
      }
      return Promise.resolve({ stdout: JSON.stringify({ result: {} }) })
    }
    return Promise.resolve({ stdout: '{}' })
  }
  const execFile = Object.assign(vi.fn(), { [PROMISIFY]: impl })
  return { execFile }
})

import { listCliOrgs, getCliOrgAuth, loginCliOrg, logoutCliOrg, cliAvailable, parseCliOrgList, type CliOrgListResult } from './sfcli'

const sfCalls = () => ((globalThis as Record<string, unknown>).__sfCalls as string[][]) ?? []
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).__sfCalls = []
})

describe('parseCliOrgList', () => {
  it('flattens, dedupes (first wins) and sorts by username', () => {
    const result: CliOrgListResult = {
      nonScratchOrgs: [{ username: 'zeta@x', alias: 'z' }, { username: 'dup@x', alias: 'first' }],
      devHubs: [{ username: 'dup@x', alias: 'second' }],
      other: [{ username: 'alpha@x' }],
    }
    const orgs = parseCliOrgList(result)
    expect(orgs.map((o) => o.username)).toEqual(['alpha@x', 'dup@x', 'zeta@x'])
    expect(orgs.find((o) => o.username === 'dup@x')?.alias).toBe('first')
  })

  it('falls back to aliases[0] and empty strings, skips entries without a username', () => {
    expect(parseCliOrgList({ other: [{ username: 'a@x', aliases: ['al'] }, { username: '' }] })).toEqual([
      { username: 'a@x', alias: 'al', instanceUrl: '', orgId: '' },
    ])
  })
})

describe('listCliOrgs (via CLI)', () => {
  it('runs `org list --json` and returns the parsed orgs', async () => {
    const orgs = await listCliOrgs()
    expect(orgs.map((o) => o.username)).toEqual(['prod@x', 'uat@x'])
    expect(sfCalls().some((c) => c.join(' ') === 'org list --json')).toBe(true)
  })
})

describe('getCliOrgAuth', () => {
  it('returns the access token + instance URL', async () => {
    expect(await getCliOrgAuth('prod@x')).toEqual({ accessToken: 'TOK', instanceUrl: 'https://i' })
  })

  it('throws when the CLI returns no access token', async () => {
    await expect(getCliOrgAuth('notoken@x')).rejects.toThrow(/no access token/i)
  })
})

describe('loginCliOrg', () => {
  it('passes --instance-url and --alias and returns the new username', async () => {
    const res = await loginCliOrg({ alias: 'prod', instanceUrl: 'https://login.salesforce.com' })
    expect(res).toEqual({ username: 'new@x' })
    const args = sfCalls().find((c) => c.join(' ').startsWith('org login web'))!
    expect(args).toContain('--instance-url')
    expect(args).toContain('https://login.salesforce.com')
    expect(args).toContain('--alias')
    expect(args).toContain('prod')
  })

  it('omits --alias when none is given', async () => {
    await loginCliOrg({ instanceUrl: 'https://login.salesforce.com' })
    const args = sfCalls().find((c) => c.join(' ').startsWith('org login web'))!
    expect(args).not.toContain('--alias')
  })
})

describe('logoutCliOrg', () => {
  it('logs out with --no-prompt', async () => {
    await logoutCliOrg('prod@x')
    const args = sfCalls().find((c) => c.join(' ').startsWith('org logout'))!
    expect(args).toContain('--no-prompt')
    expect(args).toContain('prod@x')
  })

  it('surfaces the CLI error message from its JSON payload', async () => {
    await expect(logoutCliOrg('fail@x')).rejects.toThrow('Logout failed')
  })
})

describe('cliAvailable', () => {
  it('returns true when a binary resolves', async () => {
    expect(await cliAvailable()).toBe(true)
  })

  it('returns false when no `sf`/`sfdx` binary is found', async () => {
    // Fresh module + a child_process that ENOENTs on every spawn (no cached bin).
    vi.resetModules()
    vi.doMock('node:child_process', () => {
      const PROMISIFY = Symbol.for('nodejs.util.promisify.custom')
      const impl = () => Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }))
      return { execFile: Object.assign(vi.fn(), { [PROMISIFY]: impl }) }
    })
    const { cliAvailable: fresh } = await import('./sfcli')
    expect(await fresh()).toBe(false)
    vi.doUnmock('node:child_process')
    vi.resetModules()
  })
})
