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
