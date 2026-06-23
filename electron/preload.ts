import { contextBridge, ipcRenderer } from 'electron'
import type { BulkerApi } from '../src/shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: BulkerApi = {
  auth: {
    listConnectable: () => invoke('auth:listConnectable'),
    deleteOrg: (id) => invoke('auth:deleteOrg', id),
    connect: (id) => invoke('auth:connect', id),
    disconnect: () => invoke('auth:disconnect'),
    current: () => invoke('auth:current'),
    loginCli: (opts) => invoke('auth:loginCli', opts),
    logoutCli: (username) => invoke('auth:logoutCli', username),
  },
  metadata: {
    listObjects: () => invoke('metadata:listObjects'),
    describeObject: (object) => invoke('metadata:describeObject', object),
  },
  ingest: {
    submit: (req) => invoke('ingest:submit', req),
    results: (jobId, kind) => invoke('ingest:results', jobId, kind),
  },
  query: {
    submit: (req) => invoke('query:submit', req),
  },
  jobs: {
    status: (jobId) => invoke('jobs:status', jobId),
    abort: (jobId) => invoke('jobs:abort', jobId),
    delete: (jobId) => invoke('jobs:delete', jobId),
  },
  files: {
    openCsv: () => invoke('files:openCsv'),
    saveCsv: (defaultName, content) => invoke('files:saveCsv', defaultName, content),
  },
}

contextBridge.exposeInMainWorld('api', api)
