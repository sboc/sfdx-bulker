/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/**
 * Fuzzy score of query against text: 0 for a substring hit, otherwise the
 * smallest edit distance between the query and any same-length-ish window of
 * the text. Lower is better; Infinity means no usable match.
 */
export function fuzzyScore(q: string, text: string): number {
  if (!q) return 0
  if (text.includes(q)) return 0
  const n = q.length
  let best = Infinity
  for (let w = Math.max(1, n - 1); w <= n + 1; w++) {
    for (let i = 0; i + w <= text.length; i++) {
      const d = levenshtein(q, text.slice(i, i + w))
      if (d < best) best = d
      if (best === 0) return 0
    }
  }
  return best
}

export const fuzzyThreshold = (len: number) => (len <= 4 ? 1 : len <= 7 ? 2 : 3)

/**
 * Ranking score of a query against text — lower is better. Tiers:
 *   exact (0) < prefix (1.x) < substring by position (100+) < fuzzy (1000+dist).
 * Within a tier shorter / earlier matches sort first. A score < 1000 means a
 * literal substring hit; >= 1000 means only a fuzzy (edit-distance) match.
 */
export function matchScore(token: string, text: string): number {
  if (!token) return 0
  if (text === token) return 0
  const idx = text.indexOf(token)
  if (idx === 0) return 1 + text.length * 1e-4
  if (idx > 0) return 100 + idx + text.length * 1e-4
  return 1000 + fuzzyScore(token, text)
}

/** Best (lowest) matchScore across name + label. */
export const bestMatch = (token: string, name: string, label: string) =>
  Math.min(matchScore(token, name), matchScore(token, label))
