// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { IpcResult } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    jobs: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: '750a', object: 'Account', operation: 'insert', state: 'JobComplete', createdDate: '2026-06-23', numberRecordsProcessed: 100, numberRecordsFailed: 2, isQuery: false },
          { id: '750q', object: 'Contact', operation: 'query', state: 'InProgress', createdDate: '2026-06-22', isQuery: true },
        ],
      }),
      abort: vi.fn().mockResolvedValue({ ok: true, data: null }),
      delete: vi.fn().mockResolvedValue({ ok: true, data: null }),
    },
    ingest: { results: vi.fn().mockResolvedValue({ ok: true, data: 'sf__Id\n001' }) },
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

afterEach(cleanup)

describe('MonitorPanel', () => {
  it('lists jobs with their record counts and state', async () => {
    render(<MonitorPanel />)
    expect(await screen.findByText('750a')).toBeTruthy()
    expect(screen.getByText('100')).toBeTruthy()
    expect(screen.getByText('Account')).toBeTruthy()
    expect(screen.getByText('JobComplete')).toBeTruthy()
    expect(screen.getByText('InProgress')).toBeTruthy()
  })

  it('offers result downloads for a completed ingest job and Abort for an active one', async () => {
    render(<MonitorPanel />)
    await screen.findByText('750a')
    expect(screen.getByRole('button', { name: '✓ CSV' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '✗ CSV' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abort' })).toBeTruthy()
  })

  it('downloads success results through the file dialog', async () => {
    render(<MonitorPanel />)
    await screen.findByText('750a')
    fireEvent.click(screen.getByRole('button', { name: '✓ CSV' }))
    await vi.waitFor(() => {
      expect(api.ingest.results).toHaveBeenCalledWith('750a', 'successful')
      expect(api.files.saveCsv).toHaveBeenCalledWith('750a-successful.csv', 'sf__Id\n001')
    })
  })
})
