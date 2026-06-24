import jsforce from 'jsforce'
import type { Connection } from 'jsforce'
import {
  getActiveOrgId,
  getOrg,
  getOrgRefreshToken,
  getOrgSecret,
  getOrgTokens,
  listOrgs,
  saveOAuthOrg,
  setActiveOrgId,
  setOrgTokens,
  type StoredTokens,
} from './store'
import { requestClientCredentialsToken, requestRefreshToken, type TokenResponse } from './oauth'
import { getCliOrgAuth, listCliOrgs as listCliOrgsRaw } from './sfcli'
import { runWebLogin, OAUTH_CLIENT_ID } from './web-oauth'
import { toJobInfo, type RawJobInfo } from './transform'
import { recordsToCsv } from '../src/shared/csv'
import type {
  IngestJobRequest,
  JobInfo,
  OrgIdentity,
  QueryJobRequest,
  ResultKind,
  SavedOrgView,
  SObjectField,
  SObjectInfo,
} from '../src/shared/types'

const API_VERSION = '62.0'

/** Resolve the identity (username/org) for a freshly issued token via userinfo. */
async function fetchIdentity(t: TokenResponse): Promise<OrgIdentity> {
  const resp = await fetch(new URL('/services/oauth2/userinfo', t.instance_url), {
    headers: { Authorization: `Bearer ${t.access_token}` },
  })
  if (!resp.ok) throw new Error(`Failed to load identity (${resp.status})`)
  const id = (await resp.json()) as {
    preferred_username?: string
    name?: string
    organization_id?: string
    user_id?: string
    sub?: string
  }
  return {
    instanceUrl: t.instance_url,
    username: id.preferred_username ?? id.name ?? 'unknown',
    displayName: id.name ?? id.preferred_username ?? 'Salesforce user',
    organizationId: id.organization_id ?? '',
    userId: id.user_id ?? id.sub ?? '',
  }
}

/** Virtual id prefix for CLI orgs that aren't saved. */
const CLI_PREFIX = 'cli:'

/** Acquire a fresh access token for an org id, by whatever source it uses. */
async function acquireToken(orgId: string): Promise<TokenResponse> {
  // Virtual CLI org: `cli:<username>`, not persisted as a saved org.
  if (orgId.startsWith(CLI_PREFIX)) {
    const auth = await getCliOrgAuth(orgId.slice(CLI_PREFIX.length))
    return { access_token: auth.accessToken, instance_url: auth.instanceUrl, token_type: 'Bearer' }
  }
  const org = getOrg(orgId)
  if (!org) throw new Error('Org not found.')
  if (org.source === 'cli') {
    if (!org.cliUsername) throw new Error('CLI org is missing its username.')
    const auth = await getCliOrgAuth(org.cliUsername)
    return { access_token: auth.accessToken, instance_url: auth.instanceUrl, token_type: 'Bearer' }
  }
  if (org.source === 'oauth') {
    const refreshToken = getOrgRefreshToken(orgId)
    if (!refreshToken) throw new Error('Org has no stored refresh token. Sign in again.')
    return requestRefreshToken(org.loginUrl, OAUTH_CLIENT_ID, refreshToken)
  }
  if (!org.clientId) throw new Error('Org is missing its Consumer Key.')
  const secret = getOrgSecret(orgId)
  if (!secret) throw new Error('No Consumer Secret configured for this org.')
  return requestClientCredentialsToken({ clientId: org.clientId, loginUrl: org.loginUrl }, secret)
}

/** Sign in to a saved org and make it the active connection. */
export async function connect(orgId: string): Promise<OrgIdentity> {
  const token = await acquireToken(orgId)
  const identity = await fetchIdentity(token)
  setOrgTokens(orgId, {
    accessToken: token.access_token,
    instanceUrl: token.instance_url,
    username: identity.username,
    displayName: identity.displayName,
    organizationId: identity.organizationId,
    userId: identity.userId,
  })
  setActiveOrgId(orgId)
  return identity
}

/**
 * CLI-free browser login: runs the OAuth web flow (PKCE), persists the org with its
 * refresh token, signs in, and makes it the active connection. `instanceUrl` is the
 * chosen login host (login/test.salesforce.com or a My Domain).
 */
export async function loginWeb(opts: { alias?: string; instanceUrl: string }): Promise<OrgIdentity> {
  const token = await runWebLogin({ instanceUrl: opts.instanceUrl })
  const identity = await fetchIdentity(token)
  // Store the org keyed by its real instance URL so token refresh hits the right host.
  const orgId = saveOAuthOrg({
    name: opts.alias?.trim() || identity.username,
    loginUrl: token.instance_url,
    clientId: OAUTH_CLIENT_ID,
    refreshToken: token.refresh_token as string,
  })
  setOrgTokens(orgId, {
    accessToken: token.access_token,
    instanceUrl: token.instance_url,
    username: identity.username,
    displayName: identity.displayName,
    organizationId: identity.organizationId,
    userId: identity.userId,
  })
  setActiveOrgId(orgId)
  return identity
}

/** Drop any cached session for a CLI org (called after `sf org logout`). */
export function forgetCliSession(username: string): void {
  const id = `${CLI_PREFIX}${username}`
  setOrgTokens(id, null)
  if (getActiveOrgId() === id) setActiveOrgId(null)
}

export function disconnect(): void {
  const id = getActiveOrgId()
  if (id) setOrgTokens(id, null)
  setActiveOrgId(null)
}

export function currentIdentity(): OrgIdentity | null {
  const id = getActiveOrgId()
  const t = id ? getOrgTokens(id) : null
  if (!t) return null
  return {
    instanceUrl: t.instanceUrl,
    username: t.username,
    displayName: t.displayName,
    organizationId: t.organizationId,
    userId: t.userId,
  }
}

/** Active org id + its tokens, or throw if not connected. */
function requireActive(): { orgId: string; tokens: StoredTokens } {
  const orgId = getActiveOrgId()
  const tokens = orgId ? getOrgTokens(orgId) : null
  if (!orgId || !tokens) throw new Error('Not connected to a Salesforce org.')
  return { orgId, tokens }
}

/** Build a jsforce Connection from stored tokens. */
function connection(t: StoredTokens): Connection {
  return new jsforce.Connection({
    instanceUrl: t.instanceUrl,
    accessToken: t.accessToken,
    version: API_VERSION,
  })
}

/** Re-acquire the active org's access token (no refresh token; re-fetch from the source). */
async function refresh(orgId: string, t: StoredTokens): Promise<StoredTokens> {
  const fresh = await acquireToken(orgId)
  const updated: StoredTokens = {
    ...t,
    accessToken: fresh.access_token,
    instanceUrl: fresh.instance_url,
  }
  setOrgTokens(orgId, updated)
  return updated
}

// ---- Salesforce CLI orgs ----

/**
 * Saved orgs plus CLI-authenticated orgs, all directly connectable. CLI orgs
 * are virtual (id `cli:<username>`) and never persisted as saved orgs. If the
 * CLI is unavailable, only saved orgs are returned.
 */
export async function listConnectableOrgs(): Promise<SavedOrgView[]> {
  const active = getActiveOrgId()
  const saved = listOrgs()
  // Usernames already represented by a saved (legacy-imported) cli org, to avoid dupes.
  const savedCliUsers = new Set(saved.filter((o) => o.source === 'cli').map((o) => o.cliUsername))
  let cli: Awaited<ReturnType<typeof listCliOrgsRaw>> = []
  try {
    cli = await listCliOrgsRaw()
  } catch {
    // CLI not installed or no orgs - just return saved orgs.
  }
  const cliViews: SavedOrgView[] = cli
    .filter((o) => !savedCliUsers.has(o.username))
    .map((o) => {
      const id = `${CLI_PREFIX}${o.username}`
      return {
        id,
        name: o.alias || o.username,
        source: 'cli',
        loginUrl: o.instanceUrl,
        cliUsername: o.username,
        hasSecret: false,
        canConnect: true,
        connected: active === id && !!getOrgTokens(id),
      }
    })
  return [...saved, ...cliViews]
}

/** Authenticated REST fetch with one automatic refresh-and-retry on 401. */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const active = requireActive()
  const orgId = active.orgId
  let t = active.tokens
  const doFetch = (tok: StoredTokens) =>
    fetch(new URL(path, tok.instanceUrl), {
      ...init,
      headers: { Authorization: `Bearer ${tok.accessToken}`, ...(init.headers ?? {}) },
    })
  let resp = await doFetch(t)
  if (resp.status === 401) {
    t = await refresh(orgId, t)
    resp = await doFetch(t)
  }
  return resp
}

/** Run a callback against a jsforce Connection, refreshing once on auth failure. */
async function withConnection<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
  const { orgId, tokens } = requireActive()
  try {
    return await fn(connection(tokens))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/INVALID_SESSION_ID|401|session expired|expired access\/refresh token/i.test(msg)) {
      const updated = await refresh(orgId, tokens)
      return fn(connection(updated))
    }
    throw e
  }
}

// ---- Metadata ----

export async function listObjects(): Promise<SObjectInfo[]> {
  return withConnection(async (conn) => {
    const res = await conn.describeGlobal()
    return res.sobjects
      .map((s) => ({ name: s.name, label: s.label }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
}

/** Fields of an sObject, for CSV column mapping. */
export async function describeObject(object: string): Promise<SObjectField[]> {
  return withConnection(async (conn) => {
    const res = await conn.describe(object)
    return res.fields
      .map((f) => ({
        name: f.name,
        label: f.label,
        type: String(f.type),
        createable: f.createable,
        updateable: f.updateable,
        externalId: f.externalId ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
}

// ---- Ingest (insert/update/upsert/delete/hardDelete) ----

export async function submitIngest(req: IngestJobRequest): Promise<JobInfo> {
  return withConnection(async (conn) => {
    const job = conn.bulk2.createJob({
      operation: req.operation,
      object: req.object,
      externalIdFieldName: req.operation === 'upsert' ? req.externalIdFieldName : undefined,
      lineEnding: req.lineEnding,
    })
    await job.open()
    await job.uploadData(req.csv)
    await job.close()
    // Return immediately after upload; the renderer polls the monitor for completion.
    const info = await job.check()
    return toJobInfo(info as unknown as RawJobInfo)
  })
}

/** Download result CSV (successful / failed / unprocessed records) for an ingest job. */
export async function ingestResults(jobId: string, kind: ResultKind): Promise<string> {
  const endpoint = {
    successful: 'successfulResults',
    failed: 'failedResults',
    unprocessed: 'unprocessedrecords',
  }[kind]
  const resp = await apiFetch(`/services/data/v${API_VERSION}/jobs/ingest/${jobId}/${endpoint}/`, {
    headers: { Accept: 'text/csv' },
  })
  if (!resp.ok) throw new Error(`Failed to fetch ${kind} results (${resp.status})`)
  return resp.text()
}

// ---- Query (extract) ----

export async function submitQuery(req: QueryJobRequest): Promise<{ jobId: string; csv: string; rows: number }> {
  return withConnection(async (conn) => {
    const stream = await conn.bulk2.query(req.soql)
    const records = (await stream.toArray()) as Record<string, unknown>[]
    const jobId = (stream as unknown as { job?: { id?: string } }).job?.id ?? ''
    return { jobId, csv: recordsToCsv(records), rows: records.length }
  })
}

// ---- Job monitor (per-job, by id) ----

export async function jobStatus(jobId: string): Promise<JobInfo> {
  // Ingest jobs first; fall back to query jobs.
  let resp = await apiFetch(`/services/data/v${API_VERSION}/jobs/ingest/${jobId}`)
  if (resp.ok) return toJobInfo((await resp.json()) as RawJobInfo)
  resp = await apiFetch(`/services/data/v${API_VERSION}/jobs/query/${jobId}`)
  if (resp.ok) return toJobInfo((await resp.json()) as RawJobInfo, true)
  throw new Error(`Job ${jobId} not found (${resp.status})`)
}

async function patchJobState(jobId: string, state: 'Aborted', isQuery: boolean): Promise<void> {
  const base = isQuery ? 'query' : 'ingest'
  const resp = await apiFetch(`/services/data/v${API_VERSION}/jobs/${base}/${jobId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  })
  if (!resp.ok) throw new Error(`Failed to abort job (${resp.status})`)
}

export async function abortJob(jobId: string): Promise<void> {
  // Try ingest then query.
  try {
    await patchJobState(jobId, 'Aborted', false)
  } catch {
    await patchJobState(jobId, 'Aborted', true)
  }
}


