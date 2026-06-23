import { useState } from 'react'
import { api, unwrap } from '../api'

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
    await unwrap(api.files.saveCsv('extract.csv', result.csv))
  }

  const previewLines = result ? result.csv.split('\n').slice(0, 30) : []

  return (
    <div className="panel">
      <div className="card">
        <h3>SOQL query</h3>
        <textarea
          className="soql"
          value={soql}
          spellCheck={false}
          onChange={(e) => setSoql(e.target.value)}
          placeholder="SELECT Id, Name FROM Object LIMIT 1000"
          rows={5}
        />
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
        <div className="card">
          <h3>{result.rows} rows</h3>
          {result.rows === 0 ? (
            <p className="hint">No records returned.</p>
          ) : (
            <pre className="csv-preview">{previewLines.join('\n')}
{result.csv.split('\n').length > 30 ? '\n…' : ''}</pre>
          )}
        </div>
      )}
    </div>
  )
}
