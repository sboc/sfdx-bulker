import { useCallback, useEffect, useState } from 'react'
import { api, unwrap } from '../api'
import { resolveLoginUrl, type LoginMode } from '../shared/orgUrl'
import type { OrgIdentity, SavedOrgView } from '../shared/types'

interface Props {
  org: OrgIdentity | null
  onChange: (org: OrgIdentity | null) => void
}

export function ConnectBar({ org, onChange }: Props) {
  const [orgs, setOrgs] = useState<SavedOrgView[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const refresh = useCallback(async () => {
    const r = await api.auth.listConnectable()
    if (r.ok) setOrgs(r.data ?? [])
  }, [])

  useEffect(() => {
    const t = setTimeout(refresh, 0)
    return () => clearTimeout(t)
  }, [refresh])

  const connected = orgs.find((o) => o.connected) ?? null
  // No first-org fallback - force an explicit pick (placeholder) until the user chooses.
  const activeSelectId = selectedId || connected?.id || ''
  const selected = orgs.find((o) => o.id === activeSelectId) ?? null

  async function connect() {
    if (!selected) return
    setError(null)
    setBusy(true)
    try {
      const id = await unwrap(api.auth.connect(selected.id))
      onChange(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    await unwrap(api.auth.disconnect())
    onChange(null)
    await refresh()
  }

  const isConnectedSelection = !!selected?.connected && !!org

  return (
    <div className="connectbar">
      {orgs.length > 0 && (
        <select
          className="org-select"
          aria-label="Org"
          value={activeSelectId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="" disabled hidden>
            Select an org…
          </option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.connected ? ' ●' : ''}
            </option>
          ))}
        </select>
      )}

      {error && <span className="inline-error">{error}</span>}

      {isConnectedSelection ? (
        <button className="btn ghost" onClick={disconnect}>
          Disconnect
        </button>
      ) : (
        orgs.length > 0 && (
          <button
            className="btn primary"
            onClick={connect}
            disabled={busy || !selected || !selected.canConnect}
            title={selected && !selected.canConnect ? 'Add a Consumer Secret first' : undefined}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        )
      )}

      <button className="btn ghost" onClick={() => setShowModal(true)}>
        {orgs.length ? 'Orgs' : 'Add org'}
      </button>

      {showModal && (
        <OrgsModal
          onClose={() => {
            setShowModal(false)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function OrgsModal({ onClose }: { onClose: () => void }) {
  const [orgs, setOrgs] = useState<SavedOrgView[]>([])
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await api.auth.listConnectable()
    if (r.ok) setOrgs(r.data ?? [])
  }, [])

  useEffect(() => {
    const t = setTimeout(reload, 0)
    return () => clearTimeout(t)
  }, [reload])

  async function remove(o: SavedOrgView) {
    if (!confirm(`Delete saved org “${o.name}”?`)) return
    setBusyId(o.id)
    try {
      await unwrap(api.auth.deleteOrg(o.id))
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  async function logout(o: SavedOrgView) {
    if (!o.cliUsername) return
    if (!confirm(`Log “${o.name}” out of the Salesforce CLI?`)) return
    setBusyId(o.id)
    try {
      await unwrap(api.auth.logoutCli(o.cliUsername))
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  if (adding) {
    return (
      <LoginForm
        onCancel={() => setAdding(false)}
        onDone={async () => {
          setAdding(false)
          await reload()
        }}
      />
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Orgs</h2>
        <p className="hint">
          Log in to add an org via the <code>sf</code> CLI. Logged-in orgs are available everywhere
          in the app.
        </p>
        {orgs.length === 0 && <p className="hint">No orgs yet. Add one to get started.</p>}
        <div className="org-list">
          {orgs.map((o) => (
            <div key={o.id} className="org-row">
              <div className="org-row-meta">
                <span className="org-row-name">
                  {o.name}
                  {o.connected ? ' ●' : ''}
                </span>
              </div>
              <div className="org-row-actions">
                <span className="src-tag">
                  {o.source === 'cli' ? 'CLI' : o.source === 'oauth' ? 'Browser' : 'Client Creds'}
                </span>
                {o.source === 'cli' ? (
                  <button className="link danger" disabled={busyId === o.id} onClick={() => logout(o)}>
                    {busyId === o.id ? 'Logging out…' : 'Log out'}
                  </button>
                ) : (
                  <button className="link danger" disabled={busyId === o.id} onClick={() => remove(o)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add org
          </button>
        </div>
      </div>
    </div>
  )
}

function LoginForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [alias, setAlias] = useState('')
  const [mode, setMode] = useState<LoginMode>('production')
  const [customDomain, setCustomDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // null = still detecting. Decides whether to log in via the CLI or directly in-app.
  const [hasCli, setHasCli] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    void api.auth.cliAvailable().then((r) => {
      if (live) setHasCli(r.ok ? !!r.data : false)
    })
    return () => {
      live = false
    }
  }, [])

  const instanceUrl = resolveLoginUrl(mode, customDomain)

  async function login() {
    setError(null)
    setBusy(true)
    try {
      const opts = { alias: alias.trim() || undefined, instanceUrl }
      if (hasCli) await unwrap(api.auth.loginCli(opts))
      else await unwrap(api.auth.loginWeb(opts))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add org</h2>
        <p className="hint">
          {hasCli ? (
            <>
              Logs in through the <code>sf</code> CLI - this opens your browser to the Salesforce
              login. Complete it there and the org appears here.
            </>
          ) : (
            <>Opens your browser to sign in to Salesforce - no Salesforce CLI required.</>
          )}
        </p>
        <label>
          Alias (optional)
          <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="prod, uat…" />
        </label>
        <label>
          Login host
          <select value={mode} onChange={(e) => setMode(e.target.value as LoginMode)}>
            <option value="production">Production / Developer (login.salesforce.com)</option>
            <option value="sandbox">Sandbox (test.salesforce.com)</option>
            <option value="custom">Custom My Domain…</option>
          </select>
        </label>
        {mode === 'custom' && (
          <label>
            My Domain URL
            <input
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="mycompany.my.salesforce.com"
            />
            {customDomain.trim() && <span className="hint">Will use {instanceUrl}</span>}
          </label>
        )}
        {busy && <div className="banner success">Waiting for browser login - complete it in your browser.</div>}
        {error && <div className="banner error">{error}</div>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={login}
            disabled={busy || !instanceUrl || hasCli === null}
          >
            {busy ? 'Waiting…' : 'Open browser to log in'}
          </button>
        </div>
      </div>
    </div>
  )
}
