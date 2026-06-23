import { describe, it, expect } from 'vitest'
import { toJobInfo, type RawJobInfo } from './transform'

const raw: RawJobInfo = {
  id: '750xx',
  object: 'Account',
  operation: 'insert',
  state: 'JobComplete',
  createdDate: '2026-06-23T00:00:00.000Z',
  numberRecordsProcessed: 100,
  numberRecordsFailed: 2,
}

describe('toJobInfo', () => {
  it('maps all fields and defaults isQuery to false', () => {
    expect(toJobInfo(raw)).toEqual({ ...raw, isQuery: false })
  })

  it('flags query jobs when requested', () => {
    expect(toJobInfo(raw, true).isQuery).toBe(true)
  })

  it('preserves undefined counts', () => {
    const r: RawJobInfo = {
      id: '1',
      object: 'Contact',
      operation: 'query',
      state: 'InProgress',
      createdDate: 'x',
    }
    const info = toJobInfo(r, true)
    expect(info.numberRecordsProcessed).toBeUndefined()
    expect(info.numberRecordsFailed).toBeUndefined()
  })
})
