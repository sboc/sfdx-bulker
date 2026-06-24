# SFDX Bulker

Desktop app (Electron + React) for running **Salesforce Bulk API 2.0** jobs against any org.

| Tab | What it does |
|-----|--------------|
| **Load** | `insert` · `update` · `upsert` · `delete` · `hardDelete` from a CSV file |
| **Extract** | Write a SOQL query (with object/field autocomplete) and run it as a bulk query job, preview and save results to CSV |
| **Jobs** | List **every** ingest + query job in the org (all pages), filter by object, operation, state, and created-date range, then send any job to the Monitor or abort it |
| **Monitor** | Track jobs submitted this session, poll each for live progress, view/save successful · failed · unprocessed records, abort, and fix & resubmit failed records |

The Salesforce browser SDK can't call the Bulk API directly (CORS), so all API
calls run in the Electron **main process**. Tokens are stored encrypted on disk
via Electron `safeStorage`.

## Setup

### Prerequisites

None required. The [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli)
(`sf`) is **optional**: if installed, the app reuses its authenticated orgs and its
`sf org login web` flow. If not, the app runs the same browser login itself (OAuth
2.0 Authorization Code + PKCE against the public `PlatformCLI` connected app) - no
CLI, no connected-app setup.

### 1. Run

```bash
npm install
npm run dev        # launches Vite + Electron with hot reload
```

### 2. Add an org

- If the `sf` CLI is installed, orgs already authenticated in it appear in the org
  dropdown automatically - nothing to configure.
- To add a new one: **Orgs → Add org** → optional alias + login host (Production /
  Sandbox / Custom My Domain) → **Open browser to log in**. Complete the login in
  your browser and the org appears. With the CLI present this runs `sf org login web`;
  without it the app runs the OAuth flow directly (tagged **Browser** in the org list).

Pick an org from the dropdown and **Connect**. Switch between them anytime. The app
caches each org's session encrypted on disk and refreshes tokens automatically - via
the CLI for CLI orgs, via the stored refresh token for **Browser** orgs.

> Legacy **Client Credentials** orgs (Consumer Key/Secret) remain connectable if you
> have any saved.

## Build

```bash
npm run build      # type-check + bundle renderer, main, preload
npm run dist        # package a distributable via electron-builder -> release/
```

`npm run dist` produces `release/SFDX Bulker-<version>.AppImage`. AppImages don't
self-install, so file managers show a generic AppImage icon until integrated. To
add a launcher menu entry with the proper icon:

```bash
scripts/install-desktop.sh              # add menu entry + icon
scripts/install-desktop.sh --uninstall  # remove it
```

## Test

```bash
npm test           # run the Vitest suite once
npm run test:watch # watch mode
```

Vitest covers the pure logic (CSV build/parse, fuzzy matching, org-URL handling,
CLI org-list parsing, job-info mapping, encrypted store, PATH recovery, OAuth token
grants, and the PKCE web-login loopback flow) in a node environment, plus jsdom +
Testing Library component tests for `ConnectBar`, `LoadPanel`, `ExtractPanel`,
`JobsPanel`, and `MonitorPanel`.

## Operations notes

- **Load wizard**: Load is a two-step flow - **Configure** (operation, target
  sObject, CSV file) then **Field mapping & run**. Step 2 unlocks once an object
  and file (and external Id, for upsert) are set.
- **Searchable pickers**: the sObject selector and every field dropdown
  (external Id, Id column, mapping targets) are fuzzy-searchable - type to filter
  with typo tolerance (Levenshtein), ranked exact → prefix → substring → fuzzy.
- **SOQL autocomplete**: the Extract editor suggests sObjects after `FROM`,
  fields of the queried object elsewhere, plus SOQL keywords. `Ctrl/Cmd+Space`
  triggers it, `Ctrl/Cmd+Enter` runs the query.
- **Field mapping**: after picking the object + CSV, the Load tab fetches the
  object's fields and auto-maps each CSV column (by API name or label). Adjust
  any mapping or set a column to *ignore*; the CSV is rewritten to field API
  names before upload. If fields can't be loaded, the CSV is sent as-is.
- **update** requires a column mapped to `Id`.
- **delete / hardDelete** only need the record `Id`, so they skip field mapping -
  just pick which CSV column holds the Id (auto-selected if a column is named
  `Id`) and a one-column CSV is submitted.
- **upsert** requires an external Id field (chosen from the object's external-id
  fields) with a column mapped to it.
- **hardDelete** permanently deletes records (bypasses the recycle bin) and
  needs the *Bulk API Hard Delete* user permission.
- Jobs are submitted asynchronously - each submitted job is added to the
  **Monitor** tab, which polls it for completion and lets you view and save the
  successful / failed / unprocessed records. The tracked list is per session.
- **Jobs tab**: fetches every ingest + query job in the org via the Bulk API
  "Get all jobs" endpoints (following pagination across all pages), newest first.
  Filter by object (searchable picker), operation, state, and a created-date
  range; **Monitor** sends a job to the Monitor tab for live status, **Abort**
  cancels an active one. The list + filters are cached, so leaving and returning
  to the tab keeps state; **Refresh** reloads on demand, and switching org clears
  the cache.
- **Fix & retry**: in a failed-results view, the Monitor groups the distinct
  error messages and lets you select error groups, then resubmits just those
  rows as a new job - replacing exact cell values (with a dropdown of the
  column's errored values, or mapping a value to null), remapping a column to a
  different field, or dropping a column. Upserts can pick the external Id key.

## Architecture

```
src/                React renderer (UI only, talks via window.api IPC bridge)
  components/        Load / Extract / Jobs / Monitor panels + ConnectBar
                     SoqlEditor (autocomplete) + Combo (fuzzy picker)
  shared/types.ts    IPC contract shared with main process
  shared/csv.ts      CSV parse / combine / remap helpers
  shared/fuzzy.ts    Levenshtein fuzzy match + ranking
electron/
  main.ts            BrowserWindow + IPC handlers + file dialogs
  preload.ts         contextBridge exposing the typed API
  sfcli.ts           Salesforce CLI bridge: list / login / logout / token / availability
  web-oauth.ts       CLI-free browser login: OAuth Authorization Code + PKCE, loopback
  oauth.ts           OAuth token endpoint: client-credentials + refresh-token grants
  salesforce.ts      jsforce Bulk API 2.0: ingest, query, job monitor
  store.ts           encrypted per-org session + config persistence
```

Stack: Electron 33, React 19, Vite 8, TypeScript, [jsforce](https://jsforce.github.io/) 3.
