import type { ConnectedAppConfig } from '../src/shared/types'

export interface TokenResponse {
  access_token: string
  instance_url: string
  token_type: string
  issued_at?: string
  /** Identity URL - present on some flows. */
  id?: string
  /** Present on the authorization-code flow when the `refresh_token` scope is granted. */
  refresh_token?: string
}

/**
 * POST a form-encoded grant to an org's `/services/oauth2/token` endpoint and return
 * the parsed token (throwing the Salesforce error_description on failure). Shared by
 * every OAuth grant flow (client-credentials, refresh, authorization-code).
 */
export async function postTokenRequest(
  origin: string,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const resp = await fetch(new URL('/services/oauth2/token', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const json = (await resp.json()) as TokenResponse & { error?: string; error_description?: string }
  if (!resp.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? `Token request failed (${resp.status})`)
  }
  return json
}

/**
 * OAuth 2.0 Client Credentials flow (server-to-server, no user interaction).
 * The Connected App must have "Enable Client Credentials Flow" turned on with a
 * Run-As user, and the token endpoint must be the org's My Domain.
 */
export function requestClientCredentialsToken(
  config: ConnectedAppConfig,
  clientSecret: string,
): Promise<TokenResponse> {
  return postTokenRequest(config.loginUrl, {
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: clientSecret,
  })
}

/**
 * OAuth 2.0 Refresh Token flow. Mints a fresh access token from a stored refresh
 * token. Used by `oauth`-source orgs (PKCE web login); the public client sends no
 * secret. `origin` is the org's My Domain / instance origin.
 */
export function requestRefreshToken(
  origin: string,
  clientId: string,
  refreshToken: string,
): Promise<TokenResponse> {
  return postTokenRequest(origin, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  })
}
