// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { IpcResult } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    metadata: { listObjects: vi.fn(), describeObject: vi.fn() },
    files: { openCsv: vi.fn(), saveCsv: vi.fn() },
    ingest: { submit: vi.fn(), results: vi.fn() },
    history: { saveLoadMapping: vi.fn(), suggestMapping: vi.fn() },
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
  vi.mocked(api.files.openCsv).mockResolvedValue({ ok: true, data: [{ name: 'data.csv', content: 'Id\n1\n2' }] })
  vi.mocked(api.ingest.submit).mockResolvedValue({
    ok: true,
    data: { id: '750a', object: 'Account', operation: 'insert', state: 'UploadComplete', createdDate: 'd', isQuery: false },
  })
  vi.mocked(api.history.suggestMapping).mockResolvedValue({ ok: true, data: null })
  vi.mocked(api.history.saveLoadMapping).mockResolvedValue({ ok: true, data: null })
})
afterEach(cleanup)

async function chooseFile(name = /data\.csv/) {
  fireEvent.click(screen.getByRole('button', { name: /Choose CSV file/ }))
  await screen.findByRole('button', { name })
}

/** Advance the wizard from step 1 (Configure) to step 2 (mapping & run). */
function goToStep2() {
  fireEvent.click(screen.getByRole('button', { name: /^Next:/ }))
}

/** Pick a value in a searchable Combo by typing then clicking the option. */
function chooseInCombo(input: HTMLElement, query: string, optionName: RegExp) {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: query } })
  fireEvent.mouseDown(screen.getByRole('option', { name: optionName }))
}

describe('LoadPanel render', () => {
  it('loads objects into the sObject field and lists every operation', async () => {
    render(<LoadPanel />)
    expect(await screen.findByPlaceholderText('Search 2 objects…')).toBeTruthy()
    for (const op of ['Insert', 'Update', 'Upsert', 'Delete', 'Hard Delete']) {
      expect(screen.getByText(op)).toBeTruthy()
    }
  })

  it('filters the sObject dropdown and selects an option on click', async () => {
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Cont' } })
    // Contact is the best (prefix) match, so it ranks first.
    expect(screen.getAllByRole('option')[0].textContent).toMatch(/Contact/)
    fireEvent.mouseDown(screen.getByRole('option', { name: /Contact/ }))
    expect((obj as HTMLInputElement).value).toBe('Contact')
  })

  it('disables advancing until an sObject and file are chosen', async () => {
    render(<LoadPanel />)
    await screen.findByPlaceholderText('Search 2 objects…')
    expect((screen.getByRole('button', { name: /^Next:/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows row/column counts after a file is chosen', async () => {
    render(<LoadPanel />)
    await screen.findByPlaceholderText('Search 2 objects…')
    await chooseFile()
    expect(screen.getByText('2', { selector: 'strong' })).toBeTruthy() // 2 rows
  })
})

describe('LoadPanel multi-file', () => {
  it('combines multiple matching files into one CSV', async () => {
    vi.mocked(api.files.openCsv).mockResolvedValue({
      ok: true,
      data: [
        { name: 'a.csv', content: 'Id\n1\n2' },
        { name: 'b.csv', content: 'Id\n3' },
      ],
    })
    render(<LoadPanel />)
    await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.click(screen.getByRole('button', { name: /Choose CSV file/ }))
    expect(await screen.findByText(/2 files combined \(3 rows\)/)).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy() // 3 combined rows in the preview
  })

  it('offers a shared-columns combine when headers differ', async () => {
    vi.mocked(api.files.openCsv).mockResolvedValue({
      ok: true,
      data: [
        { name: 'a.csv', content: 'Id,Name,Extra\n1,Acme,x' },
        { name: 'b.csv', content: 'Id,Name\n2,Globex' },
      ],
    })
    vi.mocked(api.metadata.describeObject).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Id', label: 'Id', type: 'id', createable: false, updateable: false, externalId: false },
        { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
      ],
    })
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    fireEvent.click(screen.getByRole('button', { name: /Choose CSV file/ }))

    expect(await screen.findByText(/has different columns/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Combine shared columns only' }))

    expect(await screen.findByText(/shared columns \(2 rows\)/)).toBeTruthy()
    goToStep2()
    fireEvent.click(screen.getByRole('button', { name: /Run insert/ }))
    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith(
        expect.objectContaining({ csv: 'Id,Name\n1,Acme\n2,Globex' }),
      ),
    )
  })
})

describe('LoadPanel submit', () => {
  it('submits an insert job and shows the new job id', async () => {
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile()
    goToStep2()
    fireEvent.click(screen.getByRole('button', { name: /Run insert/ }))

    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'Account', operation: 'insert', csv: 'Id\n1\n2', lineEnding: 'LF' }),
      ),
    )
    expect(await screen.findByText('750a')).toBeTruthy()
  })

  it('blocks advancing on upsert without an external Id field', async () => {
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    fireEvent.click(screen.getAllByRole('radio')[2]) // upsert
    await chooseFile()

    // Object + file are set, but the external Id is still required to continue.
    expect((screen.getByRole('button', { name: /^Next:/ }) as HTMLButtonElement).disabled).toBe(true)
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

    // External Id field is a searchable combo listing externalId/Id fields.
    const extInput = await screen.findByPlaceholderText('Search external Id field…')
    fireEvent.focus(extInput)
    expect(screen.getByRole('option', { name: /Ext__c/ })).toBeTruthy()
  })

  it('surfaces a submit error', async () => {
    vi.mocked(api.ingest.submit).mockResolvedValue({ ok: false, error: 'bulk boom' })
    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile()
    goToStep2()
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
      data: [{ name: 'c.csv', content: 'Name,Email\nAcme,a@x.com' }],
    })

    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile(/c\.csv/)
    goToStep2()

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
      data: [{ name: 'c.csv', content: 'Name,Email\nAcme,a@x.com' }],
    })

    render(<LoadPanel />)
    const obj = await screen.findByPlaceholderText('Search 2 objects…')
    fireEvent.change(obj, { target: { value: 'Account' } })
    await chooseFile(/c\.csv/)
    goToStep2()
    await screen.findByText('2 of 2 columns mapped')

    // Point the second column (Email) at Name too -> duplicate
    const targets = screen.getAllByPlaceholderText('Search field…')
    chooseInCombo(targets[1], 'Name', /Name/)

    expect(await screen.findByText(/Duplicated: Name/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Run insert/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.ingest.submit).not.toHaveBeenCalled()
  })

  it('remembers the mapping after a successful submit', async () => {
    vi.mocked(api.metadata.describeObject).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
        { name: 'Email__c', label: 'Email', type: 'email', createable: true, updateable: true, externalId: false },
      ],
    })
    vi.mocked(api.files.openCsv).mockResolvedValue({
      ok: true,
      data: [{ name: 'c.csv', content: 'Name,Email\nAcme,a@x.com' }],
    })

    render(<LoadPanel />)
    fireEvent.change(await screen.findByPlaceholderText('Search 2 objects…'), { target: { value: 'Account' } })
    await chooseFile(/c\.csv/)
    goToStep2()
    await screen.findByText('2 of 2 columns mapped')

    fireEvent.click(screen.getByRole('button', { name: /Run insert/ }))
    await waitFor(() =>
      expect(api.history.saveLoadMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          object: 'Account',
          operation: 'insert',
          columns: ['Name', 'Email'],
          mapping: { Name: 'Name', Email: 'Email__c' },
        }),
      ),
    )
  })

  it('offers a remembered mapping and applies it on Apply', async () => {
    vi.mocked(api.metadata.describeObject).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
        { name: 'Email__c', label: 'Email', type: 'email', createable: true, updateable: true, externalId: false },
      ],
    })
    vi.mocked(api.files.openCsv).mockResolvedValue({
      ok: true,
      data: [{ name: 'c.csv', content: 'Name,Email\nAcme,a@x.com' }],
    })
    // Remembered mapping ignores Email (differs from the auto-map).
    vi.mocked(api.history.suggestMapping).mockResolvedValue({
      ok: true,
      data: {
        object: 'Account', operation: 'insert', columns: ['Name', 'Email'],
        mapping: { Name: 'Name', Email: '' }, updatedAt: 1,
      },
    })

    render(<LoadPanel />)
    fireEvent.change(await screen.findByPlaceholderText('Search 2 objects…'), { target: { value: 'Account' } })
    await chooseFile(/c\.csv/)
    goToStep2()

    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    fireEvent.click(screen.getByRole('button', { name: /Run insert/ }))
    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith(
        expect.objectContaining({ csv: 'Name\nAcme' }),
      ),
    )
  })

  it('applies a remembered Id column for a destructive op', async () => {
    vi.mocked(api.files.openCsv).mockResolvedValue({
      ok: true,
      data: [{ name: 'c.csv', content: 'Ref,Extra\n1,2' }],
    })
    // Remembered mapping for delete: the Id lives in the "Ref" column.
    vi.mocked(api.history.suggestMapping).mockResolvedValue({
      ok: true,
      data: {
        object: 'Account', operation: 'delete', columns: ['Ref', 'Extra'],
        mapping: {}, idColumn: 'Ref', updatedAt: 1,
      },
    })

    render(<LoadPanel />)
    fireEvent.change(await screen.findByPlaceholderText('Search 2 objects…'), { target: { value: 'Account' } })
    await chooseFile(/c\.csv/)
    fireEvent.click(screen.getAllByRole('radio')[3]) // Delete
    goToStep2()

    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    fireEvent.click(screen.getByRole('button', { name: /Run delete/ }))
    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'delete', csv: 'Id\n1' }),
      ),
    )
  })
})
