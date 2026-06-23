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
vi.mock('./oauth', () => ({ requestClientCredentialsToken: vi.fn() }))
vi.mock('./sfcli', () => ({ getCliOrgAuth: vi.fn(), listCliOrgs: vi.fn() }))
vi.mock('./store', () => ({
  getActiveOrgId: vi.fn(),
  getOrg: vi.fn(),
  getOrgSecret: vi.fn(),
  getOrgTokens: vi.fn(),
  listOrgs: vi.fn(),
  setActiveOrgId: vi.fn(),
  setOrgTokens: vi.fn(),
}))

import * as sf from './salesforce'
import * as store from './store'
import * as sfcli from './sfcli'
import { requestClientCredentialsToken } from './oauth'

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
  function routeJobs() {
    fetchMock.mockImplementation(async (url: URL) => {
      const u = String(url)
      if (u.endsWith('/jobs/ingest/')) return resp({ records: [{ id: '750a', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: '2026-06-23' }] })
      if (u.endsWith('/jobs/query/')) return resp({ records: [{ id: '750q', object: 'Contact', operation: 'query', state: 'JobComplete', createdDate: '2026-06-22' }] })
      if (u.includes('/jobs/ingest/750a')) return resp({ id: '750a', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: '2026-06-23', numberRecordsProcessed: 100, numberRecordsFailed: 2 })
      if (u.includes('/jobs/query/750q')) return resp({ id: '750q', object: 'Contact', operation: 'query', state: 'JobComplete', createdDate: '2026-06-22', numberRecordsProcessed: 50 })
      return resp({}, { ok: false, status: 404 })
    })
  }

  it('listJobs merges ingest + query and enriches with record counts', async () => {
    makeActive()
    routeJobs()
    const jobs = await sf.listJobs()
    expect(jobs.map((j) => j.id)).toEqual(['750a', '750q']) // sorted newest-first
    expect(jobs[0]).toMatchObject({ numberRecordsProcessed: 100, numberRecordsFailed: 2, isQuery: false })
    expect(jobs[1]).toMatchObject({ numberRecordsProcessed: 50, isQuery: true })
  })

  it('paginates through all job pages via nextRecordsUrl', async () => {
    makeActive()
    fetchMock.mockImplementation(async (url: URL) => {
      const u = String(url)
      if (u.endsWith('/jobs/ingest/'))
        return resp({
          records: [{ id: 'old1', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: '2026-06-01' }],
          done: false,
          nextRecordsUrl: '/services/data/v62.0/jobs/ingest/?locator=L2',
        })
      if (u.includes('jobs/ingest/?locator=L2'))
        return resp({
          records: [{ id: '750new', object: 'Account', operation: 'insert', state: 'UploadComplete', createdDate: '2026-06-23' }],
          done: true,
        })
      if (u.endsWith('/jobs/query/')) return resp({ records: [], done: true })
      if (u.includes('/jobs/ingest/750new')) return resp({ id: '750new', object: 'Account', operation: 'insert', state: 'UploadComplete', createdDate: '2026-06-23', numberRecordsProcessed: 5 })
      if (u.includes('/jobs/ingest/old1')) return resp({ id: 'old1', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: '2026-06-01', numberRecordsProcessed: 1 })
      return resp({}, { ok: false, status: 404 })
    })
    const jobs = await sf.listJobs()
    // The recent job lives on page 2; it must be fetched and sorted to the top.
    expect(jobs.map((j) => j.id)).toEqual(['750new', 'old1'])
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

  it('deleteJob DELETEs the ingest job', async () => {
    makeActive()
    fetchMock.mockResolvedValue(resp({}))
    await sf.deleteJob('750a')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
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
