// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { IpcResult, JobInfo } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    jobs: {
      listAll: vi.fn(),
      abort: vi.fn().mockResolvedValue({ ok: true, data: null }),
    },
  },
  unwrap: async <T,>(p: Promise<IpcResult<T>>) => {
    const r = await p
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  },
}))

import { JobsPanel } from './JobsPanel'
import { EMPTY_JOB_FILTERS, type JobFilters } from './jobFilters'
import { api } from '../api'

const job = (over: Partial<JobInfo> = {}): JobInfo => ({
  id: '750a', object: 'Account', operation: 'insert', state: 'JobComplete',
  createdDate: '2026-01-02T10:00:00.000+0000', isQuery: false, ...over,
})

const JOBS: JobInfo[] = [
  job({ id: 'i1', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: '2026-01-04T00:00:00.000+0000' }),
  job({ id: 'i2', object: 'Contact', operation: 'upsert', state: 'InProgress', createdDate: '2026-01-03T00:00:00.000+0000' }),
  job({ id: 'q1', object: 'Lead', operation: 'query', state: 'JobComplete', createdDate: '2026-01-01T00:00:00.000+0000', isQuery: true }),
]

/** Wrapper that owns the lifted jobs cache + filter state, like App does. */
function Harness({
  initialJobs = null,
  initialFilters = EMPTY_JOB_FILTERS,
  onTrack = () => {},
  onViewMonitor = () => {},
}: {
  initialJobs?: JobInfo[] | null
  initialFilters?: JobFilters
  onTrack?: (j: JobInfo) => void
  onViewMonitor?: () => void
}) {
  const [jobs, setJobs] = useState<JobInfo[] | null>(initialJobs)
  const [filters, setFilters] = useState<JobFilters>(initialFilters)
  return (
    <JobsPanel
      jobs={jobs}
      onJobs={setJobs}
      filters={filters}
      onFilters={setFilters}
      onTrack={onTrack}
      onViewMonitor={onViewMonitor}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.jobs.listAll).mockResolvedValue({ ok: true, data: JOBS })
})
afterEach(cleanup)

describe('JobsPanel', () => {
  it('loads all org jobs on mount and lists them', async () => {
    render(<Harness />)
    expect(await screen.findByText('i1')).toBeTruthy()
    expect(screen.getByText('i2')).toBeTruthy()
    expect(screen.getByText('q1')).toBeTruthy()
    expect(api.jobs.listAll).toHaveBeenCalledTimes(1)
  })

  it('does not reload when a cached list is already present (tab revisit)', async () => {
    render(<Harness initialJobs={JOBS} />)
    expect(screen.getByText('i1')).toBeTruthy()
    // cache hit -> no fetch
    expect(api.jobs.listAll).not.toHaveBeenCalled()
  })

  it('shows the empty state when the org has no jobs', async () => {
    vi.mocked(api.jobs.listAll).mockResolvedValue({ ok: true, data: [] })
    render(<Harness />)
    expect(await screen.findByText(/No bulk jobs in this org/)).toBeTruthy()
  })

  it('surfaces a load error', async () => {
    vi.mocked(api.jobs.listAll).mockResolvedValue({ ok: false, error: 'boom (500)' })
    render(<Harness />)
    expect(await screen.findByText(/boom \(500\)/)).toBeTruthy()
  })

  it('filters by object', async () => {
    render(<Harness initialJobs={JOBS} initialFilters={{ ...EMPTY_JOB_FILTERS, object: 'Contact' }} />)
    expect(screen.getByText('i2')).toBeTruthy()
    expect(screen.queryByText('i1')).toBeNull()
    expect(screen.queryByText('q1')).toBeNull()
    expect(document.querySelector('.job-count')?.textContent).toBe('1 of 3 job')
  })

  it('filters by operation, normalising query jobs', async () => {
    render(<Harness initialJobs={JOBS} initialFilters={{ ...EMPTY_JOB_FILTERS, operation: 'query' }} />)
    expect(screen.getByText('q1')).toBeTruthy()
    expect(screen.queryByText('i1')).toBeNull()
  })

  it('filters by state', async () => {
    render(<Harness initialJobs={JOBS} initialFilters={{ ...EMPTY_JOB_FILTERS, state: 'InProgress' }} />)
    expect(screen.getByText('i2')).toBeTruthy()
    expect(screen.queryByText('i1')).toBeNull()
  })

  it('filters by created date range (inclusive)', async () => {
    render(
      <Harness
        initialJobs={JOBS}
        initialFilters={{ ...EMPTY_JOB_FILTERS, from: '2026-01-03', to: '2026-01-04' }}
      />,
    )
    expect(screen.getByText('i1')).toBeTruthy() // 01-04
    expect(screen.getByText('i2')).toBeTruthy() // 01-03
    expect(screen.queryByText('q1')).toBeNull() // 01-01, out of range
  })

  it('hands a job to the Monitor tab', async () => {
    const onTrack = vi.fn()
    const onViewMonitor = vi.fn()
    render(<Harness initialJobs={[job({ id: '750x' })]} onTrack={onTrack} onViewMonitor={onViewMonitor} />)
    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }))
    expect(onTrack).toHaveBeenCalledWith(expect.objectContaining({ id: '750x' }))
    expect(onViewMonitor).toHaveBeenCalled()
  })

  it('offers Abort only for active jobs and calls the api', async () => {
    render(<Harness initialJobs={[job({ id: '750run', state: 'InProgress' })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))
    await waitFor(() => expect(api.jobs.abort).toHaveBeenCalledWith('750run'))
  })

  it('does not offer Abort for a completed job', () => {
    render(<Harness initialJobs={[job({ state: 'JobComplete' })]} />)
    expect(screen.queryByRole('button', { name: 'Abort' })).toBeNull()
  })

  it('Refresh reloads even when a cache exists', async () => {
    render(<Harness initialJobs={JOBS} />)
    expect(api.jobs.listAll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() => expect(api.jobs.listAll).toHaveBeenCalledTimes(1))
  })
})
