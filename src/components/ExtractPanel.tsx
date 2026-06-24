import { useState } from 'react'
import { api, unwrap } from '../api'
import { SoqlEditor } from './SoqlEditor'

export function ExtractPanel() {
  const [soql, setSoql] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ csv: string; rows: number } | null>(null)

  async function run() {
    setError(null)
    setResult(null)
    setBusy(true)
    try {
      const r = await unwrap(api.query.submit({ soql: soql.trim() }))
      setResult({ csv: r.csv, rows: r.rows })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!result) return
    try {
      await unwrap(api.files.saveCsv('extract.csv', result.csv))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="panel extract">
      <div className="card">
        <h3>SOQL query</h3>
        <SoqlEditor
          value={soql}
          onChange={setSoql}
          onSubmit={() => {
            if (!busy && soql.trim()) run()
          }}
          placeholder="SELECT Id, Name FROM Object LIMIT 1000"
          rows={5}
        />
        <p className="hint">
          Autocomplete: objects after <code>FROM</code>, fields elsewhere. Ctrl/⌘+Space to trigger,
          Ctrl/⌘+Enter to run.
        </p>
        <div className="actions left">
          <button className="btn primary" onClick={run} disabled={busy || !soql.trim()}>
            {busy ? 'Running…' : 'Run query'}
          </button>
          {result && (
            <button className="btn ghost" onClick={save}>
              Save CSV ({result.rows} rows)
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {result && (
        <div className="card results">
          <h3>{result.rows} rows</h3>
          {result.rows === 0 ? (
            <p className="hint">No records returned.</p>
          ) : (
            <pre className="csv-preview">{result.csv}</pre>
          )}
        </div>
      )}
    </div>
  )
}
