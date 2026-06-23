// Pure CSV helpers shared by the renderer (preview) and main process (export).

/** Split one CSV line into fields, honouring quoted fields and escaped quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') inQuotes = false
      else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** Header columns + row count for a CSV string, or null if empty. */
export function parseCsvPreview(content?: string): { rows: number; columns: string[] } | null {
  if (!content) return null
  const lines = content.split(/\r\n|\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return null
  return { rows: Math.max(0, lines.length - 1), columns: splitCsvLine(lines[0]) }
}

/** Serialise records to CSV. Keys are the union of all record keys, minus `attributes`. */
export function recordsToCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return ''
  const keys = Array.from(
    records.reduce((set, r) => {
      Object.keys(r).forEach((k) => k !== 'attributes' && set.add(k))
      return set
    }, new Set<string>()),
  )
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [keys.join(',')]
  for (const r of records) lines.push(keys.map((k) => esc(r[k])).join(','))
  return lines.join('\n')
}
