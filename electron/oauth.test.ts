import { describe, it, expect, beforeEach, vi } from 'vitest'
import { requestClientCredentialsToken, requestRefreshToken } from './oauth'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function resp(body: unknown, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

beforeEach(() => fetchMock.mockReset())

describe('requestClientCredentialsToken', () => {
  it('POSTs the client_credentials grant to the org token endpoint', async () => {
    fetchMock.mockResolvedValue(resp({ access_token: 'TOK', instance_url: 'https://i', token_type: 'Bearer' }))
    const t = await requestClientCredentialsToken(
      { clientId: 'KEY', loginUrl: 'https://acme.my.salesforce.com' }, 'SECRET',
    )
    expect(t.access_token).toBe('TOK')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://acme.my.salesforce.com/services/oauth2/token')
    const body = (init.body as URLSearchParams)
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_id')).toBe('KEY')
    expect(body.get('client_secret')).toBe('SECRET')
  })
})

describe('requestRefreshToken', () => {
  it('POSTs the refresh_token grant (no secret) and returns the fresh token', async () => {
    fetchMock.mockResolvedValue(resp({ access_token: 'TOK2', instance_url: 'https://i', token_type: 'Bearer' }))
    const t = await requestRefreshToken('https://i.example.com', 'PlatformCLI', 'RT')
    expect(t.access_token).toBe('TOK2')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://i.example.com/services/oauth2/token')
    const body = (init.body as URLSearchParams)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('client_id')).toBe('PlatformCLI')
    expect(body.get('refresh_token')).toBe('RT')
    expect(body.has('client_secret')).toBe(false)
  })

  it('throws the Salesforce error_description on failure', async () => {
    fetchMock.mockResolvedValue(
      resp({ error: 'invalid_grant', error_description: 'expired access/refresh token' }, { ok: false, status: 400 }),
    )
    await expect(requestRefreshToken('https://i', 'PlatformCLI', 'RT')).rejects.toThrow(
      'expired access/refresh token',
    )
  })
})
