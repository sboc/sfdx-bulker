// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { IpcResult } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    metadata: { listObjects: vi.fn(), describeObject: vi.fn() },
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
  vi.mocked(api.metadata.describeObject).mockResolvedValue({ ok: true, data: [] })
  vi.mocked(api.files.openCsv).mockResolvedValue({ ok: true, data: { name: 'data.csv', content: 'Id\n1\n2' } })
  vi.mocked(api.ingest.submit).mockResolvedValue({
    ok: true,
    data: { id: '750a', object: 'Account', operation: 'insert', state: 'UploadComplete', createdDate: 'd', isQuery: false },
  })
})
afterEach(cleanup)

async function chooseFile(name = /data\.csv/) {
  fireEvent.click(screen.getByRole('button', { name: /Choose CSV file/ }))
  await screen.findByRole('button', { name })
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

  it('shows row/column counts after a file is chosen', async () => {
    render(<LoadPanel />)
    await screen.findByPlaceholderText('Search 2 objects…')
    await chooseFile()
    expect(screen.getByText('2')).toBeTruthy() // 2 rows
  })
})

describe('LoadPanel submit', () => {
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

  it('populates the upsert external-Id dropdown from the object, before any file', async () => {
    vi.mocked(api.metadata.describeObject).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
        { name: 'Ext__c', label: 'Ext Key', type: 'string', createable: true, updateable: true, externalId: true },
      ],
    })
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    fireEvent.click(screen.getAllByRole('radio')[2]) // upsert

    // External Id field is a dropdown (not a text input) listing externalId/Id fields
    const select = (await screen.findByRole('combobox', {
      name: 'External Id field',
    })) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toContain('Ext__c')
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

describe('LoadPanel field mapping', () => {
  it('auto-maps CSV columns to fields and remaps the CSV on submit', async () => {
    vi.mocked(api.metadata.describeObject).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
        { name: 'Email__c', label: 'Email', type: 'email', createable: true, updateable: true, externalId: false },
      ],
    })
    vi.mocked(api.files.openCsv).mockResolvedValue({
      ok: true,
      data: { name: 'c.csv', content: 'Name,Email\nAcme,a@x.com' },
    })

    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile(/c\.csv/)

    // Auto-match: Name -> Name, Email -> Email__c (matched by label)
    expect(await screen.findByText('2 of 2 columns mapped')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Run insert/ }))
    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith(
        expect.objectContaining({ csv: 'Name,Email__c\nAcme,a@x.com' }),
      ),
    )
  })

  it('blocks submit when two columns map to the same field', async () => {
    vi.mocked(api.metadata.describeObject).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
        { name: 'Email__c', label: 'Email', type: 'email', createable: true, updateable: true, externalId: false },
      ],
    })
    vi.mocked(api.files.openCsv).mockResolvedValue({
      ok: true,
      data: { name: 'c.csv', content: 'Name,Email\nAcme,a@x.com' },
    })

    const { container } = render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile(/c\.csv/)
    await screen.findByText('2 of 2 columns mapped')

    // Point the second column (Email) at Name too -> duplicate
    const targets = container.querySelectorAll<HTMLSelectElement>('select.map-target')
    fireEvent.change(targets[1], { target: { value: 'Name' } })

    expect(await screen.findByText(/Duplicated: Name/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Run insert/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.ingest.submit).not.toHaveBeenCalled()
  })
})
