import { describe, it, expect } from 'vitest'
import { recordsToCsv, parseCsvPreview, splitCsvLine, remapCsv } from './csv'

describe('splitCsvLine', () => {
  it('splits simple fields', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('keeps commas inside quoted fields', () => {
    expect(splitCsvLine('"a,b",c')).toEqual(['a,b', 'c'])
  })

  it('unescapes doubled quotes', () => {
    expect(splitCsvLine('"she said ""hi""",x')).toEqual(['she said "hi"', 'x'])
  })

  it('handles trailing empty field', () => {
    expect(splitCsvLine('a,')).toEqual(['a', ''])
  })
})

describe('parseCsvPreview', () => {
  it('returns null for empty/undefined input', () => {
    expect(parseCsvPreview(undefined)).toBeNull()
    expect(parseCsvPreview('')).toBeNull()
  })

  it('counts rows excluding the header and parses columns', () => {
    const csv = 'Id,Name\n001,Acme\n002,Globex'
    expect(parseCsvPreview(csv)).toEqual({ rows: 2, columns: ['Id', 'Name'] })
  })

  it('ignores blank lines and handles CRLF', () => {
    const csv = 'Id,Name\r\n001,Acme\r\n\r\n'
    expect(parseCsvPreview(csv)).toEqual({ rows: 1, columns: ['Id', 'Name'] })
  })

  it('parses a header with quoted commas', () => {
    expect(parseCsvPreview('"Last, First",Age')?.columns).toEqual(['Last, First', 'Age'])
  })
})

describe('recordsToCsv', () => {
  it('returns empty string for no records', () => {
    expect(recordsToCsv([])).toBe('')
  })

  it('builds header from the union of keys', () => {
    const csv = recordsToCsv([{ a: 1 }, { b: 2 }])
    expect(csv.split('\n')[0]).toBe('a,b')
    expect(csv).toBe('a,b\n1,\n,2')
  })

  it('drops the jsforce attributes key', () => {
    const csv = recordsToCsv([{ attributes: { type: 'Account' }, Id: '001', Name: 'Acme' }])
    expect(csv).toBe('Id,Name\n001,Acme')
  })

  it('escapes commas, quotes and newlines', () => {
    const csv = recordsToCsv([{ v: 'a,b' }, { v: 'say "hi"' }, { v: 'line1\nline2' }])
    expect(csv).toBe('v\n"a,b"\n"say ""hi"""\n"line1\nline2"')
  })

  it('renders null/undefined as empty and serialises nested objects', () => {
    expect(recordsToCsv([{ a: null, b: undefined, c: { x: 1 } }])).toBe('a,b,c\n,,"{""x"":1}"')
  })
})

describe('remapCsv', () => {
  it('renames headers and drops ignored columns', () => {
    const csv = 'Name,Email,Junk\nAcme,a@x.com,zzz\nGlobex,g@x.com,yyy'
    // source cols: Name->Name, Email->Email__c, Junk-> (dropped)
    expect(remapCsv(csv, ['Name', 'Email__c', ''])).toBe(
      'Name,Email__c\nAcme,a@x.com\nGlobex,g@x.com',
    )
  })

  it('reorders output to follow kept source columns and re-escapes', () => {
    const csv = '"Last, First",Age\n"Doe, Jane",30'
    expect(remapCsv(csv, ['Name', 'Age__c'])).toBe('Name,Age__c\n"Doe, Jane",30')
  })

  it('pads missing trailing cells with empty values', () => {
    const csv = 'A,B\n1'
    expect(remapCsv(csv, ['X', 'Y'])).toBe('X,Y\n1,')
  })

  it('returns empty string when nothing is mapped', () => {
    expect(remapCsv('A,B\n1,2', ['', ''])).toBe('')
    expect(remapCsv('', ['X'])).toBe('')
  })
})
