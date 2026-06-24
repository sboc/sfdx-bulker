import { useEffect, useMemo, useRef, useState } from 'react'
import { api, unwrap } from '../api'
import { combineCsvs, parseCsvPreview, remapCsv } from '../shared/csv'
import type { BulkOperation, JobInfo, LineEnding, SObjectField, SObjectInfo } from '../shared/types'

const OPERATIONS: { id: BulkOperation; label: string; desc: string }[] = [
  { id: 'insert', label: 'Insert', desc: 'Create new records' },
  { id: 'update', label: 'Update', desc: 'Update existing records (needs Id column)' },
  { id: 'upsert', label: 'Upsert', desc: 'Insert or update by external Id' },
  { id: 'delete', label: 'Delete', desc: 'Move records to recycle bin (needs Id column)' },
  { id: 'hardDelete', label: 'Hard Delete', desc: 'Permanently delete - bypasses recycle bin' },
]

const IDS_NEEDED = new Set<BulkOperation>(['update', 'delete', 'hardDelete'])
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Auto-match CSV columns to field API names / labels. */
function autoMap(columns: string[], fields: SObjectField[]): Record<string, string> {
  const byKey = new Map<string, string>()
  for (const f of fields) {
    byKey.set(norm(f.name), f.name)
    if (!byKey.has(norm(f.label))) byKey.set(norm(f.label), f.name)
  }
  const m: Record<string, string> = {}
  for (const c of columns) m[c] = byKey.get(norm(c)) ?? ''
  return m
}

export function LoadPanel({
  onSubmitted,
  onViewMonitor,
}: {
  onSubmitted?: (job: JobInfo) => void
  onViewMonitor?: () => void
}) {
  const [object, setObject] = useState('')
  const [objects, setObjects] = useState<SObjectInfo[]>([])
  const [objectsError, setObjectsError] = useState<string | null>(null)
  const [operation, setOperation] = useState<BulkOperation>('insert')
  const [externalId, setExternalId] = useState('')
  const [lineEnding] = useState<LineEnding>('LF')
  const [file, setFile] = useState<{ name: string; content: string } | null>(null)
  // Files picked that couldn't be combined strictly - offer a shared-columns combine.
  const [mismatched, setMismatched] = useState<{ name: string; content: string }[] | null>(null)
  const [fields, setFields] = useState<SObjectField[]>([])
  const [fieldsObject, setFieldsObject] = useState('')
  const [fieldsError, setFieldsError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [idColumn, setIdColumn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobInfo | null>(null)

  const preview = useMemo(() => parseCsvPreview(file?.content), [file])
  const mapReady = fields.length > 0 && fieldsObject === object && !!preview
  const destructive = operation === 'delete' || operation === 'hardDelete'

  useEffect(() => {
    api.metadata.listObjects().then((r) => {
      if (r.ok) setObjects(r.data ?? [])
      else setObjectsError(r.error ?? 'Failed to load objects')
    })
  }, [])

  // Describe the chosen object (so the field/external-Id dropdowns populate even
  // before a file is picked); auto-map to the CSV columns once a file is present.
  useEffect(() => {
    if (!objects.some((o) => o.name === object)) return
    let cancelled = false
    const t = setTimeout(() => {
      setFieldsError(null)
      api.metadata.describeObject(object).then((r) => {
        if (cancelled) return
        if (r.ok) {
          const f = r.data ?? []
          setFields(f)
          setFieldsObject(object)
          if (preview) setMapping(autoMap(preview.columns, f))
        } else {
          setFieldsError(r.error ?? 'Failed to load fields')
        }
      })
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [object, preview, objects])

  const selectableFields = useMemo(
    () => fields.filter((f) => f.createable || f.updateable || f.name === 'Id'),
    [fields],
  )
  const externalIdFields = useMemo(
    () => fields.filter((f) => f.externalId || f.name === 'Id'),
    [fields],
  )
  const mappedCount = preview ? preview.columns.filter((c) => mapping[c]).length : 0
  // Target fields mapped by more than one column (not allowed).
  const duplicateTargets = useMemo(() => {
    const counts = new Map<string, number>()
    if (preview) for (const c of preview.columns) {
      const t = mapping[c]
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([t]) => t))
  }, [preview, mapping])

  function applyFile(chosen: { name: string; content: string }) {
    setFile(chosen)
    // Delete only needs the record Id - auto-pick the column that looks like it.
    const cols = parseCsvPreview(chosen.content)?.columns ?? []
    setIdColumn(cols.find((c) => norm(c) === 'id') ?? '')
  }

  async function pickFile() {
    const picked = await unwrap(api.files.openCsv())
    if (!picked || picked.length === 0) return
    setJob(null)
    setError(null)
    setMismatched(null)
    if (picked.length === 1) return applyFile(picked[0])
    try {
      // Multiple files are combined into one CSV; requires matching headers.
      const { content, rows } = combineCsvs(picked)
      applyFile({ name: `${picked.length} files combined (${rows} rows)`, content })
    } catch (e) {
      // Headers differ - keep the files so the user can opt into a shared-columns combine.
      setFile(null)
      setMismatched(picked)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function combineShared() {
    if (!mismatched) return
    try {
      const { content, rows } = combineCsvs(mismatched, 'shared')
      applyFile({ name: `${mismatched.length} files combined, shared columns (${rows} rows)`, content })
      setMismatched(null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function submit() {
    setError(null)
    setJob(null)
    if (!object.trim()) return setError('Choose a target sObject first.')
    if (!file || !preview) return setError('Choose a CSV file first.')
    if (operation === 'upsert' && !externalId.trim())
      return setError('Upsert requires an external Id field.')

    let csv = file.content
    if (destructive) {
      if (!idColumn) return setError('Choose which column holds the record Id.')
      const targets = preview.columns.map((c) => (c === idColumn ? 'Id' : ''))
      csv = remapCsv(file.content, targets)
    } else if (mapReady) {
      const targets = preview.columns.map((c) => mapping[c] || '')
      if (!targets.some(Boolean)) return setError('Map at least one column to a field.')
      if (duplicateTargets.size > 0)
        return setError(`Each field can be mapped once. Duplicated: ${[...duplicateTargets].join(', ')}.`)
      if (operation === 'upsert' && !targets.includes(externalId))
        return setError(`Map a column to the external Id field "${externalId}".`)
      if (IDS_NEEDED.has(operation) && !targets.includes('Id'))
        return setError(`Map a column to Id for ${operation}.`)
      csv = remapCsv(file.content, targets)
    }

    setBusy(true)
    try {
      const info = await unwrap(
        api.ingest.submit({
          object: object.trim(),
          operation,
          externalIdFieldName: externalId.trim() || undefined,
          csv,
          lineEnding,
        }),
      )
      setJob(info)
      onSubmitted?.(info)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="grid">
        <div className="card">
          <h3>1. Operation</h3>
          <div className="op-list">
            {OPERATIONS.map((op) => (
              <label key={op.id} className={operation === op.id ? 'op selected' : 'op'}>
                <input
                  type="radio"
                  name="op"
                  checked={operation === op.id}
                  onChange={() => setOperation(op.id)}
                />
                <span className="op-label">{op.label}</span>
                <span className="op-desc">{op.desc}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>2. Target</h3>
          <label>
            sObject
            <ObjectSelect
              objects={objects}
              value={object}
              onChange={setObject}
              placeholder={
                objectsError
                  ? 'Type an API name…'
                  : objects.length
                    ? `Search ${objects.length} objects…`
                    : 'Loading objects…'
              }
            />
          </label>
          {operation === 'upsert' && (
            <label>
              External Id field
              {externalIdFields.length > 0 ? (
                <select
                  aria-label="External Id field"
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                >
                  <option value="">Select a field…</option>
                  {externalIdFields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label} ({f.name})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder="External_Id__c"
                />
              )}
            </label>
          )}

          <h3 style={{ marginTop: 20 }}>3. Data</h3>
          <button className="btn ghost full" onClick={pickFile}>
            {file ? `📄 ${file.name}` : 'Choose CSV file(s)…'}
          </button>
          {!file && !mismatched && (
            <p className="hint">Select multiple files to combine them - headers must match.</p>
          )}
          {mismatched && (
            <div className="banner error">
              {error}
              <button className="link" onClick={combineShared}>
                Combine shared columns only
              </button>
            </div>
          )}
          {preview && (
            <div className="preview">
              <div className="preview-meta">
                <strong>{preview.rows}</strong> rows · <strong>{preview.columns.length}</strong> columns
              </div>
            </div>
          )}
        </div>
      </div>

      {preview && (
        <div className="card">
          <h3>4. {destructive ? 'Record Id' : 'Field mapping'}</h3>
          {destructive ? (
            <>
              <p className="hint">
                {operation} only needs the record Id. Pick the column that holds it - other columns
                are ignored.
              </p>
              <label>
                Id column
                <select value={idColumn} onChange={(e) => setIdColumn(e.target.value)}>
                  <option value="">Select a column…</option>
                  {preview.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : !objects.some((o) => o.name === object) ? (
            <p className="hint">Choose a target sObject above to map columns to its fields.</p>
          ) : fieldsError ? (
            <p className="hint">
              Could not load fields ({fieldsError}). The CSV will be sent as-is - its headers must
              be field API names.
            </p>
          ) : !mapReady ? (
            <p className="hint">Loading {object} fields…</p>
          ) : (
            <>
              <div className="preview-meta">
                {mappedCount} of {preview.columns.length} columns mapped
              </div>
              {duplicateTargets.size > 0 && (
                <div className="banner error">
                  Each field can be mapped to only one column. Duplicated:{' '}
                  {[...duplicateTargets].join(', ')}.
                </div>
              )}
              <div className="map-list">
                {preview.columns.map((col) => (
                  <div key={col} className="map-row">
                    <span className="map-src" title={col}>
                      {col}
                    </span>
                    <span className="map-arrow">→</span>
                    <select
                      className={
                        mapping[col]
                          ? duplicateTargets.has(mapping[col])
                            ? 'map-target dupe'
                            : 'map-target'
                          : 'map-target unmapped'
                      }
                      value={mapping[col] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                    >
                      <option value="">— ignore —</option>
                      {selectableFields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label} ({f.name})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {error && !mismatched && <div className="banner error">{error}</div>}
      {job && (
        <div className="banner success">
          <span>
            Job <code>{job.id}</code> submitted - state <strong>{job.state}</strong>.
          </span>
          {onViewMonitor && (
            <button className="link" onClick={onViewMonitor}>
              View in Monitor →
            </button>
          )}
        </div>
      )}

      <div className="actions">
        <button
          className={destructive ? 'btn danger' : 'btn primary'}
          onClick={submit}
          disabled={
            busy ||
            !file ||
            !object.trim() ||
            (destructive ? !idColumn : duplicateTargets.size > 0)
          }
        >
          {busy ? 'Submitting…' : `Run ${operation}`}
        </button>
      </div>
    </div>
  )
}

/** Searchable, scrollable sObject picker (replaces the native datalist). */
function ObjectSelect({
  objects,
  value,
  onChange,
  placeholder,
}: {
  objects: SObjectInfo[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const matches = useMemo(() => {
    const list = q
      ? objects.filter(
          (o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
        )
      : objects
    return list.slice(0, 200)
  }, [objects, q])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function choose(name: string) {
    onChange(name)
    setOpen(false)
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault()
            choose(matches[active].name)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="combo-list" role="listbox">
          {matches.map((o, i) => (
            <li
              key={o.name}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o.name)
              }}
            >
              <span className="combo-name">{o.name}</span>
              <span className="combo-label">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
