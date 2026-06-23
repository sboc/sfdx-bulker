import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { deleteOrg } from './store'
import { loginCliOrg, logoutCliOrg } from './sfcli'
import { fixPathEnv } from './path-env'
import {
  abortJob,
  connect,
  currentIdentity,
  deleteJob,
  describeObject,
  disconnect,
  forgetCliSession,
  ingestResults,
  jobStatus,
  listConnectableOrgs,
  listObjects,
  submitIngest,
  submitQuery,
} from './salesforce'
import type {
  IngestJobRequest,
  IpcResult,
  QueryJobRequest,
  ResultKind,
} from '../src/shared/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

// vite-plugin-electron sets these. dist-electron is one level under project root.
process.env.APP_ROOT = join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'SFDX Bulker',
    backgroundColor: '#0b1221',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    void win.loadFile(join(RENDERER_DIST, 'index.html'))
  }
}

// ---- IPC plumbing ----

/** Wrap a handler so it always resolves to an IpcResult<T>. */
function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) } satisfies IpcResult<T>
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) } satisfies IpcResult<T>
    }
  })
}

function registerIpc(): void {
  // auth
  ipcMain.handle('auth:current', () => currentIdentity())
  handle('auth:listConnectable', () => listConnectableOrgs())
  handle('auth:deleteOrg', (id) => {
    deleteOrg(id as string)
    return null
  })
  handle('auth:connect', (id) => connect(id as string))
  handle('auth:disconnect', () => {
    disconnect()
    return null
  })
  handle('auth:loginCli', (opts) => loginCliOrg(opts as { alias?: string; instanceUrl: string }))
  handle('auth:logoutCli', async (username) => {
    await logoutCliOrg(username as string)
    forgetCliSession(username as string)
    return null
  })

  // metadata
  handle('metadata:listObjects', () => listObjects())
  handle('metadata:describeObject', (object) => describeObject(object as string))

  // ingest
  handle('ingest:submit', (req) => submitIngest(req as IngestJobRequest))
  handle('ingest:results', (jobId, kind) => ingestResults(jobId as string, kind as ResultKind))

  // query
  handle('query:submit', (req) => submitQuery(req as QueryJobRequest))

  // jobs
  handle('jobs:status', (jobId) => jobStatus(jobId as string))
  handle('jobs:abort', async (jobId) => {
    await abortJob(jobId as string)
    return null
  })
  handle('jobs:delete', async (jobId) => {
    await deleteJob(jobId as string)
    return null
  })

  // files
  handle('files:openCsv', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const path = r.filePaths[0]
    return { name: basename(path), content: readFileSync(path, 'utf8') }
  })
  handle('files:saveCsv', async (defaultName, content) => {
    const r = await dialog.showSaveDialog({
      defaultPath: defaultName as string,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, content as string, 'utf8')
    return { path: r.filePath }
  })
}

app.whenReady().then(() => {
  // Packaged GUI launches get a minimal PATH; recover the login-shell PATH so
  // the bundled app can find the `sf` CLI (lives in nvm/volta/etc bins).
  if (app.isPackaged) fixPathEnv()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  win = null
})
