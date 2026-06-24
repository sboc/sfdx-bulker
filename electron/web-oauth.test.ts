import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { get } from 'node:http'

// Mock electron's shell - openExternal is where we simulate the browser completing
// (or failing) the login by calling back into the loopback redirect server.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

import { shell } from 'electron'
import { generatePkce, runWebLogin } from './web-oauth'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Fire a GET at the loopback redirect, retrying until the server is bound. */
function hitRedirect(query: Record<string, string>, attempt = 0): void {
  const qs = new URLSearchParams(query).toString()
  const req = get(`http://127.0.0.1:1717/OauthRedirect?${qs}`, (res) => res.resume())
  req.on('error', () => {
    if (attempt < 50) setTimeout(() => hitRedirect(query, attempt + 1), 20)
  })
}

/** Make openExternal echo back a redirect carrying the given params + the real state. */
function redirectWith(make: (state: string) => Record<string, string>): void {
  vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
    const state = new URL(url).searchParams.get('state') as string
    hitRedirect(make(state))
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(shell.openExternal).mockReset()
})
// The loopback server closes asynchronously after each login; with fetch mocked the
// promise resolves almost instantly, so let port 1717 free before the next test binds.
afterEach(async () => {
  vi.clearAllMocks()
  await new Promise((r) => setTimeout(r, 100))
})

describe('generatePkce', () => {
  it('derives an S256 challenge from the verifier', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/) // base64url, no padding
    expect(challenge).toBe(b64url(createHash('sha256').update(verifier).digest()))
  })

  it('produces a fresh verifier each call', () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier)
  })
})

describe('runWebLogin', () => {
  it('opens the browser, captures the code, exchanges it, and returns tokens', async () => {
    redirectWith((state) => ({ code: 'AUTHCODE', state }))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'TOK', instance_url: 'https://i.example.com', token_type: 'Bearer', refresh_token: 'RT',
      }),
    })

    const token = await runWebLogin({ instanceUrl: 'https://login.salesforce.com' })

    expect(token).toMatchObject({ access_token: 'TOK', refresh_token: 'RT' })
    // Authorize URL: PKCE S256 + public client + loopback redirect.
    const authorizeUrl = new URL(vi.mocked(shell.openExternal).mock.calls[0][0])
    expect(authorizeUrl.pathname).toBe('/services/oauth2/authorize')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('PlatformCLI')
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('http://localhost:1717/OauthRedirect')
    // Code exchanged with the matching verifier.
    const [tokenUrl, init] = fetchMock.mock.calls[0]
    expect(String(tokenUrl)).toBe('https://login.salesforce.com/services/oauth2/token')
    const body = init.body as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('AUTHCODE')
    expect(body.get('code_verifier')).toBeTruthy()
  })

  it('rejects when the redirect carries an OAuth error', async () => {
    redirectWith(() => ({ error: 'access_denied', error_description: 'user said no' }))
    await expect(runWebLogin({ instanceUrl: 'https://login.salesforce.com' })).rejects.toThrow('user said no')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects on a state mismatch (CSRF guard)', async () => {
    redirectWith(() => ({ code: 'AUTHCODE', state: 'WRONG' }))
    await expect(runWebLogin({ instanceUrl: 'https://login.salesforce.com' })).rejects.toThrow(/state mismatch/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects when the exchange returns no refresh token', async () => {
    redirectWith((state) => ({ code: 'AUTHCODE', state }))
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ access_token: 'TOK', instance_url: 'https://i', token_type: 'Bearer' }),
    })
    await expect(runWebLogin({ instanceUrl: 'https://login.salesforce.com' })).rejects.toThrow(/no refresh token/i)
  })

  it('frees the loopback port when the browser fails to open', async () => {
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('no browser'))
    await expect(runWebLogin({ instanceUrl: 'https://login.salesforce.com' })).rejects.toThrow('no browser')
    // Port must be released - a follow-up login binds 1717 and completes.
    redirectWith((state) => ({ code: 'AUTHCODE', state }))
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ access_token: 'TOK', instance_url: 'https://i', token_type: 'Bearer', refresh_token: 'RT' }),
    })
    await expect(runWebLogin({ instanceUrl: 'https://login.salesforce.com' })).resolves.toMatchObject({
      refresh_token: 'RT',
    })
  })
})
