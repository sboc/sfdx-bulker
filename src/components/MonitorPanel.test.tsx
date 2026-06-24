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
    ingest: { results: vi.fn(), submit: vi.fn() },
    metadata: { describeObject: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
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

  it('groups failed errors, then fixes & retries the selected records as a new job', async () => {
    vi.mocked(api.ingest.results).mockResolvedValue({
      ok: true,
      data:
        'sf__Id,sf__Error,Name,Status\n' +
        ',INVALID picklist: Activ,Acme,Activ\n' +
        ',INVALID picklist: Activ,Globex,Activ\n' +
        ',REQUIRED_FIELD_MISSING,Initech,',
    })
    vi.mocked(api.ingest.submit).mockResolvedValue({ ok: true, data: job({ id: '750retry' }) })
    const onTrack = vi.fn()
    render(<MonitorPanel jobs={[job()]} onTrack={onTrack} onDismiss={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: '✗ 2' }))
    await waitFor(() => expect(api.ingest.results).toHaveBeenCalledWith('750a', 'failed'))

    // distinct error list: one checkbox per unique message (2 distinct of 3 rows)
    expect(await screen.findByRole('checkbox', { name: /REQUIRED_FIELD_MISSING/ })).toBeTruthy()

    // tick the picklist error (matches 2 rows) and open the retry editor
    fireEvent.click(screen.getByRole('checkbox', { name: /INVALID picklist/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fix & retry 2 records' }))

    // add a value replacement: Status "Activ" -> "Active"
    fireEvent.click(screen.getAllByRole('button', { name: '+ add rule' })[0])
    fireEvent.change(screen.getByRole('combobox', { name: 'replace column' }), {
      target: { value: 'Status' },
    })
    // find-value dropdown is fed the distinct errored values of the chosen column
    fireEvent.change(screen.getByPlaceholderText('find value'), { target: { value: 'Activ' } })
    const opts = [...document.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))
    expect(opts).toContain('Activ')
    fireEvent.change(screen.getByPlaceholderText('replace with'), { target: { value: 'Active' } })

    fireEvent.click(screen.getByRole('button', { name: 'Retry 2 records' }))

    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith({
        object: 'Account',
        operation: 'insert',
        csv: 'Name,Status\nAcme,Active\nGlobex,Active',
        lineEnding: 'LF',
      }),
    )
    expect(onTrack).toHaveBeenCalledWith(expect.objectContaining({ id: '750retry' }))
  })

  it('retries an upsert with a chosen external Id key, dropping a column and nulling a value', async () => {
    vi.mocked(api.ingest.results).mockResolvedValue({
      ok: true,
      data: 'sf__Id,sf__Error,Ext__c,Name,Status\n,DUPLICATE,E1,Acme,Old\n,DUPLICATE,E2,Globex,Old',
    })
    vi.mocked(api.metadata.describeObject).mockResolvedValue({
      ok: true,
      data: [
        { name: 'Ext__c', label: 'Ext', type: 'string', createable: true, updateable: true, externalId: true },
        { name: 'Status', label: 'Status', type: 'picklist', createable: true, updateable: true, externalId: false },
      ],
    })
    vi.mocked(api.ingest.submit).mockResolvedValue({ ok: true, data: job({ id: '750up' }) })
    vi.mocked(api.jobs.status).mockResolvedValue({ ok: true, data: job({ operation: 'upsert' }) })
    const onTrack = vi.fn()
    render(
      <MonitorPanel jobs={[job({ operation: 'upsert' })]} onTrack={onTrack} onDismiss={() => {}} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '✗ 2' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /DUPLICATE/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fix & retry 2 records' }))

    // pick the external Id key field
    fireEvent.change(await screen.findByRole('combobox', { name: 'External Id key field' }), {
      target: { value: 'Ext__c' },
    })

    // replace + set null: Status -> null
    fireEvent.click(screen.getAllByRole('button', { name: '+ add rule' })[0])
    fireEvent.change(screen.getByRole('combobox', { name: 'replace column' }), {
      target: { value: 'Status' },
    })
    fireEvent.change(screen.getByPlaceholderText('find value'), { target: { value: 'Old' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /null/ }))

    // remap: drop the Name column
    fireEvent.click(screen.getAllByRole('button', { name: '+ add rule' })[1])
    fireEvent.change(screen.getByRole('combobox', { name: 'remap column' }), {
      target: { value: 'Name' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /drop/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Retry 2 records' }))

    await waitFor(() =>
      expect(api.ingest.submit).toHaveBeenCalledWith({
        object: 'Account',
        operation: 'upsert',
        externalIdFieldName: 'Ext__c',
        csv: 'Ext__c,Status\nE1,#N/A\nE2,#N/A',
        lineEnding: 'LF',
      }),
    )
    expect(onTrack).toHaveBeenCalledWith(expect.objectContaining({ id: '750up' }))
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
