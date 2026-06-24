// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Combo, type ComboOption } from './Combo'

const OPTS: ComboOption[] = [
  { value: 'Account', label: 'Account', hint: 'standard' },
  { value: 'Contact', label: 'Contact' },
  { value: 'Lead', label: 'Lead' },
]

afterEach(cleanup)

describe('Combo', () => {
  it('opens on focus and lists every option', () => {
    render(<Combo options={OPTS} value="" onChange={() => {}} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('filters options by the typed query', () => {
    render(<Combo options={OPTS} value="" onChange={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'lea' } })
    const opts = screen.getAllByRole('option')
    expect(opts).toHaveLength(1)
    expect(opts[0].textContent).toContain('Lead')
  })

  it('navigates with ArrowDown and selects with Enter', () => {
    const onChange = vi.fn()
    render(<Combo options={OPTS} value="" onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // active 0 -> 1 (Contact)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('Contact')
  })

  it('selects on mouse click', () => {
    const onChange = vi.fn()
    render(<Combo options={OPTS} value="" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByRole('option', { name: /Lead/ }))
    expect(onChange).toHaveBeenCalledWith('Lead')
  })

  it('Escape closes the list', () => {
    render(<Combo options={OPTS} value="" onChange={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    expect(screen.queryByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('a clear row selects the empty value', () => {
    const onChange = vi.fn()
    render(<Combo options={OPTS} value="Account" onChange={onChange} clearLabel="— ignore —" />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    // First row (active 0) is the clear row.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('')
  })
})
