import { useEffect, useState } from 'react'
import { api } from './api'
import type { OrgIdentity } from './shared/types'
import { ConnectBar } from './components/ConnectBar'
import { LoadPanel } from './components/LoadPanel'
import { ExtractPanel } from './components/ExtractPanel'
import { MonitorPanel } from './components/MonitorPanel'
import './App.css'

type Tab = 'load' | 'extract' | 'monitor'

const TABS: { id: Tab; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'extract', label: 'Extract' },
  { id: 'monitor', label: 'Monitor' },
]

function App() {
  const [org, setOrg] = useState<OrgIdentity | null>(null)
  const [tab, setTab] = useState<Tab>('load')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    api.auth.current().then((o) => {
      setOrg(o)
      setReady(true)
    })
  }, [])

  if (!ready) return <div className="boot">Loading…</div>

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⛛</span>
          <div>
            <h1>SFDX Bulker</h1>
            <p>Salesforce Bulk API 2.0</p>
          </div>
        </div>
        <ConnectBar org={org} onChange={setOrg} />
      </header>

      {org ? (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'tab active' : 'tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <main className="content">
            {tab === 'load' && <LoadPanel />}
            {tab === 'extract' && <ExtractPanel />}
            {tab === 'monitor' && <MonitorPanel />}
          </main>
        </>
      ) : (
        <Disconnected />
      )}
    </div>
  )
}

function Disconnected() {
  return (
    <div className="empty">
      <h2>Not connected</h2>
      <p>Configure your Connected App and sign in to a Salesforce org to start running bulk jobs.</p>
    </div>
  )
}

export default App
