# SFDX Bulker

Desktop app (Electron + React) for running **Salesforce Bulk API 2.0** jobs against any org.

| Tab | What it does |
|-----|--------------|
| **Load** | `insert` · `update` · `upsert` · `delete` · `hardDelete` from a CSV file |
| **Extract** | Run a SOQL query as a bulk query job, preview and save results to CSV |
| **Monitor** | Track jobs submitted this session, poll each for live progress, view/save successful · failed · unprocessed records, abort |

The Salesforce browser SDK can't call the Bulk API directly (CORS), so all API
calls run in the Electron **main process**. Tokens are stored encrypted on disk
via Electron `safeStorage`.

## Setup

### Prerequisites

Install the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli)
(`sf`). Auth is handled through it - the app is a GUI over `sf org`.

### 1. Run

```bash
npm install
npm run dev        # launches Vite + Electron with hot reload
```

### 2. Add an org

- Orgs already authenticated in your CLI (`sf org login web`) appear in the org
  dropdown automatically - nothing to configure.
- To add a new one: **Orgs → Add org** → optional alias + login host (Production /
  Sandbox / Custom My Domain) → **Open browser to log in**. This runs
  `sf org login web`; complete the login in your browser and the org appears.

Pick an org from the dropdown and **Connect**. Switch between them anytime. The CLI
handles token refresh; the app caches each org's session encrypted on disk.

> Legacy **Client Credentials** orgs (Consumer Key/Secret) remain connectable if you
> have any saved, but new orgs are added via the CLI.

## Build

```bash
npm run build      # type-check + bundle renderer, main, preload
npm run dist        # package a distributable via electron-builder
```

## Test

```bash
npm test           # run the Vitest suite once
npm run test:watch # watch mode
```

Vitest covers the pure logic (CSV build/parse, org-URL handling, CLI org-list
parsing, job-info mapping) in a node environment, plus jsdom + Testing Library
component tests for `ConnectBar` and `LoadPanel`.

## Operations notes

- **Field mapping**: after picking the object + CSV, the Load tab fetches the
  object's fields and auto-maps each CSV column (by API name or label). Adjust
  any mapping or set a column to *ignore*; the CSV is rewritten to field API
  names before upload. If fields can't be loaded, the CSV is sent as-is.
- **update / delete / hardDelete** require a column mapped to `Id`.
- **upsert** requires an external Id field (chosen from the object's external-id
  fields) with a column mapped to it.
- **hardDelete** permanently deletes records (bypasses the recycle bin) and
  needs the *Bulk API Hard Delete* user permission.
- Jobs are submitted asynchronously - each submitted job is added to the
  **Monitor** tab, which polls it for completion and lets you view and save the
  successful / failed / unprocessed records. The tracked list is per session.

## Architecture

```
src/                React renderer (UI only, talks via window.api IPC bridge)
  components/        Load / Extract / Monitor panels + ConnectBar
  shared/types.ts    IPC contract shared with main process
electron/
  main.ts            BrowserWindow + IPC handlers + file dialogs
  preload.ts         contextBridge exposing the typed API
  sfcli.ts           Salesforce CLI bridge: list / login / logout / token
  oauth.ts           OAuth 2.0 Client Credentials token request (legacy orgs)
  salesforce.ts      jsforce Bulk API 2.0: ingest, query, job monitor
  store.ts           encrypted per-org session + config persistence
```

Stack: Electron 33, React 19, Vite 8, TypeScript, [jsforce](https://jsforce.github.io/) 3.
