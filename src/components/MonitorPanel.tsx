import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, unwrap } from '../api'
import type { JobInfo, ResultKind } from '../shared/types'

const ACTIVE = new Set(['Open', 'UploadComplete', 'InProgress'])

/** Operation as shown in the table (query jobs report their own operation). */
const displayOp = (j: JobInfo) => (j.isQuery ? 'query' : j.operation)
const sortedUnique = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort()

export function MonitorPanel({ initialJobId = '' }: { initialJobId?: string }) {
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(true)
  const [idFilter, setIdFilter] = useState(initialJobId)
  const [objectFilter, setObjectFilter] = useState('')
  const [opFilter, setOpFilter] = useState('')

  const objectOptions = useMemo(() => sortedUnique(jobs.map((j) => j.object)), [jobs])
  const opOptions = useMemo(() => sortedUnique(jobs.map(displayOp)), [jobs])
  const filtered = useMemo(
    () =>
      jobs.filter(
        (j) =>
          (!idFilter || j.id.toLowerCase().includes(idFilter.trim().toLowerCase())) &&
          (!objectFilter || j.object === objectFilter) &&
          (!opFilter || displayOp(j) === opFilter),
      ),
    [jobs, idFilter, objectFilter, opFilter],
  )
  const hasFilter = !!idFilter || !!objectFilter || !!opFilter

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setJobs(await unwrap(api.jobs.list()))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Defer the initial fetch out of the effect body, then poll while auto is on.
    const kick = setTimeout(refresh, 0)
    const poll = auto ? setInterval(refresh, 4000) : undefined
    return () => {
      clearTimeout(kick)
      if (poll) clearInterval(poll)
    }
  }, [auto, refresh])

  return (
    <div className="panel">
      <div className="toolbar">
        <button className="btn ghost" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
        </label>
        <input
          className="filter"
          aria-label="Filter by job id"
          placeholder="Job id…"
          value={idFilter}
          onChange={(e) => setIdFilter(e.target.value)}
        />
        <select
          className="filter"
          aria-label="Filter by object"
          value={objectFilter}
          onChange={(e) => setObjectFilter(e.target.value)}
        >
          <option value="">All objects</option>
          {objectOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          className="filter"
          aria-label="Filter by operation"
          value={opFilter}
          onChange={(e) => setOpFilter(e.target.value)}
        >
          <option value="">All operations</option>
          {opOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            className="link"
            onClick={() => {
              setIdFilter('')
              setObjectFilter('')
              setOpFilter('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}

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
        {filtered.length === 0 && (
          <div className="tr empty-row">{jobs.length === 0 ? 'No jobs yet.' : 'No jobs match the filters.'}</div>
        )}
        {filtered.map((j) => (
          <JobRow key={j.id} job={j} onRefresh={refresh} />
        ))}
      </div>
    </div>
  )
}

function JobRow({ job, onRefresh }: { job: JobInfo; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const active = ACTIVE.has(job.state)

  async function download(kind: ResultKind) {
    setBusy(true)
    try {
      const csv = await unwrap(api.ingest.results(job.id, kind))
      await unwrap(api.files.saveCsv(`${job.id}-${kind}.csv`, csv))
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function abort() {
    setBusy(true)
    try {
      await unwrap(api.jobs.abort(job.id))
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete job ${job.id} from Salesforce?`)) return
    setBusy(true)
    try {
      await unwrap(api.jobs.delete(job.id))
      onRefresh()
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
      <span className={job.numberRecordsFailed ? 'failed-count' : ''}>{job.numberRecordsFailed ?? '-'}</span>
      <span className="row-actions">
        {!job.isQuery && job.state === 'JobComplete' && (
          <>
            <button className="link" disabled={busy} onClick={() => download('successful')}>
              ✓ CSV
            </button>
            <button className="link danger" disabled={busy} onClick={() => download('failed')}>
              ✗ CSV
            </button>
          </>
        )}
        {active && (
          <button className="link danger" disabled={busy} onClick={abort}>
            Abort
          </button>
        )}
        {!active && (
          <button className="link" disabled={busy} onClick={remove}>
            Delete
          </button>
        )}
      </span>
    </div>
  )
}
