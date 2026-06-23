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

/** Parse a CSV into header columns + data rows (capped), for previewing results. */
export function parseCsvTable(
  content: string,
  maxRows = 200,
): { columns: string[]; rows: string[][]; total: number } {
  const lines = content.split(/\r\n|\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return { columns: [], rows: [], total: 0 }
  const columns = splitCsvLine(lines[0])
  const dataLines = lines.slice(1)
  return {
    columns,
    rows: dataLines.slice(0, maxRows).map(splitCsvLine),
    total: dataLines.length,
  }
}

/** Escape one value for CSV output. */
export function escapeCsvValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
  const lines = [keys.join(',')]
  for (const r of records) lines.push(keys.map((k) => escapeCsvValue(r[k])).join(','))
  return lines.join('\n')
}

/**
 * Rewrite a CSV's columns according to `targets`, aligned to the source columns
 * (index i maps source column i to field name targets[i]; '' drops the column).
 * Output column order follows the kept source columns.
 */
export function remapCsv(content: string, targets: string[]): string {
  const lines = content.split(/\r\n|\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return ''
  const keep = targets.map((t, i) => ({ t: t.trim(), i })).filter((k) => k.t)
  if (keep.length === 0) return ''
  const out = [keep.map((k) => k.t).join(',')]
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r])
    out.push(keep.map((k) => escapeCsvValue(cells[k.i] ?? '')).join(','))
  }
  return out.join('\n')
}
