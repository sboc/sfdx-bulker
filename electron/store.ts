import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import type { SavedOrg, SavedOrgView, SaveOrgInput } from '../src/shared/types'

export interface StoredTokens {
  accessToken: string
  instanceUrl: string
  username: string
  displayName: string
  organizationId: string
  userId: string
}

interface PersistedOrg extends SavedOrg {
  /** Base64 of safeStorage-encrypted Consumer Secret (client-credentials orgs). */
  secretEnc?: string
  /** Base64 of safeStorage-encrypted OAuth refresh token (oauth orgs). */
  refreshTokenEnc?: string
}

interface Persisted {
  orgs?: PersistedOrg[]
  activeOrgId?: string
  /** orgId -> base64 of safeStorage-encrypted StoredTokens JSON. */
  tokens?: Record<string, string>
}

/** Legacy single-org schema (pre-multi-org). */
interface LegacyPersisted extends Persisted {
  config?: { clientId: string; loginUrl: string }
  clientSecretEnc?: string
  tokensEnc?: string
}

const file = () => join(app.getPath('userData'), 'sfdx-bulker.json')

function load(): Persisted {
  try {
    const p = file()
    if (!existsSync(p)) return {}
    return migrate(JSON.parse(readFileSync(p, 'utf8')) as LegacyPersisted)
  } catch {
    return {}
  }
}

/** Convert the old single-org config into a saved org. Runs once, then persists. */
function migrate(data: LegacyPersisted): Persisted {
  if (!data.config) return data
  const id = randomUUID()
  const host = data.config.loginUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const org: PersistedOrg = {
    id,
    name: host || 'Imported org',
    source: 'client-credentials',
    clientId: data.config.clientId,
    loginUrl: data.config.loginUrl,
    secretEnc: data.clientSecretEnc,
  }
  data.orgs = [...(data.orgs ?? []), org]
  if (data.tokensEnc) {
    data.tokens = { ...(data.tokens ?? {}), [id]: data.tokensEnc }
    data.activeOrgId ??= id
  }
  delete data.config
  delete data.clientSecretEnc
  delete data.tokensEnc
  save(data)
  return data
}

function save(data: Persisted): void {
  const p = file()
  mkdirSync(dirname(p), { recursive: true })
  // Write to a temp file then rename - an atomic swap so a crash mid-write
  // can't corrupt the credential store (leaves the previous file intact).
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(tmp, p)
}

function encrypt(plain: string): string {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain)
    : Buffer.from(plain, 'utf8')
  return buf.toString('base64')
}

function decrypt(b64: string): string | null {
  try {
    const buf = Buffer.from(b64, 'base64')
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return null
  }
}

// ---- Orgs ----

export function listOrgs(): SavedOrgView[] {
  const data = load()
  return (data.orgs ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    source: o.source,
    clientId: o.clientId,
    cliUsername: o.cliUsername,
    loginUrl: o.loginUrl,
    hasSecret: !!o.secretEnc,
    canConnect:
      o.source === 'cli' ? true : o.source === 'oauth' ? !!o.refreshTokenEnc : !!o.secretEnc,
    connected: data.activeOrgId === o.id && !!data.tokens?.[o.id],
  }))
}

/** Public-safe org record (no secret) for internal callers. */
export function getOrg(id: string): SavedOrg | null {
  const o = load().orgs?.find((x) => x.id === id)
  return o
    ? {
        id: o.id,
        name: o.name,
        source: o.source,
        clientId: o.clientId,
        cliUsername: o.cliUsername,
        loginUrl: o.loginUrl,
      }
    : null
}

export function getOrgSecret(id: string): string | null {
  const enc = load().orgs?.find((x) => x.id === id)?.secretEnc
  return enc ? decrypt(enc) : null
}

export function getOrgRefreshToken(id: string): string | null {
  const enc = load().orgs?.find((x) => x.id === id)?.refreshTokenEnc
  return enc ? decrypt(enc) : null
}

/** Create (or update by login URL) an oauth org from a completed web login. Returns its id. */
export function saveOAuthOrg(input: {
  name: string
  loginUrl: string
  clientId: string
  refreshToken: string
}): string {
  const data = load()
  data.orgs ??= []
  // Re-login to the same host reuses the existing org record (refreshes its token).
  const existing = data.orgs.find((o) => o.source === 'oauth' && o.loginUrl === input.loginUrl)
  const org: PersistedOrg = existing ?? {
    id: randomUUID(),
    name: input.name,
    source: 'oauth',
    clientId: input.clientId,
    loginUrl: input.loginUrl,
  }
  org.name = input.name
  org.clientId = input.clientId
  org.refreshTokenEnc = encrypt(input.refreshToken)
  if (!existing) data.orgs.push(org)
  save(data)
  return org.id
}

function toSavedOrg(o: PersistedOrg): SavedOrg {
  return {
    id: o.id,
    name: o.name,
    source: o.source,
    clientId: o.clientId,
    cliUsername: o.cliUsername,
    loginUrl: o.loginUrl,
  }
}

export function saveOrg(input: SaveOrgInput): SavedOrg {
  const data = load()
  data.orgs ??= []
  const base = { name: input.name, clientId: input.clientId, loginUrl: input.loginUrl }
  let org: PersistedOrg
  if (input.id) {
    const existing = data.orgs.find((x) => x.id === input.id)
    if (!existing) throw new Error('Org not found')
    Object.assign(existing, base)
    if (input.clientSecret) existing.secretEnc = encrypt(input.clientSecret)
    org = existing
  } else {
    org = { id: randomUUID(), source: 'client-credentials', ...base }
    if (input.clientSecret) org.secretEnc = encrypt(input.clientSecret)
    data.orgs.push(org)
  }
  save(data)
  return toSavedOrg(org)
}

export function deleteOrg(id: string): void {
  const data = load()
  data.orgs = (data.orgs ?? []).filter((x) => x.id !== id)
  if (data.tokens) delete data.tokens[id]
  if (data.activeOrgId === id) delete data.activeOrgId
  save(data)
}

export function getActiveOrgId(): string | null {
  return load().activeOrgId ?? null
}

export function setActiveOrgId(id: string | null): void {
  const data = load()
  if (id) data.activeOrgId = id
  else delete data.activeOrgId
  save(data)
}

// ---- Per-org tokens ----

export function getOrgTokens(id: string): StoredTokens | null {
  const enc = load().tokens?.[id]
  if (!enc) return null
  const json = decrypt(enc)
  if (!json) return null
  try {
    return JSON.parse(json) as StoredTokens
  } catch {
    return null
  }
}

export function setOrgTokens(id: string, tokens: StoredTokens | null): void {
  const data = load()
  data.tokens ??= {}
  if (tokens) data.tokens[id] = encrypt(JSON.stringify(tokens))
  else delete data.tokens[id]
  save(data)
}

/** Drop every org's cached session tokens (keeps saved orgs + refresh tokens). */
export function clearAllOrgTokens(): void {
  const data = load()
  if (!data.tokens) return
  data.tokens = {}
  save(data)
}
