// Pure CSV helpers shared by the renderer (preview) and main process (export).

/** Strip a leading UTF-8 BOM (common in Excel-saved CSVs) so it doesn't leak
 * into the first column name and break header matching. */
const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

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
  const lines = stripBom(content).split(/\r\n|\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return null
  return { rows: Math.max(0, lines.length - 1), columns: splitCsvLine(lines[0]) }
}

/**
 * Combine several CSVs into one. By default (mode 'strict') headers must be
 * identical (same columns, same order - ignoring surrounding whitespace and
 * quoting), and an Error names the first file whose columns differ. With mode
 * 'shared' the result keeps only the columns present in every file (intersection,
 * in the first file's order) and rewrites each file's rows to them. Empty files
 * are skipped; throws if nothing is usable or 'shared' finds no common columns.
 */
export function combineCsvs(
  files: { name: string; content: string }[],
  mode: 'strict' | 'shared' = 'strict',
): { content: string; columns: string[]; rows: number } {
  const dataLinesOf = (content: string) =>
    content.split(/\r\n|\n/).filter((l) => l.length > 0).slice(1)
  const headerOf = (content: string) =>
    splitCsvLine(content.split(/\r\n|\n/).find((l) => l.length > 0) ?? '').map((c) => c.trim())
  const key = (cols: string[]) => JSON.stringify(cols)

  files = files.map((f) => ({ ...f, content: stripBom(f.content) }))
  const usable = files.filter((f) => f.content.split(/\r\n|\n/).some((l) => l.length > 0))
  if (usable.length === 0) throw new Error('No rows found in the selected files.')

  const base = usable[0]
  const baseCols = headerOf(base.content)

  if (mode === 'shared') {
    const others = usable.map((f) => headerOf(f.content))
    const shared = baseCols.filter((c) => others.every((cols) => cols.includes(c)))
    if (shared.length === 0) throw new Error('The selected files share no columns to combine.')
    const out = [shared.map(escapeCsvValue).join(',')]
    let rows = 0
    for (const f of usable) {
      const cols = headerOf(f.content)
      const idx = shared.map((c) => cols.indexOf(c))
      for (const line of dataLinesOf(f.content)) {
        const cells = splitCsvLine(line)
        out.push(idx.map((i) => escapeCsvValue(cells[i] ?? '')).join(','))
        rows++
      }
    }
    return { content: out.join('\n'), columns: shared, rows }
  }

  for (const f of usable.slice(1)) {
    if (key(headerOf(f.content)) !== key(baseCols)) {
      throw new Error(
        `"${f.name}" has different columns (${headerOf(f.content).join(', ')}) than ` +
          `"${base.name}" (${baseCols.join(', ')}). Files must share the same header to combine.`,
      )
    }
  }

  const dataLines = usable.flatMap((f) => dataLinesOf(f.content))
  const headerLine = base.content.split(/\r\n|\n/).find((l) => l.length > 0) ?? ''
  return { content: [headerLine, ...dataLines].join('\n'), columns: baseCols, rows: dataLines.length }
}

/** Parse a CSV into header columns + data rows (capped), for previewing results. */
export function parseCsvTable(
  content: string,
  maxRows = 200,
): { columns: string[]; rows: string[][]; total: number } {
  const lines = stripBom(content).split(/\r\n|\n/).filter((l) => l.length > 0)
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
  const lines = [keys.map(escapeCsvValue).join(',')]
  for (const r of records) lines.push(keys.map((k) => escapeCsvValue(r[k])).join(','))
  return lines.join('\n')
}

/**
 * Rewrite a CSV's columns according to `targets`, aligned to the source columns
 * (index i maps source column i to field name targets[i]; '' drops the column).
 * Output column order follows the kept source columns.
 */
export function remapCsv(content: string, targets: string[]): string {
  const lines = stripBom(content).split(/\r\n|\n/).filter((l) => l.length > 0)
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
