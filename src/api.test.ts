// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { unwrap } from './api'

describe('unwrap', () => {
  it('returns the data on a successful result', async () => {
    expect(await unwrap(Promise.resolve({ ok: true, data: 42 }))).toBe(42)
  })

  it('throws the error message on a failed result', async () => {
    await expect(unwrap(Promise.resolve({ ok: false, error: 'boom (500)' }))).rejects.toThrow(
      'boom (500)',
    )
  })

  it('throws a default message when none is given', async () => {
    await expect(unwrap(Promise.resolve({ ok: false }))).rejects.toThrow('Unknown error')
  })
})
