// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { IpcResult, OrgIdentity, SavedOrgView } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    auth: {
      listConnectable: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      deleteOrg: vi.fn(),
      logoutCli: vi.fn(),
      loginCli: vi.fn(),
    },
  },
  unwrap: async <T,>(p: Promise<IpcResult<T>>) => {
    const r = await p
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  },
}))

import { ConnectBar } from './ConnectBar'
import { api } from '../api'

const m = vi.mocked(api.auth)

const IDENTITY: OrgIdentity = {
  instanceUrl: 'https://i', username: 'me@x', displayName: 'Me', organizationId: '00D', userId: '005',
}
const cli = (over: Partial<SavedOrgView> = {}): SavedOrgView => ({
  id: 'cli:p@x', name: 'prod', source: 'cli', cliUsername: 'p@x', loginUrl: 'https://p',
  hasSecret: false, canConnect: true, connected: false, ...over,
})
const cc = (over: Partial<SavedOrgView> = {}): SavedOrgView => ({
  id: 'o1', name: 'CC', source: 'client-credentials', loginUrl: 'https://p', clientId: 'K',
  hasSecret: true, canConnect: true, connected: false, ...over,
})
const orgsOk = (data: SavedOrgView[]) => m.listConnectable.mockResolvedValue({ ok: true, data })
const selectOrg = async (id: string) =>
  fireEvent.change(await screen.findByRole('combobox', { name: 'Org' }), { target: { value: id } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('confirm', () => true)
  m.connect.mockResolvedValue({ ok: true, data: IDENTITY })
  m.disconnect.mockResolvedValue({ ok: true, data: null })
  m.deleteOrg.mockResolvedValue({ ok: true, data: null })
  m.logoutCli.mockResolvedValue({ ok: true, data: null })
  m.loginCli.mockResolvedValue({ ok: true, data: { username: 'new@x' } })
  orgsOk([cli()])
})
afterEach(cleanup)

describe('connect / disconnect', () => {
  it('connects the selected org and reports the identity up', async () => {
    const onChange = vi.fn()
    render(<ConnectBar org={null} onChange={onChange} />)
    await selectOrg('cli:p@x')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(m.connect).toHaveBeenCalledWith('cli:p@x'))
    expect(onChange).toHaveBeenCalledWith(IDENTITY)
  })

  it('forces an explicit org pick - Connect is disabled until one is selected', async () => {
    render(<ConnectBar org={null} onChange={() => {}} />)
    const btn = (await screen.findByRole('button', { name: 'Connect' })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await selectOrg('cli:p@x')
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('disconnects when the active org is connected', async () => {
    orgsOk([cli({ connected: true })])
    const onChange = vi.fn()
    render(<ConnectBar org={IDENTITY} onChange={onChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(m.disconnect).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('disables Connect for an org that cannot connect', async () => {
    orgsOk([cc({ hasSecret: false, canConnect: false })])
    render(<ConnectBar org={null} onChange={() => {}} />)
    await selectOrg('o1')
    const btn = (await screen.findByRole('button', { name: 'Connect' })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('surfaces a connect error', async () => {
    m.connect.mockResolvedValue({ ok: false, error: 'auth boom' })
    render(<ConnectBar org={null} onChange={() => {}} />)
    await selectOrg('cli:p@x')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('auth boom')).toBeTruthy()
  })
})

describe('Orgs manager', () => {
  it('deletes a client-credentials org after confirmation', async () => {
    orgsOk([cc()])
    render(<ConnectBar org={null} onChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Orgs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(m.deleteOrg).toHaveBeenCalledWith('o1'))
  })

  it('logs a CLI org out of the CLI', async () => {
    orgsOk([cli()])
    render(<ConnectBar org={null} onChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Orgs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(m.logoutCli).toHaveBeenCalledWith('p@x'))
  })
})

describe('Add org (CLI login)', () => {
  it('logs in via the CLI with the chosen alias and custom My Domain', async () => {
    render(<ConnectBar org={null} onChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Orgs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add org' }))

    fireEvent.change(await screen.findByPlaceholderText(/prod, uat/), { target: { value: 'uat' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Login host' }), { target: { value: 'custom' } })
    fireEvent.change(await screen.findByPlaceholderText(/mycompany/), {
      target: { value: 'acme.my.salesforce.com/' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open browser to log in' }))

    await waitFor(() =>
      expect(m.loginCli).toHaveBeenCalledWith({
        alias: 'uat',
        instanceUrl: 'https://acme.my.salesforce.com',
      }),
    )
  })

  it('shows an error when CLI login fails', async () => {
    m.loginCli.mockResolvedValue({ ok: false, error: 'login boom' })
    render(<ConnectBar org={null} onChange={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Orgs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add org' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open browser to log in' }))
    expect(await screen.findByText('login boom')).toBeTruthy()
  })
})
