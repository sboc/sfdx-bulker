import { useEffect, useState } from 'react'
import { api } from './api'
import type { JobInfo, OrgIdentity } from './shared/types'
import { ConnectBar } from './components/ConnectBar'
import { LoadPanel } from './components/LoadPanel'
import { ExtractPanel } from './components/ExtractPanel'
import { MonitorPanel } from './components/MonitorPanel'
import { JobsPanel } from './components/JobsPanel'
import { EMPTY_JOB_FILTERS, type JobFilters } from './components/jobFilters'
import './App.css'

type Tab = 'load' | 'extract' | 'jobs' | 'monitor'

const TABS: { id: Tab; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'extract', label: 'Extract' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'monitor', label: 'Monitor' },
]

function App() {
  const [org, setOrg] = useState<OrgIdentity | null>(null)
  const [tab, setTab] = useState<Tab>('load')
  const [trackedJobs, setTrackedJobs] = useState<JobInfo[]>([])
  // Jobs-tab cache + filters, lifted here so they survive tab switches. null = never loaded.
  const [orgJobs, setOrgJobs] = useState<JobInfo[] | null>(null)
  const [jobFilters, setJobFilters] = useState<JobFilters>(EMPTY_JOB_FILTERS)
  const [ready, setReady] = useState(false)

  // Track a job submitted this session, newest first, deduped by id.
  const trackJob = (job: JobInfo) =>
    setTrackedJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)])
  const dismissJob = (id: string) => setTrackedJobs((prev) => prev.filter((j) => j.id !== id))

  // Switching orgs invalidates the cached org-jobs list (it is org-specific).
  const changeOrg = (o: OrgIdentity | null) => {
    setOrg(o)
    setOrgJobs(null)
    setJobFilters(EMPTY_JOB_FILTERS)
  }

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
        <ConnectBar org={org} onChange={changeOrg} />
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
                {t.id === 'monitor' && trackedJobs.length > 0 && (
                  <span className="tab-badge">{trackedJobs.length}</span>
                )}
              </button>
            ))}
          </nav>
          <main className="content">
            {tab === 'load' && (
              <LoadPanel
                onSubmitted={trackJob}
                onViewMonitor={() => setTab('monitor')}
              />
            )}
            {tab === 'extract' && <ExtractPanel />}
            {tab === 'jobs' && (
              <JobsPanel
                jobs={orgJobs}
                onJobs={setOrgJobs}
                filters={jobFilters}
                onFilters={setJobFilters}
                onTrack={trackJob}
                onViewMonitor={() => setTab('monitor')}
              />
            )}
            {tab === 'monitor' && (
              <MonitorPanel jobs={trackedJobs} onTrack={trackJob} onDismiss={dismissJob} />
            )}
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
