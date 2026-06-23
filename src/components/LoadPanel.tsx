import { useEffect, useMemo, useState } from 'react'
import { api, unwrap } from '../api'
import { parseCsvPreview } from '../shared/csv'
import type { BulkOperation, JobInfo, LineEnding, SObjectInfo } from '../shared/types'

const OPERATIONS: { id: BulkOperation; label: string; desc: string }[] = [
  { id: 'insert', label: 'Insert', desc: 'Create new records' },
  { id: 'update', label: 'Update', desc: 'Update existing records (needs Id column)' },
  { id: 'upsert', label: 'Upsert', desc: 'Insert or update by external Id' },
  { id: 'delete', label: 'Delete', desc: 'Move records to recycle bin (needs Id column)' },
  { id: 'hardDelete', label: 'Hard Delete', desc: 'Permanently delete - bypasses recycle bin' },
]

export function LoadPanel() {
  const [object, setObject] = useState('')
  const [objects, setObjects] = useState<SObjectInfo[]>([])
  const [objectsError, setObjectsError] = useState<string | null>(null)
  const [operation, setOperation] = useState<BulkOperation>('insert')
  const [externalId, setExternalId] = useState('')
  const [lineEnding] = useState<LineEnding>('LF')
  const [file, setFile] = useState<{ name: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobInfo | null>(null)

  const preview = useMemo(() => parseCsvPreview(file?.content), [file])

  useEffect(() => {
    api.metadata.listObjects().then((r) => {
      if (r.ok) setObjects(r.data ?? [])
      else setObjectsError(r.error ?? 'Failed to load objects')
    })
  }, [])

  async function pickFile() {
    const f = await unwrap(api.files.openCsv())
    if (f) {
      setFile(f)
      setJob(null)
      setError(null)
    }
  }

  async function submit() {
    setError(null)
    setJob(null)
    if (!object.trim()) return setError('Choose a target sObject first.')
    if (!file) return setError('Choose a CSV file first.')
    if (operation === 'upsert' && !externalId.trim())
      return setError('Upsert requires an external Id field name.')
    setBusy(true)
    try {
      const info = await unwrap(
        api.ingest.submit({
          object: object.trim(),
          operation,
          externalIdFieldName: externalId.trim() || undefined,
          csv: file.content,
          lineEnding,
        }),
      )
      setJob(info)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const destructive = operation === 'delete' || operation === 'hardDelete'

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
              <input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="External_Id__c"
              />
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
              <div className="chips">
                {preview.columns.slice(0, 12).map((c) => (
                  <span key={c} className="chip">
                    {c}
                  </span>
                ))}
                {preview.columns.length > 12 && <span className="chip more">+{preview.columns.length - 12}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}
      {job && (
        <div className="banner success">
          Job <code>{job.id}</code> submitted - state <strong>{job.state}</strong>. Track it in the Monitor tab.
        </div>
      )}

      <div className="actions">
        <button
          className={destructive ? 'btn danger' : 'btn primary'}
          onClick={submit}
          disabled={busy || !file || !object.trim()}
        >
          {busy ? 'Submitting…' : `Run ${operation}`}
        </button>
      </div>
    </div>
  )
}

