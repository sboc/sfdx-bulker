import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock electron: userData -> a per-test temp dir (read lazily), no OS encryption
// so encrypt() falls back to base64(utf8) and stays deterministic.
vi.mock('electron', () => ({
  app: { getPath: () => process.env.SFDX_BULKER_TEST_DIR! },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import * as store from './store'

const FILE = () => join(process.env.SFDX_BULKER_TEST_DIR!, 'sfdx-bulker.json')
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

beforeEach(() => {
  process.env.SFDX_BULKER_TEST_DIR = mkdtempSync(join(tmpdir(), 'sfdxbulker-'))
})

describe('saveOrg / listOrgs / getOrg', () => {
  it('creates a client-credentials org without a secret', () => {
    const saved = store.saveOrg({ name: 'Prod', clientId: 'KEY', loginUrl: 'https://p' })
    expect(saved).toMatchObject({ name: 'Prod', source: 'client-credentials', clientId: 'KEY' })
    expect(saved.id).toBeTruthy()

    const view = store.listOrgs()
    expect(view).toHaveLength(1)
    expect(view[0]).toMatchObject({ hasSecret: false, canConnect: false, connected: false })
  })

  it('stores a secret and reports canConnect', () => {
    const { id } = store.saveOrg({ name: 'Prod', clientId: 'KEY', loginUrl: 'https://p', clientSecret: 'SECRET' })
    expect(store.listOrgs()[0]).toMatchObject({ hasSecret: true, canConnect: true })
    expect(store.getOrgSecret(id)).toBe('SECRET')
  })

  it('never leaks the secret through getOrg', () => {
    const { id } = store.saveOrg({ name: 'P', clientId: 'K', loginUrl: 'https://p', clientSecret: 'S' })
    expect(store.getOrg(id)).not.toHaveProperty('secretEnc')
    expect(JSON.stringify(store.getOrg(id))).not.toContain('S')
  })

  it('edits fields and keeps the existing secret when none is supplied', () => {
    const { id } = store.saveOrg({ name: 'P', clientId: 'K', loginUrl: 'https://p', clientSecret: 'S1' })
    store.saveOrg({ id, name: 'Renamed', clientId: 'K2', loginUrl: 'https://p2' })
    expect(store.getOrg(id)).toMatchObject({ name: 'Renamed', clientId: 'K2', loginUrl: 'https://p2' })
    expect(store.getOrgSecret(id)).toBe('S1')
  })

  it('replaces the secret when a new one is supplied', () => {
    const { id } = store.saveOrg({ name: 'P', clientId: 'K', loginUrl: 'https://p', clientSecret: 'S1' })
    store.saveOrg({ id, name: 'P', clientId: 'K', loginUrl: 'https://p', clientSecret: 'S2' })
    expect(store.getOrgSecret(id)).toBe('S2')
  })
})

describe('saveOAuthOrg / getOrgRefreshToken', () => {
  it('creates an oauth org that can connect and round-trips its refresh token', () => {
    const id = store.saveOAuthOrg({
      name: 'me@acme', loginUrl: 'https://acme.my.salesforce.com', clientId: 'PlatformCLI', refreshToken: 'RT',
    })
    const view = store.listOrgs()
    expect(view).toHaveLength(1)
    expect(view[0]).toMatchObject({ id, name: 'me@acme', source: 'oauth', canConnect: true })
    expect(store.getOrgRefreshToken(id)).toBe('RT')
  })

  it('never leaks the refresh token through getOrg', () => {
    const id = store.saveOAuthOrg({ name: 'm', loginUrl: 'https://a', clientId: 'C', refreshToken: 'SECRET_RT' })
    expect(store.getOrg(id)).not.toHaveProperty('refreshTokenEnc')
    expect(JSON.stringify(store.getOrg(id))).not.toContain('SECRET_RT')
  })

  it('re-login to the same host reuses the record and replaces the refresh token', () => {
    const id1 = store.saveOAuthOrg({ name: 'old', loginUrl: 'https://a', clientId: 'C', refreshToken: 'RT1' })
    const id2 = store.saveOAuthOrg({ name: 'new', loginUrl: 'https://a', clientId: 'C', refreshToken: 'RT2' })
    expect(id2).toBe(id1)
    expect(store.listOrgs()).toHaveLength(1)
    expect(store.listOrgs()[0].name).toBe('new')
    expect(store.getOrgRefreshToken(id1)).toBe('RT2')
  })

  it('an oauth org with no refresh token cannot connect', () => {
    // saveOAuthOrg always sets one; emulate a corrupted record on disk.
    writeFileSync(FILE(), JSON.stringify({ orgs: [{ id: 'x', name: 'n', source: 'oauth', loginUrl: 'https://a' }] }))
    expect(store.listOrgs()[0]).toMatchObject({ source: 'oauth', canConnect: false })
  })
})

describe('tokens + active org', () => {
  it('round-trips encrypted tokens and reflects connected state', () => {
    const { id } = store.saveOrg({ name: 'P', clientId: 'K', loginUrl: 'https://p', clientSecret: 'S' })
    expect(store.getOrgTokens(id)).toBeNull()

    const tokens = {
      accessToken: 'tok', instanceUrl: 'https://i', username: 'u',
      displayName: 'U', organizationId: '00D', userId: '005',
    }
    store.setOrgTokens(id, tokens)
    store.setActiveOrgId(id)

    expect(store.getOrgTokens(id)).toEqual(tokens)
    expect(store.getActiveOrgId()).toBe(id)
    expect(store.listOrgs()[0].connected).toBe(true)
  })

  it('clears tokens and active id', () => {
    const { id } = store.saveOrg({ name: 'P', clientId: 'K', loginUrl: 'https://p' })
    store.setOrgTokens(id, {
      accessToken: 't', instanceUrl: 'i', username: 'u', displayName: 'U', organizationId: 'o', userId: 'x',
    })
    store.setActiveOrgId(id)
    store.setOrgTokens(id, null)
    store.setActiveOrgId(null)
    expect(store.getOrgTokens(id)).toBeNull()
    expect(store.getActiveOrgId()).toBeNull()
  })

  it('clearAllOrgTokens drops every org session but keeps the saved orgs', () => {
    const a = store.saveOrg({ name: 'A', clientId: 'K', loginUrl: 'https://a' })
    const b = store.saveOrg({ name: 'B', clientId: 'K', loginUrl: 'https://b' })
    const tk = { accessToken: 't', instanceUrl: 'i', username: 'u', displayName: 'U', organizationId: 'o', userId: 'x' }
    store.setOrgTokens(a.id, tk)
    store.setOrgTokens(b.id, tk)

    store.clearAllOrgTokens()

    expect(store.getOrgTokens(a.id)).toBeNull()
    expect(store.getOrgTokens(b.id)).toBeNull()
    expect(store.listOrgs().map((o) => o.id).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('deleteOrg', () => {
  it('removes the org, its tokens, and clears active when it was active', () => {
    const { id } = store.saveOrg({ name: 'P', clientId: 'K', loginUrl: 'https://p' })
    store.setOrgTokens(id, {
      accessToken: 't', instanceUrl: 'i', username: 'u', displayName: 'U', organizationId: 'o', userId: 'x',
    })
    store.setActiveOrgId(id)
    store.deleteOrg(id)
    expect(store.listOrgs()).toEqual([])
    expect(store.getOrgTokens(id)).toBeNull()
    expect(store.getActiveOrgId()).toBeNull()
  })
})

describe('load mapping history', () => {
  const m = {
    object: 'Account',
    operation: 'insert' as const,
    columns: ['Name', 'Email'],
    mapping: { Name: 'Name', Email: 'Email__c' },
    updatedAt: 1,
  }

  it('saves and suggests a mapping for the same object + operation + column set', () => {
    store.saveLoadMapping('org1', m)
    // Column order does not matter for the match.
    const hit = store.suggestLoadMapping('org1', 'Account', 'insert', ['Email', 'Name'])
    expect(hit?.mapping).toEqual({ Name: 'Name', Email: 'Email__c' })
  })

  it('does not suggest across orgs, operations, objects, or differing columns', () => {
    store.saveLoadMapping('org1', m)
    expect(store.suggestLoadMapping('org2', 'Account', 'insert', ['Name', 'Email'])).toBeNull()
    expect(store.suggestLoadMapping('org1', 'Account', 'update', ['Name', 'Email'])).toBeNull()
    expect(store.suggestLoadMapping('org1', 'Contact', 'insert', ['Name', 'Email'])).toBeNull()
    expect(store.suggestLoadMapping('org1', 'Account', 'insert', ['Name'])).toBeNull()
  })

  it('replaces a prior mapping with the same signature (latest wins)', () => {
    store.saveLoadMapping('org1', m)
    store.saveLoadMapping('org1', { ...m, mapping: { Name: 'FirstName', Email: '' }, updatedAt: 2 })
    const hit = store.suggestLoadMapping('org1', 'Account', 'insert', ['Name', 'Email'])
    expect(hit?.mapping).toEqual({ Name: 'FirstName', Email: '' })
  })
})

describe('legacy migration', () => {
  it('converts the old single-org config into a saved org and drops legacy keys', () => {
    const legacy = {
      config: { clientId: 'KEY', loginUrl: 'https://acme.my.salesforce.com' },
      clientSecretEnc: b64('LEGACY_SECRET'),
      tokensEnc: b64(JSON.stringify({
        accessToken: 'tok', instanceUrl: 'https://acme.my.salesforce.com', username: 'me@acme',
        displayName: 'Me', organizationId: '00D', userId: '005',
      })),
    }
    writeFileSync(FILE(), JSON.stringify(legacy))

    const orgs = store.listOrgs()
    expect(orgs).toHaveLength(1)
    const o = orgs[0]
    expect(o).toMatchObject({
      name: 'acme.my.salesforce.com',
      source: 'client-credentials',
      clientId: 'KEY',
      hasSecret: true,
      connected: true,
    })
    expect(store.getOrgSecret(o.id)).toBe('LEGACY_SECRET')
    expect(store.getActiveOrgId()).toBe(o.id)

    // Legacy keys are gone from the persisted file; it's now the new schema.
    const onDisk = JSON.parse(readFileSync(FILE(), 'utf8'))
    expect(onDisk).not.toHaveProperty('config')
    expect(onDisk).not.toHaveProperty('clientSecretEnc')
    expect(onDisk).not.toHaveProperty('tokensEnc')
    expect(onDisk.orgs).toHaveLength(1)
  })

  it('is a no-op when there is no legacy config', () => {
    expect(existsSync(FILE())).toBe(false)
    expect(store.listOrgs()).toEqual([])
  })
})
