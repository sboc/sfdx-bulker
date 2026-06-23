// Pure helpers for Salesforce login-host selection.

export const LOGIN_PRESETS = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com',
} as const

export type LoginMode = keyof typeof LOGIN_PRESETS | 'custom'

/** Normalise a My Domain into a full https origin with no trailing slash. */
export function normalizeDomain(input: string): string {
  let v = input.trim().replace(/\/+$/, '')
  if (!v) return ''
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`
  return v
}

/** Which login mode a stored URL corresponds to. */
export function loginModeForUrl(url: string): LoginMode {
  if (url === LOGIN_PRESETS.production) return 'production'
  if (url === LOGIN_PRESETS.sandbox) return 'sandbox'
  return 'custom'
}

/** Resolve the effective login URL for a mode + custom domain input. */
export function resolveLoginUrl(mode: LoginMode, customDomain: string): string {
  return mode === 'custom' ? normalizeDomain(customDomain) : LOGIN_PRESETS[mode]
}
