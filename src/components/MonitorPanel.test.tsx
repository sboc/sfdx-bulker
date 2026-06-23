// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { IpcResult, JobInfo } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    jobs: {
      status: vi.fn(),
      abort: vi.fn().mockResolvedValue({ ok: true, data: null }),
    },
    ingest: { results: vi.fn() },
    files: { saveCsv: vi.fn().mockResolvedValue({ ok: true, data: { path: '/tmp/x.csv' } }) },
  },
  unwrap: async <T,>(p: Promise<IpcResult<T>>) => {
    const r = await p
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  },
}))

import { MonitorPanel } from './MonitorPanel'
import { api } from '../api'

const job = (over: Partial<JobInfo> = {}): JobInfo => ({
  id: '750a', object: 'Account', operation: 'insert', state: 'JobComplete',
  createdDate: 'd', numberRecordsProcessed: 100, numberRecordsFailed: 2, isQuery: false, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.jobs.status).mockResolvedValue({ ok: true, data: job() })
})
afterEach(cleanup)

describe('MonitorPanel', () => {
  it('shows the empty state with no tracked jobs', () => {
    render(<MonitorPanel jobs={[]} onTrack={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText(/Submit a job from the Load tab/)).toBeTruthy()
  })

  it('renders a tracked job and polls its status for counts', async () => {
    render(<MonitorPanel jobs={[job({ numberRecordsProcessed: undefined, numberRecordsFailed: undefined })]} onTrack={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText('750a')).toBeTruthy()
    // status poll fills in processed count (100)
    expect(await screen.findByText('100')).toBeTruthy()
    expect(api.jobs.status).toHaveBeenCalledWith('750a')
  })

  it('views successful records in a table and saves the CSV', async () => {
    vi.mocked(api.ingest.results).mockResolvedValue({ ok: true, data: 'sf__Id,Name\n001,Acme\n002,Globex' })
    render(<MonitorPanel jobs={[job()]} onTrack={() => {}} onDismiss={() => {}} />)

    // Successful button shows the success count (processed - failed = 98)
    fireEvent.click(await screen.findByRole('button', { name: '✓ 98' }))
    await waitFor(() => expect(api.ingest.results).toHaveBeenCalledWith('750a', 'successful'))

    expect(await screen.findByText(/Showing 2 of 2 records/)).toBeTruthy()
    expect(screen.getByText('Acme')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save CSV' }))
    await waitFor(() =>
      expect(api.files.saveCsv).toHaveBeenCalledWith('750a-successful.csv', 'sf__Id,Name\n001,Acme\n002,Globex'),
    )
  })

  it('dismisses a job from the tracked list', async () => {
    const onDismiss = vi.fn()
    render(<MonitorPanel jobs={[job()]} onTrack={() => {}} onDismiss={onDismiss} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('750a')
  })

  it('offers Abort for an active job', async () => {
    vi.mocked(api.jobs.status).mockResolvedValue({ ok: true, data: job({ state: 'InProgress' }) })
    render(<MonitorPanel jobs={[job({ state: 'InProgress' })]} onTrack={() => {}} onDismiss={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Abort' }))
    await waitFor(() => expect(api.jobs.abort).toHaveBeenCalledWith('750a'))
  })

  it('looks up a job by id and tracks it', async () => {
    vi.mocked(api.jobs.status).mockResolvedValue({ ok: true, data: job({ id: '750zzz' }) })
    const onTrack = vi.fn()
    render(<MonitorPanel jobs={[]} onTrack={onTrack} onDismiss={() => {}} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Look up a job by id' }), {
      target: { value: '750zzz' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Query' }))

    await waitFor(() => {
      expect(api.jobs.status).toHaveBeenCalledWith('750zzz')
      expect(onTrack).toHaveBeenCalledWith(expect.objectContaining({ id: '750zzz' }))
    })
  })

  it('shows an error when the looked-up job id is not found', async () => {
    vi.mocked(api.jobs.status).mockResolvedValue({ ok: false, error: 'Job 750bad not found (404)' })
    render(<MonitorPanel jobs={[]} onTrack={() => {}} onDismiss={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Look up a job by id' }), {
      target: { value: '750bad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Query' }))
    expect(await screen.findByText(/not found/)).toBeTruthy()
  })
})
