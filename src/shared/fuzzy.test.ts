import { describe, it, expect } from 'vitest'
import { levenshtein, fuzzyScore, fuzzyThreshold, matchScore, bestMatch } from './fuzzy'

describe('levenshtein', () => {
  it('returns the length when one side is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })
  it('counts single edits', () => {
    expect(levenshtein('cat', 'cat')).toBe(0)
    expect(levenshtein('cat', 'cot')).toBe(1) // substitution
    expect(levenshtein('cat', 'cats')).toBe(1) // insertion
    expect(levenshtein('cats', 'cat')).toBe(1) // deletion
  })
})

describe('fuzzyScore', () => {
  it('is 0 for a substring hit', () => {
    expect(fuzzyScore('count', 'account')).toBe(0)
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
  it('returns the best window edit distance for a near miss', () => {
    expect(fuzzyScore('cont', 'account')).toBe(1) // 'count' window, drop the u
    expect(fuzzyScore('acount', 'account')).toBe(1)
  })
})

describe('matchScore ordering', () => {
  it('ranks exact < prefix < substring < fuzzy', () => {
    const exact = matchScore('contact', 'contact')
    const prefix = matchScore('cont', 'contact')
    const substring = matchScore('contact', 'accountcontact')
    const fuzzy = matchScore('contat', 'contact') // typo, no substring
    expect(exact).toBe(0)
    expect(exact).toBeLessThan(prefix)
    expect(prefix).toBeLessThan(substring)
    expect(substring).toBeLessThan(fuzzy)
  })
  it('prefers shorter texts within the prefix tier', () => {
    expect(matchScore('con', 'contact')).toBeLessThan(matchScore('con', 'contacts_long'))
  })
})

describe('bestMatch', () => {
  it('takes the better of name and label', () => {
    // query matches the label exactly but not the API name
    expect(bestMatch('account name', 'Name', 'account name')).toBe(0)
  })
})

describe('fuzzyThreshold', () => {
  it('scales tolerance with query length', () => {
    expect(fuzzyThreshold(3)).toBe(1)
    expect(fuzzyThreshold(6)).toBe(2)
    expect(fuzzyThreshold(10)).toBe(3)
  })
})
