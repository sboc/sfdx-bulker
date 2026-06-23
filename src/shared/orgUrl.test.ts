import { describe, it, expect } from 'vitest'
import { LOGIN_PRESETS, normalizeDomain, resolveLoginUrl } from './orgUrl'

describe('normalizeDomain', () => {
  it('prepends https:// when missing', () => {
    expect(normalizeDomain('acme.my.salesforce.com')).toBe('https://acme.my.salesforce.com')
  })

  it('keeps an existing scheme', () => {
    expect(normalizeDomain('http://acme.my.salesforce.com')).toBe('http://acme.my.salesforce.com')
  })

  it('strips trailing slashes and whitespace', () => {
    expect(normalizeDomain('  https://acme.my.salesforce.com///  ')).toBe(
      'https://acme.my.salesforce.com',
    )
  })

  it('returns empty string for blank input', () => {
    expect(normalizeDomain('   ')).toBe('')
  })
})

describe('resolveLoginUrl', () => {
  it('returns the preset URL for non-custom modes', () => {
    expect(resolveLoginUrl('production', 'ignored')).toBe(LOGIN_PRESETS.production)
    expect(resolveLoginUrl('sandbox', '')).toBe(LOGIN_PRESETS.sandbox)
  })

  it('normalises the custom domain', () => {
    expect(resolveLoginUrl('custom', 'acme.my.salesforce.com/')).toBe(
      'https://acme.my.salesforce.com',
    )
  })
})
