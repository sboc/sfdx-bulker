import { useCallback, useEffect, useState } from 'react'
import { api, unwrap } from '../api'
import { parseCsvTable } from '../shared/csv'
import type { JobInfo, ResultKind } from '../shared/types'

const ACTIVE = new Set(['Open', 'UploadComplete', 'InProgress'])

interface Props {
  jobs: JobInfo[]
  onDismiss: (id: string) => void
}

interface Viewing {
  jobId: string
  kind: ResultKind
  loading: boolean
  error?: string
  csv?: string
  table?: { columns: string[]; rows: string[][]; total: number }
}

export function MonitorPanel({ jobs, onDismiss }: Props) {
  const [statuses, setStatuses] = useState<Record<string, JobInfo>>({})
  const [auto, setAuto] = useState(true)
  const [loading, setLoading] = useState(false)
  const [viewing, setViewing] = useState<Viewing | null>(null)

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

  async function view(jobId: string, kind: ResultKind) {
    setViewing({ jobId, kind, loading: true })
    try {
      const csv = await unwrap(api.ingest.results(jobId, kind))
      setViewing({ jobId, kind, loading: false, csv, table: parseCsvTable(csv) })
    } catch (e) {
      setViewing({ jobId, kind, loading: false, error: e instanceof Error ? e.message : String(e) })
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
        <span className="preview-meta">Jobs submitted this session</span>
      </div>

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

      {viewing && <ResultsModal viewing={viewing} onClose={() => setViewing(null)} />}
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
  onView: (jobId: string, kind: ResultKind) => void
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
            <button className="link" disabled={busy} onClick={() => onView(job.id, 'successful')}>
              ✓ {succeeded}
            </button>
            <button className="link danger" disabled={busy} onClick={() => onView(job.id, 'failed')}>
              ✗ {failed}
            </button>
            <button className="link" disabled={busy} onClick={() => onView(job.id, 'unprocessed')}>
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

function ResultsModal({ viewing, onClose }: { viewing: Viewing; onClose: () => void }) {
  async function save() {
    if (!viewing.csv) return
    await unwrap(api.files.saveCsv(`${viewing.jobId}-${viewing.kind}.csv`, viewing.csv))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>
          {KIND_LABEL[viewing.kind]} records <span className="mono small">{viewing.jobId}</span>
        </h2>
        {viewing.loading ? (
          <p className="hint">Loading results…</p>
        ) : viewing.error ? (
          <div className="banner error">{viewing.error}</div>
        ) : viewing.table && viewing.table.total > 0 ? (
          <>
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
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          {viewing.csv && viewing.table && viewing.table.total > 0 && (
            <button className="btn primary" onClick={save}>
              Save CSV
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
