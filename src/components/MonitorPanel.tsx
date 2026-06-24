import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, unwrap } from '../api'
import { escapeCsvValue, parseCsvTable, splitCsvLine } from '../shared/csv'
import type { BulkOperation, JobInfo, ResultKind, SObjectField } from '../shared/types'

const ACTIVE = new Set(['Open', 'UploadComplete', 'InProgress'])

interface Props {
  jobs: JobInfo[]
  onTrack: (job: JobInfo) => void
  onDismiss: (id: string) => void
}

interface Viewing {
  jobId: string
  object: string
  operation: string
  kind: ResultKind
  loading: boolean
  error?: string
  csv?: string
  table?: { columns: string[]; rows: string[][]; total: number }
}

export function MonitorPanel({ jobs, onTrack, onDismiss }: Props) {
  const [statuses, setStatuses] = useState<Record<string, JobInfo>>({})
  const [auto, setAuto] = useState(true)
  const [loading, setLoading] = useState(false)
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const [idInput, setIdInput] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  async function queryById() {
    const id = idInput.trim()
    if (!id) return
    setLookupError(null)
    setLookupBusy(true)
    try {
      onTrack(await unwrap(api.jobs.status(id)))
      setIdInput('')
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e))
    } finally {
      setLookupBusy(false)
    }
  }

  const refresh = useCallback(async () => {
    if (jobs.length === 0) return
    setLoading(true)
    const results = await Promise.all(
      jobs.map(async (j) => {
        try {
          return await unwrap(api.jobs.status(j.id))
        } catch {
          return null
        }
      }),
    )
    setStatuses((prev) => {
      const next = { ...prev }
      results.forEach((r, i) => {
        if (r) next[jobs[i].id] = r
      })
      return next
    })
    setLoading(false)
  }, [jobs])

  useEffect(() => {
    const kick = setTimeout(refresh, 0)
    const poll = auto ? setInterval(refresh, 4000) : undefined
    return () => {
      clearTimeout(kick)
      if (poll) clearInterval(poll)
    }
  }, [auto, refresh])

  async function view(job: JobInfo, kind: ResultKind) {
    const base = { jobId: job.id, object: job.object, operation: job.operation, kind }
    setViewing({ ...base, loading: true })
    try {
      const csv = await unwrap(api.ingest.results(job.id, kind))
      setViewing({ ...base, loading: false, csv, table: parseCsvTable(csv) })
    } catch (e) {
      setViewing({ ...base, loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <button className="btn ghost" onClick={refresh} disabled={loading || jobs.length === 0}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
        </label>
        <span className="toolbar-sep" />
        <input
          className="filter"
          aria-label="Look up a job by id"
          placeholder="Job id to query…"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && queryById()}
        />
        <button className="btn ghost" onClick={queryById} disabled={lookupBusy || !idInput.trim()}>
          {lookupBusy ? 'Querying…' : 'Query'}
        </button>
      </div>

      {lookupError && <div className="banner error">{lookupError}</div>}

      <div className="table">
        <div className="tr th">
          <span>Job</span>
          <span>Object</span>
          <span>Operation</span>
          <span>State</span>
          <span>Processed</span>
          <span>Failed</span>
          <span>Actions</span>
        </div>
        {jobs.length === 0 && (
          <div className="tr empty-row">No jobs yet. Submit a job from the Load tab.</div>
        )}
        {jobs.map((j) => (
          <JobRow
            key={j.id}
            job={statuses[j.id] ?? j}
            onAbort={refresh}
            onDismiss={() => onDismiss(j.id)}
            onView={view}
          />
        ))}
      </div>

      {viewing && (
        <ResultsModal
          viewing={viewing}
          onClose={() => setViewing(null)}
          onRetried={(job) => {
            onTrack(job)
            setViewing(null)
          }}
        />
      )}
    </div>
  )
}

function JobRow({
  job,
  onAbort,
  onDismiss,
  onView,
}: {
  job: JobInfo
  onAbort: () => void
  onDismiss: () => void
  onView: (job: JobInfo, kind: ResultKind) => void
}) {
  const [busy, setBusy] = useState(false)
  const active = ACTIVE.has(job.state)
  const complete = job.state === 'JobComplete'
  const processed = job.numberRecordsProcessed ?? 0
  const failed = job.numberRecordsFailed ?? 0
  const succeeded = Math.max(0, processed - failed)

  async function abort() {
    setBusy(true)
    try {
      await unwrap(api.jobs.abort(job.id))
      onAbort()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tr">
      <span className="mono small">{job.id}</span>
      <span>{job.object || '-'}</span>
      <span>{job.isQuery ? 'query' : job.operation}</span>
      <span>
        <span className={`state ${job.state.toLowerCase()}`}>{job.state}</span>
      </span>
      <span>{job.numberRecordsProcessed ?? '-'}</span>
      <span className={failed ? 'failed-count' : ''}>{job.numberRecordsFailed ?? '-'}</span>
      <span className="row-actions">
        {!job.isQuery && complete && (
          <>
            <button className="link" disabled={busy} onClick={() => onView(job, 'successful')}>
              ✓ {succeeded}
            </button>
            <button className="link danger" disabled={busy} onClick={() => onView(job, 'failed')}>
              ✗ {failed}
            </button>
            <button className="link" disabled={busy} onClick={() => onView(job, 'unprocessed')}>
              Unprocessed
            </button>
          </>
        )}
        {active && (
          <button className="link danger" disabled={busy} onClick={abort}>
            Abort
          </button>
        )}
        <button className="link" disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
      </span>
    </div>
  )
}

const KIND_LABEL: Record<ResultKind, string> = {
  successful: 'Successful',
  failed: 'Failed',
  unprocessed: 'Unprocessed',
}

// Salesforce-injected columns in a results CSV - not part of the original record data.
const SF_RESULT_COLS = new Set(['sf__Id', 'sf__Error', 'sf__Created', 'sf__Unprocessed'])

/** Parse a results CSV fully (no row cap) into columns + rows + the sf__Error index. */
function parseResultCsv(csv: string): { columns: string[]; rows: string[][]; errCol: number } {
  const lines = csv.split(/\r\n|\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return { columns: [], rows: [], errCol: -1 }
  const columns = splitCsvLine(lines[0])
  const rows = lines.slice(1).map(splitCsvLine)
  return { columns, rows, errCol: columns.indexOf('sf__Error') }
}

/** Tally distinct error messages, most common first. */
function distinctErrors(
  rows: string[][],
  errCol: number,
): { message: string; count: number }[] {
  if (errCol < 0) return []
  const counts = new Map<string, number>()
  for (const row of rows) {
    const msg = (row[errCol] ?? '').trim()
    if (!msg) continue
    counts.set(msg, (counts.get(msg) ?? 0) + 1)
  }
  return Array.from(counts, ([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count)
}

function ResultsModal({
  viewing,
  onClose,
  onRetried,
}: {
  viewing: Viewing
  onClose: () => void
  onRetried: (job: JobInfo) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [retrying, setRetrying] = useState(false)

  const parsed = useMemo(
    () => (viewing.csv ? parseResultCsv(viewing.csv) : null),
    [viewing.csv],
  )
  const errors = useMemo(
    () => (viewing.kind === 'failed' && parsed ? distinctErrors(parsed.rows, parsed.errCol) : []),
    [viewing.kind, parsed],
  )
  const selectedCount = useMemo(
    () =>
      parsed ? parsed.rows.filter((r) => selected.has((r[parsed.errCol] ?? '').trim())).length : 0,
    [parsed, selected],
  )

  function toggle(message: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(message)) next.delete(message)
      else next.add(message)
      return next
    })
  }

  async function save() {
    if (!viewing.csv) return
    await unwrap(api.files.saveCsv(`${viewing.jobId}-${viewing.kind}.csv`, viewing.csv))
  }

  if (retrying && parsed) {
    return (
      <RetryEditor
        viewing={viewing}
        parsed={parsed}
        selected={selected}
        rowCount={selectedCount}
        onBack={() => setRetrying(false)}
        onClose={onClose}
        onRetried={onRetried}
      />
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>
          {KIND_LABEL[viewing.kind]} records <span className="mono small">{viewing.jobId}</span>
        </h2>
        <div className="modal-body results-body">
        {viewing.loading ? (
          <p className="hint">Loading results…</p>
        ) : viewing.error ? (
          <div className="banner error">{viewing.error}</div>
        ) : viewing.table && viewing.table.total > 0 ? (
          <>
            {errors.length > 0 && (
              <details className="error-summary" open>
                <summary>
                  {errors.length} distinct error{errors.length === 1 ? '' : 's'} · tick errors to fix
                  &amp; retry
                </summary>
                <ul>
                  {errors.map((e) => (
                    <li key={e.message}>
                      <label className="error-pick">
                        <input
                          type="checkbox"
                          checked={selected.has(e.message)}
                          onChange={() => toggle(e.message)}
                        />
                        <span className="error-count">{e.count}×</span>
                        <span className="error-message" title={e.message}>
                          {e.message}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="preview-meta">
              Showing {viewing.table.rows.length} of {viewing.table.total} records
            </div>
            <div className="result-table">
              <table>
                <thead>
                  <tr>
                    {viewing.table.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewing.table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((cell, ci) => (
                        <td key={ci}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="hint">No {viewing.kind} records.</p>
        )}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          {selected.size > 0 && (
            <button className="btn primary" onClick={() => setRetrying(true)}>
              Fix &amp; retry {selectedCount} record{selectedCount === 1 ? '' : 's'}
            </button>
          )}
          {viewing.csv && viewing.table && viewing.table.total > 0 && (
            <button className="btn ghost" onClick={save}>
              Save CSV
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ReplaceRule {
  id: number
  column: string
  find: string
  replace: string
  /** When true, matched cells are set to null (Bulk API #N/A) instead of `replace`. */
  toNull: boolean
}
interface RemapRule {
  id: number
  column: string
  /** Target field API name, '' = not chosen yet, DROP_COLUMN = remove the column. */
  field: string
}

// Bulk API token that blanks a field; '' would instead leave it unchanged on update/upsert.
const NULL_TOKEN = '#N/A'
const DROP_COLUMN = '__drop__'

// Salesforce HTML-encodes special chars in error text (e.g. ' -> &#39;); decode so
// the offending value can be matched against the raw cell value.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function RetryEditor({
  viewing,
  parsed,
  selected,
  rowCount,
  onBack,
  onClose,
  onRetried,
}: {
  viewing: Viewing
  parsed: { columns: string[]; rows: string[][]; errCol: number }
  selected: Set<string>
  rowCount: number
  onBack: () => void
  onClose: () => void
  onRetried: (job: JobInfo) => void
}) {
  const isUpsert = viewing.operation === 'upsert'
  const dataColumns = useMemo(
    () => parsed.columns.filter((c) => !SF_RESULT_COLS.has(c)),
    [parsed.columns],
  )
  const matchedRows = useMemo(
    () => parsed.rows.filter((r) => selected.has((r[parsed.errCol] ?? '').trim())),
    [parsed, selected],
  )
  // Candidate find-values per column: only cell values that actually appear in
  // their row's error message (i.e. the value Salesforce flagged), not every
  // value in the failed rows.
  const valuesByColumn = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of parsed.columns) {
      const ci = parsed.columns.indexOf(c)
      const set = new Set<string>()
      for (const row of matchedRows) {
        const v = (row[ci] ?? '').trim()
        if (v && decodeHtmlEntities(row[parsed.errCol] ?? '').includes(v)) set.add(v)
      }
      m.set(c, Array.from(set).sort())
    }
    return m
  }, [parsed.columns, parsed.errCol, matchedRows])

  const [fields, setFields] = useState<SObjectField[]>([])
  const [externalId, setExternalId] = useState('')
  const [replaceRules, setReplaceRules] = useState<ReplaceRule[]>([])
  const [remapRules, setRemapRules] = useState<RemapRule[]>([])
  const [nextId, setNextId] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const externalIdFields = useMemo(
    () => fields.filter((f) => f.externalId || f.name === 'Id'),
    [fields],
  )

  useEffect(() => {
    let cancelled = false
    api.metadata.describeObject(viewing.object).then((r) => {
      if (!cancelled && r.ok) setFields(r.data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [viewing.object])

  function addReplace() {
    setReplaceRules((rs) => [
      ...rs,
      { id: nextId, column: dataColumns[0] ?? '', find: '', replace: '', toNull: false },
    ])
    setNextId((n) => n + 1)
  }
  function addRemap() {
    setRemapRules((rs) => [...rs, { id: nextId, column: dataColumns[0] ?? '', field: '' }])
    setNextId((n) => n + 1)
  }

  /** Build the corrected CSV: kept data columns, matched rows, with replacements + header remap. */
  function buildCsv(): string {
    const dropped = new Set(remapRules.filter((r) => r.field === DROP_COLUMN).map((r) => r.column))
    const rename = new Map(
      remapRules.filter((r) => r.field && r.field !== DROP_COLUMN).map((r) => [r.column, r.field]),
    )
    const outCols = dataColumns.filter((c) => !dropped.has(c))
    const header = outCols.map((c) => rename.get(c) ?? c)
    const srcIdx = outCols.map((c) => parsed.columns.indexOf(c))
    const lines = [header.map(escapeCsvValue).join(',')]
    for (const row of matchedRows) {
      const cells = srcIdx.map((ci, k) => {
        let v = row[ci] ?? ''
        for (const rule of replaceRules) {
          // find-values come from trimmed cell values, so match on the trimmed cell.
          if (rule.column === outCols[k] && rule.find && v.trim() === rule.find)
            v = rule.toNull ? NULL_TOKEN : rule.replace
        }
        return escapeCsvValue(v)
      })
      lines.push(cells.join(','))
    }
    return lines.join('\n')
  }

  async function submit() {
    setError(null)
    if (isUpsert && !externalId) return setError('Choose the external Id key field for the upsert.')
    setBusy(true)
    try {
      const job = await unwrap(
        api.ingest.submit({
          object: viewing.object,
          operation: viewing.operation as BulkOperation,
          externalIdFieldName: isUpsert ? externalId : undefined,
          csv: buildCsv(),
          lineEnding: 'LF',
        }),
      )
      onRetried(job)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Fix &amp; retry</h2>
        <div className="modal-body">
        <div className="preview-meta">
          {rowCount} record{rowCount === 1 ? '' : 's'} from {selected.size} error group
          {selected.size === 1 ? '' : 's'} · resubmitting as <strong>{viewing.operation}</strong> on{' '}
          <strong>{viewing.object}</strong>
        </div>

        {isUpsert && (
          <label className="retry-key">
            External Id key field
            <select
              aria-label="External Id key field"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
            >
              <option value="">Select a field…</option>
              {externalIdFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label} ({f.name})
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="retry-section">
          <div className="retry-head">
            <h3>Replace values</h3>
            <button className="link" onClick={addReplace}>
              + add rule
            </button>
          </div>
          {replaceRules.length === 0 ? (
            <p className="hint">Swap an exact cell value, e.g. fix a bad picklist value.</p>
          ) : (
            replaceRules.map((rule) => (
              <div key={rule.id} className="retry-row">
                <select
                  aria-label="replace column"
                  value={rule.column}
                  onChange={(e) =>
                    setReplaceRules((rs) =>
                      rs.map((r) => (r.id === rule.id ? { ...r, column: e.target.value } : r)),
                    )
                  }
                >
                  {dataColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="find value"
                  list={`vals-${rule.id}`}
                  value={rule.find}
                  onChange={(e) =>
                    setReplaceRules((rs) =>
                      rs.map((r) => (r.id === rule.id ? { ...r, find: e.target.value } : r)),
                    )
                  }
                />
                <datalist id={`vals-${rule.id}`}>
                  {(valuesByColumn.get(rule.column) ?? []).map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                <span className="map-arrow">→</span>
                <input
                  placeholder="replace with"
                  value={rule.toNull ? '' : rule.replace}
                  disabled={rule.toNull}
                  onChange={(e) =>
                    setReplaceRules((rs) =>
                      rs.map((r) => (r.id === rule.id ? { ...r, replace: e.target.value } : r)),
                    )
                  }
                />
                <label className="retry-null" title="Set the field to null (#N/A)">
                  <input
                    type="checkbox"
                    checked={rule.toNull}
                    onChange={(e) =>
                      setReplaceRules((rs) =>
                        rs.map((r) => (r.id === rule.id ? { ...r, toNull: e.target.checked } : r)),
                      )
                    }
                  />
                  null
                </label>
                <button
                  className="link danger"
                  onClick={() => setReplaceRules((rs) => rs.filter((r) => r.id !== rule.id))}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="retry-section">
          <div className="retry-head">
            <h3>Remap columns</h3>
            <button className="link" onClick={addRemap}>
              + add rule
            </button>
          </div>
          {remapRules.length === 0 ? (
            <p className="hint">Send a column to a different field, or drop it from the retry.</p>
          ) : (
            remapRules.map((rule) => (
              <div key={rule.id} className="retry-row">
                <select
                  aria-label="remap column"
                  value={rule.column}
                  onChange={(e) =>
                    setRemapRules((rs) =>
                      rs.map((r) => (r.id === rule.id ? { ...r, column: e.target.value } : r)),
                    )
                  }
                >
                  {dataColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="map-arrow">→</span>
                {fields.length > 0 ? (
                  <select
                    value={rule.field}
                    onChange={(e) =>
                      setRemapRules((rs) =>
                        rs.map((r) => (r.id === rule.id ? { ...r, field: e.target.value } : r)),
                      )
                    }
                  >
                    <option value="">Select a field…</option>
                    <option value={DROP_COLUMN}>— remove column —</option>
                    {fields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.label} ({f.name})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    placeholder="Field_Api_Name__c"
                    value={rule.field === DROP_COLUMN ? '' : rule.field}
                    disabled={rule.field === DROP_COLUMN}
                    onChange={(e) =>
                      setRemapRules((rs) =>
                        rs.map((r) => (r.id === rule.id ? { ...r, field: e.target.value } : r)),
                      )
                    }
                  />
                )}
                <label className="retry-null" title="Drop this column from the retry">
                  <input
                    type="checkbox"
                    checked={rule.field === DROP_COLUMN}
                    onChange={(e) =>
                      setRemapRules((rs) =>
                        rs.map((r) =>
                          r.id === rule.id ? { ...r, field: e.target.checked ? DROP_COLUMN : '' } : r,
                        ),
                      )
                    }
                  />
                  drop
                </label>
                <button
                  className="link danger"
                  onClick={() => setRemapRules((rs) => rs.filter((r) => r.id !== rule.id))}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {error && <div className="banner error">{error}</div>}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onBack} disabled={busy}>
            ← Back
          </button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={busy || rowCount === 0 || (isUpsert && !externalId)}
          >
            {busy ? 'Submitting…' : `Retry ${rowCount} record${rowCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
