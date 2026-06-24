import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { shell } from 'electron'
import { postTokenRequest, type TokenResponse } from './oauth'

// The public Salesforce CLI connected app. PKCE web flow, no client secret, with a
// loopback redirect that is registered on this app at the fixed port below. Reusing
// it means a CLI-free login works against any org the `sf` CLI could log into.
const CLIENT_ID = 'PlatformCLI'
const REDIRECT_PORT = 1717
const REDIRECT_PATH = '/OauthRedirect'
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`
// Scopes: `api` for the REST/Bulk calls, `web` for the browser session, `refresh_token`
// so we get a refresh token to persist and re-mint access tokens later.
const SCOPE = 'refresh_token api web'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface Pkce {
  verifier: string
  challenge: string
}

/** RFC 7636 PKCE pair (S256). */
export function generatePkce(): Pkce {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

const DONE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>SFDX Bulker</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1221;color:#e6edf7;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}</style></head>
<body><div><h2>You're signed in.</h2><p>You can close this tab and return to SFDX Bulker.</p></div></body></html>`

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/** Escape a server-supplied message before embedding it in the loopback HTML page. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

function errorHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>SFDX Bulker</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1221;color:#e6edf7;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}</style></head>
<body><div><h2>Login failed</h2><p>${escapeHtml(message)}</p></div></body></html>`
}

interface RedirectHandle {
  /** Resolves with the redirect query params, or rejects on error/timeout/cancel. */
  params: Promise<URLSearchParams>
  /** Tear down the loopback server and reject `params` if it is still pending. */
  cancel: (reason: Error) => void
}

/**
 * Start the one-shot loopback server and wait for the OAuth redirect. Settles exactly
 * once; `cancel()` lets the caller tear it down early (e.g. the browser failed to open).
 */
function awaitRedirect(expectedState: string): RedirectHandle {
  let resolveFn!: (p: URLSearchParams) => void
  let rejectFn!: (e: Error) => void
  let timer: ReturnType<typeof setTimeout>
  let done = false

  /** Settle the promise exactly once and tear the server down. */
  function finish(result: URLSearchParams | null, error: Error | null): void {
    if (done) return
    done = true
    clearTimeout(timer)
    server.close()
    if (error) rejectFn(error)
    else resolveFn(result as URLSearchParams)
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', REDIRECT_URI)
    if (url.pathname !== REDIRECT_PATH) {
      res.writeHead(404).end()
      return
    }
    const params = url.searchParams
    const err = params.get('error')
    const stateOk = params.get('state') === expectedState
    const ok = !err && stateOk && !!params.get('code')
    // Close the socket with the response so `server.close()` completes promptly
    // (no lingering keep-alive connection holding the port open).
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html', Connection: 'close' })
    res.end(ok ? DONE_HTML : errorHtml(params.get('error_description') || err || 'Invalid login response.'))
    if (err) finish(null, new Error(params.get('error_description') || err))
    else if (!stateOk) finish(null, new Error('OAuth state mismatch.'))
    else if (!params.get('code')) finish(null, new Error('No authorization code returned.'))
    else finish(params, null)
  })

  const params = new Promise<URLSearchParams>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
    timer = setTimeout(() => finish(null, new Error('Login timed out. Please try again.')), LOGIN_TIMEOUT_MS)
    server.on('error', (e: NodeJS.ErrnoException) =>
      finish(
        null,
        e.code === 'EADDRINUSE'
          ? new Error(`Port ${REDIRECT_PORT} is in use (another login in progress?). Close it and try again.`)
          : e,
      ),
    )
    server.listen(REDIRECT_PORT, '127.0.0.1')
  })

  return { params, cancel: (reason) => finish(null, reason) }
}

/**
 * Run the OAuth 2.0 Authorization Code + PKCE web login in the system browser and
 * return the resulting tokens (incl. a refresh token). Mirrors `sf org login web`:
 * opens the Salesforce login page, captures the loopback redirect, exchanges the code.
 */
export async function runWebLogin(opts: { instanceUrl: string }): Promise<TokenResponse> {
  const { verifier, challenge } = generatePkce()
  const state = base64url(randomBytes(16))

  const authorize = new URL('/services/oauth2/authorize', opts.instanceUrl)
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: SCOPE,
    state,
  }).toString()

  const handle = awaitRedirect(state)
  // Swallow the redirect promise on the failure path so cancelling it never surfaces
  // as an unhandled rejection (we rethrow the original error below).
  handle.params.catch(() => {})
  try {
    await shell.openExternal(authorize.toString())
  } catch (e) {
    // Browser never launched - don't leave the loopback server bound for 5 minutes.
    handle.cancel(e instanceof Error ? e : new Error('Failed to open the browser.'))
    throw e
  }
  const params = await handle.params

  const token = await postTokenRequest(opts.instanceUrl, {
    grant_type: 'authorization_code',
    code: params.get('code') as string,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })
  if (!token.refresh_token) {
    throw new Error('Login succeeded but no refresh token was returned. Re-try the login.')
  }
  return token
}

export const OAUTH_CLIENT_ID = CLIENT_ID
