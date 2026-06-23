// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { IpcResult } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    metadata: { listObjects: vi.fn() },
    files: { openCsv: vi.fn(), saveCsv: vi.fn() },
    ingest: { submit: vi.fn(), results: vi.fn() },
  },
  unwrap: async <T,>(p: Promise<IpcResult<T>>) => {
    const r = await p
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  },
}))

import { LoadPanel } from './LoadPanel'
import { api } from '../api'

const OBJECTS = [
  { name: 'Account', label: 'Account' },
  { name: 'Contact', label: 'Contact' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.metadata.listObjects).mockResolvedValue({ ok: true, data: OBJECTS })
  vi.mocked(api.files.openCsv).mockResolvedValue({ ok: true, data: { name: 'data.csv', content: 'Id\n1\n2' } })
  vi.mocked(api.ingest.submit).mockResolvedValue({
    ok: true,
    data: { id: '750a', object: 'Account', operation: 'insert', state: 'UploadComplete', createdDate: 'd', isQuery: false },
  })
})
afterEach(cleanup)

async function chooseFile() {
  fireEvent.click(screen.getByRole('button', { name: /Choose CSV file/ }))
  // file button label flips to the chosen name once openCsv resolves
  await screen.findByRole('button', { name: /data\.csv/ })
}

describe('LoadPanel render', () => {
  it('loads objects into the sObject field and lists every operation', async () => {
    render(<LoadPanel />)
    expect(await screen.findByPlaceholderText('Search 2 objects…')).toBeTruthy()
    for (const op of ['Insert', 'Update', 'Upsert', 'Delete', 'Hard Delete']) {
      expect(screen.getByText(op)).toBeTruthy()
    }
  })

  it('disables Run until an sObject and file are chosen', async () => {
    render(<LoadPanel />)
    await screen.findByPlaceholderText('Search 2 objects…')
    expect((screen.getByRole('button', { name: /Run insert/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('LoadPanel file + submit', () => {
  it('shows a CSV preview after a file is chosen', async () => {
    render(<LoadPanel />)
    await screen.findByPlaceholderText('Search 2 objects…')
    await chooseFile()
    expect(screen.getByText('2')).toBeTruthy() // 2 rows
    expect(screen.getByText('Id')).toBeTruthy() // column chip
  })

  it('submits an insert job and shows the new job id', async () => {
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile()
    fireEvent.click(screen.getByRole('button', { name: /Run insert/ }))

    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'Account', operation: 'insert', csv: 'Id\n1\n2', lineEnding: 'LF' }),
      ),
    )
    expect(await screen.findByText('750a')).toBeTruthy()
  })

  it('blocks upsert without an external Id field', async () => {
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    fireEvent.click(screen.getAllByRole('radio')[2]) // upsert
    await chooseFile()
    fireEvent.click(screen.getByRole('button', { name: /Run upsert/ }))

    expect(await screen.findByText(/requires an external Id field/i)).toBeTruthy()
    expect(api.ingest.submit).not.toHaveBeenCalled()
  })

  it('surfaces a submit error', async () => {
    vi.mocked(api.ingest.submit).mockResolvedValue({ ok: false, error: 'bulk boom' })
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile()
    fireEvent.click(screen.getByRole('button', { name: /Run insert/ }))
    expect(await screen.findByText('bulk boom')).toBeTruthy()
  })
})
