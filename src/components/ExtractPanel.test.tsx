// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { IpcResult } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    query: {
      submit: vi.fn().mockResolvedValue({ ok: true, data: { jobId: '750q', csv: 'Id,Name\n1,Acme', rows: 1 } }),
    },
    files: { saveCsv: vi.fn().mockResolvedValue({ ok: true, data: { path: '/tmp/extract.csv' } }) },
    // SoqlEditor (autocomplete) loads object metadata on mount.
    metadata: {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      describeObject: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    },
  },
  unwrap: async <T,>(p: Promise<IpcResult<T>>) => {
    const r = await p
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  },
}))

import { ExtractPanel } from './ExtractPanel'
import { api } from '../api'

afterEach(cleanup)

describe('ExtractPanel', () => {
  it('disables Run until a query is entered', () => {
    render(<ExtractPanel />)
    const run = screen.getByRole('button', { name: 'Run query' }) as HTMLButtonElement
    expect(run.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/SELECT Id, Name/), {
      target: { value: 'SELECT Id FROM Account' },
    })
    expect(run.disabled).toBe(false)
  })

  it('runs the query and shows the row count + Save action', async () => {
    render(<ExtractPanel />)
    fireEvent.change(screen.getByPlaceholderText(/SELECT Id, Name/), {
      target: { value: 'SELECT Id, Name FROM Account' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))

    expect(await screen.findByText('1 rows')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save CSV (1 rows)' })).toBeTruthy()
    expect(api.query.submit).toHaveBeenCalledWith({ soql: 'SELECT Id, Name FROM Account' })
  })

  it('saves the result CSV via the file dialog', async () => {
    render(<ExtractPanel />)
    fireEvent.change(screen.getByPlaceholderText(/SELECT Id, Name/), {
      target: { value: 'SELECT Id FROM Account' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run query' }))
    fireEvent.click(await screen.findByRole('button', { name: /Save CSV/ }))

    await vi.waitFor(() =>
      expect(api.files.saveCsv).toHaveBeenCalledWith('extract.csv', 'Id,Name\n1,Acme'),
    )
  })
})
