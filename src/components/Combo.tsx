import { useEffect, useMemo, useRef, useState } from 'react'
import { bestMatch, fuzzyThreshold } from '../shared/fuzzy'

export type ComboOption = { value: string; label: string; hint?: string }

/**
 * Searchable, fuzzy-matched dropdown for picking one value from a list.
 * The popup is rendered position:fixed (anchored to the input) so it is never
 * clipped by a scrollable ancestor such as the field-mapping list.
 */
export function Combo({
  options,
  value,
  onChange,
  placeholder,
  clearLabel,
  className,
}: {
  options: ComboOption[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** When set, a row at the top of the list clears the value (e.g. "— ignore —"). */
  clearLabel?: string
  /** Extra class on the wrapper (used for unmapped/dupe styling in mapping). */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value) ?? null
  const display = selected ? selected.label : ''

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return options.slice(0, 300)
    const limit = fuzzyThreshold(q.length)
    return options
      .map((o) => ({ o, score: bestMatch(q, o.label.toLowerCase(), (o.hint ?? '').toLowerCase()) }))
      .filter((s) => s.score < 1000 || s.score - 1000 <= limit)
      .sort((a, b) => a.score - b.score || a.o.label.localeCompare(b.o.label))
      .slice(0, 300)
      .map((s) => s.o)
  }, [options, q])

  // Rows include an optional leading clear row (represented by null).
  const rows: (ComboOption | null)[] = clearLabel ? [null, ...matches] : matches

  function place() {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom, left: r.left, width: r.width })
  }

  function openList() {
    place()
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function choose(v: string) {
    onChange(v)
    close()
  }

  // Reposition while open; close on outside click.
  useEffect(() => {
    if (!open) return
    const onScrollResize = () => place()
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    document.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
      document.removeEventListener('mousedown', onDoc)
    }
  }, [open])

  return (
    <div className={className ? `combo ${className}` : 'combo'} ref={wrapRef}>
      <input
        ref={inputRef}
        value={open ? query : display}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          if (!open) openList()
        }}
        onFocus={openList}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) openList()
            else setActive((a) => Math.min(a + 1, rows.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && open && rows.length) {
            e.preventDefault()
            const r = rows[active]
            choose(r ? r.value : '')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      {open && rect && rows.length > 0 && (
        <ul
          className="combo-list fixed"
          role="listbox"
          style={{ top: rect.top + 4, left: rect.left, width: rect.width }}
        >
          {rows.map((o, i) => (
            <li
              key={o ? o.value : '__clear__'}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o ? o.value : '')
              }}
            >
              {o ? (
                <>
                  <span className="combo-name">{o.label}</span>
                  {o.hint && <span className="combo-label">{o.hint}</span>}
                </>
              ) : (
                <span className="combo-clear">{clearLabel}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
