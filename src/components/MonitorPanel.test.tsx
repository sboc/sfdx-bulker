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
    // 'Account' appears both as a row cell and a filter option
    expect(screen.getAllByText('Account').length).toBeGreaterThanOrEqual(1)
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

  it('filters the job list by object and operation', async () => {
    render(<MonitorPanel />)
    await screen.findByText('750a')

    // Filter to Contact -> only the query job remains
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by object' }), {
      target: { value: 'Contact' },
    })
    expect(screen.queryByText('750a')).toBeNull()
    expect(screen.getByText('750q')).toBeTruthy()

    // Clear, then filter by operation = insert -> only the ingest job
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by operation' }), {
      target: { value: 'insert' },
    })
    expect(screen.getByText('750a')).toBeTruthy()
    expect(screen.queryByText('750q')).toBeNull()
  })

  it('filters by job id, and seeds the filter from initialJobId', async () => {
    const view = render(<MonitorPanel />)
    await screen.findByText('750a')
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by job id' }), {
      target: { value: '750q' },
    })
    expect(screen.queryByText('750a')).toBeNull()
    expect(screen.getByText('750q')).toBeTruthy()
    view.unmount()

    render(<MonitorPanel initialJobId="750a" />)
    await screen.findByText('750a')
    expect(screen.queryByText('750q')).toBeNull()
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
