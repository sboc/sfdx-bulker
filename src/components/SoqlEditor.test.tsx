// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import type { IpcResult } from '../shared/types'

vi.mock('../api', () => ({
  api: {
    metadata: { listObjects: vi.fn(), describeObject: vi.fn() },
  },
  unwrap: async <T,>(p: Promise<IpcResult<T>>) => {
    const r = await p
    if (!r.ok) throw new Error(r.error)
    return r.data as T
  },
}))

import { SoqlEditor } from './SoqlEditor'
import { api } from '../api'

const OBJECTS = [
  { name: 'Account', label: 'Account' },
  { name: 'Contact', label: 'Contact' },
  { name: 'Lead', label: 'Lead' },
]
const FIELDS = [
  { name: 'Name', label: 'Name', type: 'string', createable: true, updateable: true, externalId: false },
  { name: 'NumberOfEmployees', label: 'Employees', type: 'int', createable: true, updateable: true, externalId: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.metadata.listObjects).mockResolvedValue({ ok: true, data: OBJECTS })
  vi.mocked(api.metadata.describeObject).mockResolvedValue({ ok: true, data: FIELDS })
})
afterEach(cleanup)

/** Controlled wrapper so accept() can write back through onChange. */
function Harness({ onSubmit }: { onSubmit?: () => void }) {
  const [v, setV] = useState('')
  return <SoqlEditor value={v} onChange={setV} onSubmit={onSubmit} placeholder="q" />
}

/** Set the textarea value (controlled) and place the caret, then trigger refresh. */
function typeAndCaret(ta: HTMLTextAreaElement, text: string, caret: number) {
  fireEvent.change(ta, { target: { value: text } })
  ta.setSelectionRange(caret, caret)
  fireEvent.keyUp(ta, { key: 'ArrowRight' }) // synchronous refresh()
}

describe('SoqlEditor autocomplete', () => {
  it('suggests objects after FROM, navigates and accepts on Enter', async () => {
    render(<Harness />)
    const ta = screen.getByPlaceholderText('q') as HTMLTextAreaElement
    typeAndCaret(ta, 'SELECT Id FROM ', 15)

    expect((await screen.findAllByRole('option')).length).toBe(3)
    fireEvent.keyDown(ta, { key: 'ArrowDown' }) // 0 -> 1 (Contact)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(ta.value).toBe('SELECT Id FROM Contact')
  })

  it('opens with Ctrl+Space and closes with Escape', async () => {
    render(<Harness />)
    const ta = screen.getByPlaceholderText('q') as HTMLTextAreaElement
    // Position the caret without opening the popup yet.
    fireEvent.change(ta, { target: { value: 'SELECT Id FROM ' } })
    ta.setSelectionRange(15, 15)
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.keyDown(ta, { key: ' ', ctrlKey: true })
    expect(await screen.findByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('suggests fields of the FROM object and accepts on click', async () => {
    render(<Harness />)
    const ta = screen.getByPlaceholderText('q') as HTMLTextAreaElement
    typeAndCaret(ta, 'SELECT Na FROM Account', 9)

    await vi.waitFor(() => expect(api.metadata.describeObject).toHaveBeenCalledWith('Account'))
    const opt = await screen.findByRole('option', { name: /Name/ })
    fireEvent.mouseDown(opt)
    expect(ta.value).toBe('SELECT Name FROM Account')
  })

  it('Ctrl+Enter submits and closes the popup', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    const ta = screen.getByPlaceholderText('q') as HTMLTextAreaElement
    typeAndCaret(ta, 'SELECT Id FROM ', 15)
    await screen.findByRole('listbox')

    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
