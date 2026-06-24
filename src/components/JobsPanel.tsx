import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, unwrap } from '../api'
import { Combo, type ComboOption } from './Combo'
import { EMPTY_JOB_FILTERS, type JobFilters } from './jobFilters'
import type { JobInfo } from '../shared/types'

const ACTIVE = new Set(['Open', 'UploadComplete', 'InProgress'])

// Page-size choices for the jobs pager; first is the default.
const PAGE_SIZES = [10, 25, 50, 100]

// Canonical Bulk API 2.0 job states, in lifecycle order.
const STATES = ['Open', 'UploadComplete', 'InProgress', 'JobComplete', 'Aborted', 'Failed']

/** Display operation for a job (query jobs report their op as query/queryAll). */
const opOf = (j: JobInfo) => (j.isQuery ? 'query' : j.operation)

interface Props {
  /** Cached jobs lifted to App so the list survives tab switches; null = never loaded. */
  jobs: JobInfo[] | null
  onJobs: (jobs: JobInfo[]) => void
  /** Filter state, also lifted so it persists across tab switches. */
  filters: JobFilters
  onFilters: (f: JobFilters) => void
  /** Hand a job to the Monitor tab (live status + results/retry). */
  onTrack: (job: JobInfo) => void
  onViewMonitor: () => void
}

export function JobsPanel({ jobs, onJobs, filters, onFilters, onTrack, onViewMonitor }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [page, setPage] = useState(1)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      onJobs(await unwrap(api.jobs.listAll()))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [onJobs])

  // Load once; if a cached list already exists (tab revisit), keep it.
  const loaded = jobs !== null
  useEffect(() => {
    if (loaded) return
    const kick = setTimeout(refresh, 0)
    return () => clearTimeout(kick)
  }, [loaded, refresh])

  const list = useMemo(() => jobs ?? [], [jobs])
  const { object, state, operation, from, to } = filters
  const set = (patch: Partial<JobFilters>) => {
    setPage(1)
    onFilters({ ...filters, ...patch })
  }

  // Objects actually present in the loaded jobs, sorted, for the searchable picker.
  const objectOptions = useMemo<ComboOption[]>(() => {
    const names = [...new Set(list.map((j) => j.object).filter(Boolean))].sort()
    return names.map((n) => ({ value: n, label: n }))
  }, [list])

  // States present in the loaded jobs, in canonical lifecycle order.
  const stateOptions = useMemo(() => {
    const present = new Set(list.map((j) => j.state))
    return STATES.filter((s) => present.has(s))
  }, [list])

  // Operations present in the loaded jobs, sorted.
  const operationOptions = useMemo(
    () => [...new Set(list.map(opOf).filter(Boolean))].sort(),
    [list],
  )

  const filtered = useMemo(() => {
    return list.filter((j) => {
      if (object && j.object !== object) return false
      if (state && j.state !== state) return false
      if (operation && opOf(j) !== operation) return false
      // createdDate is ISO (e.g. 2026-01-02T10:00:00.000+0000); compare the date part.
      const day = j.createdDate.slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false
      return true
    })
  }, [list, object, state, operation, from, to])

  const active = !!(object || state || operation || from || to)

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  // Clamp the current page when the result set or page size shrinks under it.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])
  const start = (page - 1) * pageSize
  const pageJobs = filtered.slice(start, start + pageSize)

  function monitor(job: JobInfo) {
    onTrack(job)
    onViewMonitor()
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <button className="btn ghost" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
        <Combo
          className="job-filter-object"
          options={objectOptions}
          value={object}
          onChange={(v) => set({ object: v })}
          placeholder="All objects"
          clearLabel="— all objects —"
        />
        <select
          className="job-filter-state"
          aria-label="Filter by operation"
          value={operation}
          onChange={(e) => set({ operation: e.target.value })}
        >
          <option value="">All operations</option>
          {operationOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          className="job-filter-state"
          aria-label="Filter by state"
          value={state}
          onChange={(e) => set({ state: e.target.value })}
        >
          <option value="">All states</option>
          {stateOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="job-filter-date">
          From
          <input type="date" aria-label="Created from" value={from} max={to || undefined} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="job-filter-date">
          To
          <input type="date" aria-label="Created to" value={to} min={from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </label>
        {active && (
          <button
            className="link"
            onClick={() => {
              setPage(1)
              onFilters(EMPTY_JOB_FILTERS)
            }}
          >
            Clear
          </button>
        )}
        <span className="hint job-count">
          {filtered.length}
          {active && filtered.length !== list.length ? ` of ${list.length}` : ''} job
          {filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="table jobs-table">
        <div className="tr th">
          <span>Job</span>
          <span>Object</span>
          <span>Operation</span>
          <span>State</span>
          <span>Created</span>
          <span>Actions</span>
        </div>
        {!loading && filtered.length === 0 && (
          <div className="tr empty-row">
            {list.length === 0 ? 'No bulk jobs in this org.' : 'No jobs match the filter.'}
          </div>
        )}
        {pageJobs.map((j) => (
          <JobRow key={j.id} job={j} onAbort={refresh} onMonitor={() => monitor(j)} />
        ))}
      </div>

      {filtered.length > 0 && (
        <div className="pager">
          <div className="pager-nav">
            <button
              className="btn ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <span className="hint">
              Page {page} of {pageCount}
            </span>
            <button
              className="btn ghost"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next →
            </button>
          </div>
          <select
            className="job-filter-state job-page-size"
            aria-label="Jobs per page"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

function JobRow({
  job,
  onAbort,
  onMonitor,
}: {
  job: JobInfo
  onAbort: () => void
  onMonitor: () => void
}) {
  const [busy, setBusy] = useState(false)
  const active = ACTIVE.has(job.state)

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
      <span className="small">{job.createdDate ? job.createdDate.replace('T', ' ').slice(0, 19) : '-'}</span>
      <span className="row-actions">
        <button className="link" disabled={busy} onClick={onMonitor}>
          Monitor
        </button>
        {active && (
          <button className="link danger" disabled={busy} onClick={abort}>
            Abort
          </button>
        )}
      </span>
    </div>
  )
}
