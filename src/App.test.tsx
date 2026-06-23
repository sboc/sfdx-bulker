// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { IpcResult, OrgIdentity } from './shared/types'

vi.mock('./api', () => ({
  api: {
    auth: {
      current: vi.fn(),
      listConnectable: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      connect: vi.fn(),
      disconnect: vi.fn(),
      deleteOrg: vi.fn(),
      logoutCli: vi.fn(),
      loginCli: vi.fn(),
    },
    metadata: { listObjects: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    jobs: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }), abort: vi.fn(), delete: vi.fn() },
    ingest: { submit: vi.fn(), results: vi.fn() },
    query: { submit: vi.fn() },
    files: { openCsv: vi.fn(), saveCsv: vi.fn() },
  },
  unwrap: async <T,>(p: Promise<IpcResult<T>>) => {
    const r = await p
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  },
}))

import App from './App'
import { api } from './api'

const IDENTITY: OrgIdentity = {
  instanceUrl: 'https://i', username: 'me@x', displayName: 'Me', organizationId: '00D', userId: '005',
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('App', () => {
  it('shows the disconnected state with no tabs when no org is active', async () => {
    vi.mocked(api.auth.current).mockResolvedValue(null)
    render(<App />)
    expect(await screen.findByText('Not connected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull()
  })

  it('shows tabs when connected and switches between them', async () => {
    vi.mocked(api.auth.current).mockResolvedValue(IDENTITY)
    render(<App />)

    // Default Load tab
    expect(await screen.findByRole('button', { name: 'Load' })).toBeTruthy()
    expect(screen.getByText('Insert')).toBeTruthy()

    // Switch to Monitor
    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }))
    expect(await screen.findByText('Processed')).toBeTruthy()

    // Switch to Extract
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }))
    expect(await screen.findByRole('button', { name: 'Run query' })).toBeTruthy()
  })
})
