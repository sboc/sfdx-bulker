import { useEffect, useMemo, useState } from 'react'
import { api, unwrap } from '../api'
import { parseCsvPreview, remapCsv } from '../shared/csv'
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

  // Describe the chosen object + auto-map its fields to the CSV columns.
  useEffect(() => {
    if (!preview || !objects.some((o) => o.name === object)) return
    let cancelled = false
    const t = setTimeout(() => {
      setFieldsError(null)
      api.metadata.describeObject(object).then((r) => {
        if (cancelled) return
        if (r.ok) {
          const f = r.data ?? []
          setFields(f)
          setFieldsObject(object)
          setMapping(autoMap(preview.columns, f))
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

  async function pickFile() {
    const f = await unwrap(api.files.openCsv())
    if (f) {
      setFile(f)
      setJob(null)
      setError(null)
      // Delete only needs the record Id - auto-pick the column that looks like it.
      const cols = parseCsvPreview(f.content)?.columns ?? []
      setIdColumn(cols.find((c) => norm(c) === 'id') ?? '')
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
            <input
              list="sobject-list"
              value={object}
              onChange={(e) => setObject(e.target.value)}
              placeholder={
                objectsError
                  ? 'Type an API name…'
                  : objects.length
                    ? `Search ${objects.length} objects…`
                    : 'Loading objects…'
              }
              autoComplete="off"
            />
            <datalist id="sobject-list">
              {objects.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.label}
                </option>
              ))}
            </datalist>
          </label>
          {operation === 'upsert' && (
            <label>
              External Id field
              {externalIdFields.length > 0 ? (
                <select value={externalId} onChange={(e) => setExternalId(e.target.value)}>
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
            {file ? `📄 ${file.name}` : 'Choose CSV file…'}
          </button>
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

      {error && <div className="banner error">{error}</div>}
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
