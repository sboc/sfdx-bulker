import { useEffect, useMemo, useRef, useState } from 'react'
import { api, unwrap } from '../api'
import { bestMatch, fuzzyThreshold } from '../shared/fuzzy'
import type { SObjectField, SObjectInfo } from '../shared/types'

const KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'NULL',
  'ORDER BY',
  'GROUP BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'ASC',
  'DESC',
  'NULLS FIRST',
  'NULLS LAST',
  'COUNT()',
  'TRUE',
  'FALSE',
]

type Suggestion = { value: string; detail?: string; kind: 'object' | 'field' | 'keyword' }

/** Pixel position of the caret inside a textarea, via a mirror div. */
function caretCoords(el: HTMLTextAreaElement, pos: number) {
  const div = document.createElement('div')
  const style = getComputedStyle(el)
  const copy = [
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontFamily',
    'lineHeight',
    'letterSpacing',
    'textTransform',
    'wordSpacing',
    'tabSize',
  ] as const
  copy.forEach((p) => ((div.style as unknown as Record<string, string>)[p] = style[p]))
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.textContent = el.value.slice(0, pos)
  const span = document.createElement('span')
  span.textContent = el.value.slice(pos) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const top = span.offsetTop + parseInt(style.borderTopWidth || '0', 10)
  const left = span.offsetLeft + parseInt(style.borderLeftWidth || '0', 10)
  const lineHeight = parseInt(style.lineHeight || '16', 10) || 16
  document.body.removeChild(div)
  return { top: top - el.scrollTop, left: left - el.scrollLeft, lineHeight }
}

export function SoqlEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  placeholder?: string
  rows?: number
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [objects, setObjects] = useState<SObjectInfo[]>([])
  const [fields, setFields] = useState<Record<string, SObjectField[]>>({})
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState({ top: 0, left: 0, lineHeight: 16 })
  // [start, end) of the token the caret is editing, plus its context.
  const [ctx, setCtx] = useState<{ start: number; end: number; kind: 'object' | 'field' } | null>(
    null,
  )

  // Load sObject list once.
  useEffect(() => {
    unwrap(api.metadata.listObjects())
      .then(setObjects)
      .catch(() => setObjects([]))
  }, [])

  // The object named after the first FROM, used to fetch fields.
  const fromObject = useMemo(() => {
    const m = /\bfrom\s+([a-z0-9_]+)/i.exec(value)
    return m ? m[1] : ''
  }, [value])

  // Fetch (and cache) fields for the active FROM object.
  useEffect(() => {
    const key = fromObject.toLowerCase()
    if (!key) return
    const known = objects.find((o) => o.name.toLowerCase() === key)
    if (!known || fields[known.name]) return
    unwrap(api.metadata.describeObject(known.name))
      .then((f) => setFields((prev) => ({ ...prev, [known.name]: f })))
      .catch(() => {})
  }, [fromObject, objects, fields])

  const resolvedFields = useMemo(() => {
    const hit = objects.find((o) => o.name.toLowerCase() === fromObject.toLowerCase())
    return hit ? fields[hit.name] ?? [] : []
  }, [objects, fields, fromObject])

  // Build the suggestion list for the current token.
  const items = useMemo<Suggestion[]>(() => {
    if (!ctx) return []
    const token = value.slice(ctx.start, ctx.end).toLowerCase()
    const limit = fuzzyThreshold(token.length)
    // Rank candidates: exact < prefix < substring < fuzzy (see matchScore).
    const rank = <T,>(items: T[], name: (t: T) => string, label: (t: T) => string) =>
      items
        .map((t) => ({ t, score: token ? bestMatch(token, name(t).toLowerCase(), label(t).toLowerCase()) : 0 }))
        .filter((s) => !token || s.score < 1000 || s.score - 1000 <= limit)
        .sort((a, b) => a.score - b.score || name(a.t).localeCompare(name(b.t)))

    if (ctx.kind === 'object') {
      return rank(objects, (o) => o.name, (o) => o.label)
        .slice(0, 200)
        .map(({ t }) => ({ value: t.name, detail: t.label, kind: 'object' as const }))
    }
    const fieldHits: Suggestion[] = rank(resolvedFields, (f) => f.name, (f) => f.label).map(({ t }) => ({
      value: t.name,
      detail: `${t.label} · ${t.type}`,
      kind: 'field' as const,
    }))
    const kwHits: Suggestion[] = KEYWORDS.filter((k) => token && k.toLowerCase().startsWith(token)).map(
      (k) => ({ value: k, kind: 'keyword' as const }),
    )
    return [...fieldHits, ...kwHits].slice(0, 200)
  }, [ctx, value, objects, resolvedFields])

  // Recompute the editing token + context from the live caret.
  function refresh() {
    const el = taRef.current
    if (!el) return
    const caret = el.selectionStart
    if (caret !== el.selectionEnd) return close() // skip on selection
    const before = el.value.slice(0, caret)
    const tokenMatch = /[a-z0-9_]*$/i.exec(before)
    const token = tokenMatch ? tokenMatch[0] : ''
    const start = caret - token.length
    const after = el.value.slice(caret)
    const tail = /^[a-z0-9_]*/i.exec(after)
    const end = caret + (tail ? tail[0].length : 0)

    const isObject = /\bfrom\s+[a-z0-9_]*$/i.test(before)
    const kind: 'object' | 'field' = isObject ? 'object' : 'field'
    // Field context needs a known FROM object; objects always available.
    if (kind === 'field' && resolvedFields.length === 0 && token.length === 0) return close()
    if (token.length === 0 && kind === 'field') return close()

    setCtx({ start, end, kind })
    setPos(caretCoords(el, start))
    setActive(0)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setCtx(null)
  }

  function accept(s: Suggestion) {
    const el = taRef.current
    if (!el || !ctx) return
    const insert = s.kind === 'keyword' && !s.value.endsWith('()') ? s.value + ' ' : s.value
    const next = value.slice(0, ctx.start) + insert + value.slice(ctx.end)
    onChange(next)
    close()
    const caretAt = ctx.start + insert.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caretAt, caretAt)
    })
  }

  const showing = open && items.length > 0

  return (
    <div className="soql-wrap">
      <textarea
        ref={taRef}
        className="soql"
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        rows={rows ?? 5}
        onChange={(e) => {
          onChange(e.target.value)
          // refresh after state flushes so caret/value are current
          requestAnimationFrame(refresh)
        }}
        onClick={refresh}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refresh()
        }}
        onBlur={() => requestAnimationFrame(close)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            close()
            onSubmit?.()
            return
          }
          if (!showing) {
            if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              refresh()
            }
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            accept(items[active])
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      {showing && (
        <ul
          className="soql-suggest"
          role="listbox"
          style={{ top: pos.top + pos.lineHeight, left: pos.left }}
        >
          {items.map((s, i) => (
            <li
              key={s.kind + s.value}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(s)
              }}
            >
              <span className={`soql-kind k-${s.kind}`}>
                {s.kind === 'object' ? 'O' : s.kind === 'field' ? 'F' : 'K'}
              </span>
              <span className="combo-name">{s.value}</span>
              {s.detail && <span className="combo-label">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
