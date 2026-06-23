import type { ConnectedAppConfig } from '../src/shared/types'

export interface TokenResponse {
  access_token: string
  instance_url: string
  token_type: string
  issued_at?: string
  /** Identity URL - present on some flows. */
  id?: string
}

/**
 * OAuth 2.0 Client Credentials flow (server-to-server, no user interaction).
 * The Connected App must have "Enable Client Credentials Flow" turned on with a
 * Run-As user, and the token endpoint must be the org's My Domain.
 */
export async function requestClientCredentialsToken(
  config: ConnectedAppConfig,
  clientSecret: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: clientSecret,
  })
  const tokenUrl = new URL('/services/oauth2/token', config.loginUrl)
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await resp.json()) as TokenResponse & { error?: string; error_description?: string }
  if (!resp.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? `Token request failed (${resp.status})`)
  }
  return json
}
