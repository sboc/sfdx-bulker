import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { StoredTokens } from './store'

// Shared jsforce Connection stub (created before the module mocks reference it).
const h = vi.hoisted(() => ({
  conn: {
    describeGlobal: vi.fn(),
    describe: vi.fn(),
    bulk2: { createJob: vi.fn(), query: vi.fn() },
  },
}))

vi.mock('jsforce', () => ({ default: { Connection: vi.fn(() => h.conn) } }))
vi.mock('./oauth', () => ({ requestClientCredentialsToken: vi.fn(), requestRefreshToken: vi.fn() }))
vi.mock('./sfcli', () => ({ getCliOrgAuth: vi.fn(), listCliOrgs: vi.fn() }))
vi.mock('./web-oauth', () => ({ runWebLogin: vi.fn(), OAUTH_CLIENT_ID: 'PlatformCLI' }))
vi.mock('./store', () => ({
  getActiveOrgId: vi.fn(),
  getOrg: vi.fn(),
  getOrgSecret: vi.fn(),
  getOrgRefreshToken: vi.fn(),
  getOrgTokens: vi.fn(),
  clearAllOrgTokens: vi.fn(),
  listOrgs: vi.fn(),
  saveOAuthOrg: vi.fn(),
  setActiveOrgId: vi.fn(),
  setOrgTokens: vi.fn(),
}))

import * as sf from './salesforce'
import * as store from './store'
import * as sfcli from './sfcli'
import { requestClientCredentialsToken, requestRefreshToken } from './oauth'
import { runWebLogin } from './web-oauth'

const TOKENS: StoredTokens = {
  accessToken: 'TOK',
  instanceUrl: 'https://i.example.com',
  username: 'me@x',
  displayName: 'Me',
  organizationId: '00D',
  userId: '005',
}

const IDENTITY = {
  preferred_username: 'me@x',
  name: 'Me',
  organization_id: '00D',
  user_id: '005',
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

/** Build a fetch Response stub. */
function resp(body: unknown, { ok = true, status = 200, csv = '' } = {}) {
  return { ok, status, json: async () => body, text: async () => csv }
}

/** Mark an org as the active, connected one for withConnection/apiFetch. */
function makeActive(id = 'o1', tokens: StoredTokens = TOKENS) {
  vi.mocked(store.getActiveOrgId).mockReturnValue(id)
  vi.mocked(store.getOrgTokens).mockImplementation((x) => (x === id ? tokens : null))
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
})

describe('connect', () => {
  it('client-credentials: gets a token, resolves identity, persists + activates', async () => {
    vi.mocked(store.getOrg).mockReturnValue({
      id: 'o1', name: 'Prod', source: 'client-credentials', loginUrl: 'https://login.salesforce.com', clientId: 'KEY',
    })
    vi.mocked(store.getOrgSecret).mockReturnValue('SECRET')
    vi.mocked(requestClientCredentialsToken).mockResolvedValue({
      access_token: 'TOK', instance_url: 'https://i.example.com', token_type: 'Bearer',
    })
    fetchMock.mockResolvedValue(resp(IDENTITY))

    const identity = await sf.connect('o1')

    expect(requestClientCredentialsToken).toHaveBeenCalledWith(
      { clientId: 'KEY', loginUrl: 'https://login.salesforce.com' }, 'SECRET',
    )
    expect(identity).toEqual({
      instanceUrl: 'https://i.example.com', username: 'me@x', displayName: 'Me', organizationId: '00D', userId: '005',
    })
    expect(store.setOrgTokens).toHaveBeenCalledWith('o1', expect.objectContaining({ accessToken: 'TOK' }))
    expect(store.setActiveOrgId).toHaveBeenCalledWith('o1')
    // identity came from the userinfo endpoint
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/oauth2/userinfo')
  })

  it('cli virtual org: acquires token from the CLI, never touches getOrg/secret', async () => {
    vi.mocked(sfcli.getCliOrgAuth).mockResolvedValue({ accessToken: 'CTOK', instanceUrl: 'https://i.example.com' })
    fetchMock.mockResolvedValue(resp(IDENTITY))

    const identity = await sf.connect('cli:me@x')

    expect(sfcli.getCliOrgAuth).toHaveBeenCalledWith('me@x')
    expect(store.getOrg).not.toHaveBeenCalled()
    expect(store.setActiveOrgId).toHaveBeenCalledWith('cli:me@x')
    expect(identity.username).toBe('me@x')
  })

  it('throws when a client-credentials org has no secret', async () => {
    vi.mocked(store.getOrg).mockReturnValue({
      id: 'o1', name: 'P', source: 'client-credentials', loginUrl: 'https://p', clientId: 'K',
    })
    vi.mocked(store.getOrgSecret).mockReturnValue(null)
    await expect(sf.connect('o1')).rejects.toThrow(/no consumer secret/i)
  })
})

describe('loginWeb (CLI-free browser OAuth)', () => {
  it('runs the web flow, persists the org with its refresh token, and activates it', async () => {
    vi.mocked(runWebLogin).mockResolvedValue({
      access_token: 'TOK', instance_url: 'https://i.example.com', token_type: 'Bearer', refresh_token: 'RT',
    })
    vi.mocked(store.saveOAuthOrg).mockReturnValue('oauth-1')
    fetchMock.mockResolvedValue(resp(IDENTITY))

    const identity = await sf.loginWeb({ alias: 'prod', instanceUrl: 'https://login.salesforce.com' })

    expect(runWebLogin).toHaveBeenCalledWith({ instanceUrl: 'https://login.salesforce.com' })
    // Org is keyed by the real instance URL (not the login host) so refresh hits the right endpoint.
    expect(store.saveOAuthOrg).toHaveBeenCalledWith({
      name: 'prod', loginUrl: 'https://i.example.com', clientId: 'PlatformCLI', refreshToken: 'RT',
    })
    expect(store.setOrgTokens).toHaveBeenCalledWith('oauth-1', expect.objectContaining({ accessToken: 'TOK' }))
    expect(store.setActiveOrgId).toHaveBeenCalledWith('oauth-1')
    expect(identity.username).toBe('me@x')
  })

  it('falls back to the identity username when no alias is given', async () => {
    vi.mocked(runWebLogin).mockResolvedValue({
      access_token: 'TOK', instance_url: 'https://i.example.com', token_type: 'Bearer', refresh_token: 'RT',
    })
    vi.mocked(store.saveOAuthOrg).mockReturnValue('oauth-1')
    fetchMock.mockResolvedValue(resp(IDENTITY))
    await sf.loginWeb({ instanceUrl: 'https://login.salesforce.com' })
    expect(store.saveOAuthOrg).toHaveBeenCalledWith(expect.objectContaining({ name: 'me@x' }))
  })
})

describe('acquireToken: oauth org', () => {
  it('refreshes via the refresh_token grant on a 401 and retries', async () => {
    makeActive()
    vi.mocked(store.getOrg).mockReturnValue({
      id: 'o1', name: 'Acme', source: 'oauth', loginUrl: 'https://i.example.com', clientId: 'PlatformCLI',
    })
    vi.mocked(store.getOrgRefreshToken).mockReturnValue('RT')
    vi.mocked(requestRefreshToken).mockResolvedValue({
      access_token: 'TOK2', instance_url: 'https://i.example.com', token_type: 'Bearer',
    })
    fetchMock
      .mockResolvedValueOnce(resp({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(resp({ id: '750a', object: 'A', operation: 'insert', state: 'JobComplete', createdDate: 'd' }))

    const info = await sf.jobStatus('750a')
    expect(info.id).toBe('750a')
    expect(requestRefreshToken).toHaveBeenCalledWith('https://i.example.com', 'PlatformCLI', 'RT')
    expect(store.setOrgTokens).toHaveBeenCalledWith('o1', expect.objectContaining({ accessToken: 'TOK2' }))
  })

  it('throws when the oauth org has no stored refresh token', async () => {
    vi.mocked(store.getOrg).mockReturnValue({
      id: 'o1', name: 'Acme', source: 'oauth', loginUrl: 'https://i', clientId: 'PlatformCLI',
    })
    vi.mocked(store.getOrgRefreshToken).mockReturnValue(null)
    await expect(sf.connect('o1')).rejects.toThrow(/no stored refresh token/i)
  })
})

describe('currentIdentity / disconnect / forgetCliSession', () => {
  it('returns the active org identity', () => {
    makeActive()
    expect(sf.currentIdentity()).toEqual({
      instanceUrl: 'https://i.example.com', username: 'me@x', displayName: 'Me', organizationId: '00D', userId: '005',
    })
  })

  it('returns null when nothing is active', () => {
    vi.mocked(store.getActiveOrgId).mockReturnValue(null)
    expect(sf.currentIdentity()).toBeNull()
  })

  it('disconnect clears the active org tokens + pointer', () => {
    vi.mocked(store.getActiveOrgId).mockReturnValue('o1')
    sf.disconnect()
    expect(store.setOrgTokens).toHaveBeenCalledWith('o1', null)
    expect(store.setActiveOrgId).toHaveBeenCalledWith(null)
  })

  it('forgetCliSession clears the cli token and active id when it is active', () => {
    vi.mocked(store.getActiveOrgId).mockReturnValue('cli:me@x')
    sf.forgetCliSession('me@x')
    expect(store.setOrgTokens).toHaveBeenCalledWith('cli:me@x', null)
    expect(store.setActiveOrgId).toHaveBeenCalledWith(null)
  })

  it('forgetCliSession leaves the active id alone when a different org is active', () => {
    vi.mocked(store.getActiveOrgId).mockReturnValue('o1')
    sf.forgetCliSession('me@x')
    expect(store.setOrgTokens).toHaveBeenCalledWith('cli:me@x', null)
    expect(store.setActiveOrgId).not.toHaveBeenCalled()
  })

  it('disconnectAll clears every org token and the active pointer', () => {
    sf.disconnectAll()
    expect(store.clearAllOrgTokens).toHaveBeenCalled()
    expect(store.setActiveOrgId).toHaveBeenCalledWith(null)
  })
})

describe('listConnectableOrgs', () => {
  it('merges saved orgs with CLI orgs and flags the connected one', async () => {
    vi.mocked(store.getActiveOrgId).mockReturnValue('cli:prod@x')
    vi.mocked(store.getOrgTokens).mockImplementation((id) => (id === 'cli:prod@x' ? TOKENS : null))
    vi.mocked(store.listOrgs).mockReturnValue([
      { id: 'o1', name: 'CC', source: 'client-credentials', loginUrl: 'https://p', clientId: 'K', hasSecret: true, canConnect: true, connected: false },
    ])
    vi.mocked(sfcli.listCliOrgs).mockResolvedValue([
      { username: 'prod@x', alias: 'prod', instanceUrl: 'https://p.my', orgId: '00D' },
    ])

    const orgs = await sf.listConnectableOrgs()
    expect(orgs.map((o) => o.id)).toEqual(['o1', 'cli:prod@x'])
    const cli = orgs.find((o) => o.id === 'cli:prod@x')!
    expect(cli).toMatchObject({ name: 'prod', source: 'cli', canConnect: true, connected: true })
  })

  it('dedupes a CLI org already saved under that username', async () => {
    vi.mocked(store.getActiveOrgId).mockReturnValue(null)
    vi.mocked(store.getOrgTokens).mockReturnValue(null)
    vi.mocked(store.listOrgs).mockReturnValue([
      { id: 's1', name: 'saved', source: 'cli', cliUsername: 'prod@x', loginUrl: 'https://p', hasSecret: false, canConnect: true, connected: false },
    ])
    vi.mocked(sfcli.listCliOrgs).mockResolvedValue([
      { username: 'prod@x', alias: 'prod', instanceUrl: 'https://p', orgId: '00D' },
    ])
    const orgs = await sf.listConnectableOrgs()
    expect(orgs).toHaveLength(1)
    expect(orgs[0].id).toBe('s1')
  })

  it('falls back to saved orgs only when the CLI is unavailable', async () => {
    vi.mocked(store.getActiveOrgId).mockReturnValue(null)
    vi.mocked(store.getOrgTokens).mockReturnValue(null)
    vi.mocked(store.listOrgs).mockReturnValue([
      { id: 'o1', name: 'CC', source: 'client-credentials', loginUrl: 'https://p', clientId: 'K', hasSecret: true, canConnect: true, connected: false },
    ])
    vi.mocked(sfcli.listCliOrgs).mockRejectedValue(new Error('sf not found'))
    const orgs = await sf.listConnectableOrgs()
    expect(orgs.map((o) => o.id)).toEqual(['o1'])
  })
})

describe('listObjects', () => {
  it('returns sObjects sorted by API name', async () => {
    makeActive()
    h.conn.describeGlobal.mockResolvedValue({
      sobjects: [
        { name: 'Contact', label: 'Contact' },
        { name: 'Account', label: 'Account' },
      ],
    })
    expect(await sf.listObjects()).toEqual([
      { name: 'Account', label: 'Account' },
      { name: 'Contact', label: 'Contact' },
    ])
  })
})

describe('describeObject', () => {
  it('maps + sorts fields by API name', async () => {
    makeActive()
    h.conn.describe.mockResolvedValue({
      fields: [
        { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
        { name: 'Ext__c', label: 'Ext', type: 'string', createable: true, updateable: true, externalId: true },
      ],
    })
    const fields = await sf.describeObject('Account')
    expect(fields.map((f) => f.name)).toEqual(['Ext__c', 'Name'])
    expect(fields[0]).toMatchObject({ name: 'Ext__c', externalId: true })
  })
})

describe('ingest', () => {
  it('submitIngest opens, uploads, closes and returns mapped job info', async () => {
    makeActive()
    const job = {
      open: vi.fn().mockResolvedValue(undefined),
      uploadData: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue({
        id: '750a', object: 'Account', operation: 'insert', state: 'UploadComplete', createdDate: 'd',
      }),
    }
    h.conn.bulk2.createJob.mockReturnValue(job)

    const info = await sf.submitIngest({ object: 'Account', operation: 'insert', csv: 'Id\n1', lineEnding: 'LF' })

    expect(h.conn.bulk2.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ object: 'Account', operation: 'insert', lineEnding: 'LF' }),
    )
    expect(job.uploadData).toHaveBeenCalledWith('Id\n1')
    expect(info).toMatchObject({ id: '750a', state: 'UploadComplete', isQuery: false })
  })

  it('submitIngest passes externalIdFieldName only for upsert', async () => {
    makeActive()
    const job = {
      open: vi.fn().mockResolvedValue(undefined), uploadData: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue({ id: 'x', object: 'A', operation: 'upsert', state: 'Open', createdDate: 'd' }),
    }
    h.conn.bulk2.createJob.mockReturnValue(job)
    await sf.submitIngest({ object: 'A', operation: 'upsert', externalIdFieldName: 'Ext__c', csv: 'x', lineEnding: 'LF' })
    expect(h.conn.bulk2.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'upsert', externalIdFieldName: 'Ext__c' }),
    )
  })

  it('ingestResults fetches the CSV for the given result kind', async () => {
    makeActive()
    fetchMock.mockResolvedValue(resp(null, { csv: 'sf__Id,Name\n001,Acme' }))
    const csv = await sf.ingestResults('750a', 'failed')
    expect(csv).toBe('sf__Id,Name\n001,Acme')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/jobs/ingest/750a/failedResults/')
  })
})

describe('submitQuery', () => {
  it('runs the bulk query and serialises records to CSV', async () => {
    makeActive()
    h.conn.bulk2.query.mockResolvedValue({
      toArray: async () => [{ Id: '1', Name: 'Acme' }, { Id: '2', Name: 'Globex' }],
      job: { id: '750q' },
    })
    const r = await sf.submitQuery({ soql: 'SELECT Id, Name FROM Account' })
    expect(r).toEqual({ jobId: '750q', rows: 2, csv: 'Id,Name\n1,Acme\n2,Globex' })
  })
})

describe('job monitor', () => {
  it('jobStatus reads a job by id', async () => {
    makeActive()
    fetchMock.mockImplementation(async (url: URL) => {
      const u = String(url)
      if (u.includes('/jobs/ingest/750a'))
        return resp({ id: '750a', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: 'd', numberRecordsProcessed: 100, numberRecordsFailed: 2 })
      return resp({}, { ok: false, status: 404 })
    })
    expect(await sf.jobStatus('750a')).toMatchObject({ id: '750a', numberRecordsProcessed: 100, isQuery: false })
  })

  it('jobStatus falls back from ingest to query', async () => {
    makeActive()
    fetchMock.mockImplementation(async (url: URL) => {
      const u = String(url)
      if (u.includes('/jobs/ingest/750q')) return resp({}, { ok: false, status: 404 })
      if (u.includes('/jobs/query/750q')) return resp({ id: '750q', object: 'Contact', operation: 'query', state: 'JobComplete', createdDate: 'd' })
      return resp({}, { ok: false, status: 404 })
    })
    expect(await sf.jobStatus('750q')).toMatchObject({ id: '750q', isQuery: true })
  })

  it('abortJob PATCHes the ingest job to Aborted', async () => {
    makeActive()
    fetchMock.mockResolvedValue(resp({}))
    await sf.abortJob('750a')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/jobs/ingest/750a')
    expect(init).toMatchObject({ method: 'PATCH' })
    expect(JSON.parse(init.body)).toEqual({ state: 'Aborted' })
  })

})

describe('listAllJobs', () => {
  it('pages through ingest + query jobs, flags query rows, sorts newest first', async () => {
    makeActive()
    fetchMock.mockImplementation(async (url: URL) => {
      const u = String(url)
      // ingest: two pages (nextRecordsUrl then done)
      if (u.endsWith('/jobs/ingest'))
        return resp({
          done: false,
          nextRecordsUrl: '/services/data/v62.0/jobs/ingest?locator=B',
          records: [{ id: 'i1', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: '2026-01-02' }],
        })
      if (u.includes('/jobs/ingest?locator=B'))
        return resp({
          done: true,
          records: [{ id: 'i2', object: 'Contact', operation: 'update', state: 'InProgress', createdDate: '2026-01-04' }],
        })
      // query: single page
      if (u.endsWith('/jobs/query'))
        return resp({
          done: true,
          records: [{ id: 'q1', object: 'Lead', operation: 'query', state: 'JobComplete', createdDate: '2026-01-03' }],
        })
      return resp({}, { ok: false, status: 404 })
    })

    const jobs = await sf.listAllJobs()

    // newest first: i2 (01-04) > q1 (01-03) > i1 (01-02)
    expect(jobs.map((j) => j.id)).toEqual(['i2', 'q1', 'i1'])
    expect(jobs.find((j) => j.id === 'q1')).toMatchObject({ isQuery: true })
    expect(jobs.find((j) => j.id === 'i1')).toMatchObject({ isQuery: false })
    // ingest fetched twice (paginated) + query once
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws when a job list request fails', async () => {
    makeActive()
    fetchMock.mockResolvedValue(resp({}, { ok: false, status: 500 }))
    await expect(sf.listAllJobs()).rejects.toThrow(/Failed to list .* jobs \(500\)/)
  })
})

describe('apiFetch auth retry', () => {
  it('refreshes the token once on 401 and retries', async () => {
    makeActive()
    vi.mocked(store.getOrg).mockReturnValue({
      id: 'o1', name: 'P', source: 'client-credentials', loginUrl: 'https://p', clientId: 'K',
    })
    vi.mocked(store.getOrgSecret).mockReturnValue('S')
    vi.mocked(requestClientCredentialsToken).mockResolvedValue({
      access_token: 'TOK2', instance_url: 'https://i.example.com', token_type: 'Bearer',
    })
    fetchMock
      .mockResolvedValueOnce(resp({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(resp({ id: '750a', object: 'A', operation: 'insert', state: 'JobComplete', createdDate: 'd' }))

    const info = await sf.jobStatus('750a')
    expect(info.id).toBe('750a')
    expect(requestClientCredentialsToken).toHaveBeenCalledTimes(1) // refreshed
    expect(store.setOrgTokens).toHaveBeenCalledWith('o1', expect.objectContaining({ accessToken: 'TOK2' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
