// Shared types between Electron main process and React renderer.

export type BulkOperation =
  | 'insert'
  | 'update'
  | 'upsert'
  | 'delete'
  | 'hardDelete'

export type LineEnding = 'LF' | 'CRLF'

export interface ConnectedAppConfig {
  /** Consumer Key of the Salesforce Connected App. */
  clientId: string
  /** Login host - for Client Credentials this must be your My Domain URL. */
  loginUrl: string
}

export type OrgSource = 'client-credentials' | 'cli' | 'oauth'

/** A saved org connection (credentials live encrypted in the main process). */
export interface SavedOrg {
  id: string
  name: string
  source: OrgSource
  /** Login host (client-credentials) or instance URL (cli) - informational. */
  loginUrl: string
  /** client-credentials only. */
  clientId?: string
  /** cli only - the username the Salesforce CLI knows this org by. */
  cliUsername?: string
}

/** Returned to the UI - adds status flags, never the secret itself. */
export interface SavedOrgView extends SavedOrg {
  hasSecret: boolean
  /** Whether this org has everything it needs to connect. */
  canConnect: boolean
  /** True when this org is the active, signed-in connection. */
  connected: boolean
}

/** Sent from the org editor. id present when editing; clientSecret blank keeps the existing one. */
export interface SaveOrgInput {
  id?: string
  name: string
  clientId: string
  loginUrl: string
  clientSecret?: string
}

/** An org authenticated in the local Salesforce CLI. */
export interface CliOrg {
  username: string
  alias?: string
  instanceUrl: string
  orgId: string
}

export interface SObjectInfo {
  name: string
  label: string
}

export interface SObjectField {
  name: string
  label: string
  type: string
  createable: boolean
  updateable: boolean
  /** True for external-id-capable fields (usable as the upsert key). */
  externalId: boolean
}

export interface OrgIdentity {
  instanceUrl: string
  username: string
  displayName: string
  organizationId: string
  userId: string
}

export interface IngestJobRequest {
  object: string
  operation: BulkOperation
  /** Required for upsert. */
  externalIdFieldName?: string
  /** CSV content to load. */
  csv: string
  lineEnding: LineEnding
}

export interface JobInfo {
  id: string
  object: string
  operation: string
  state: string // Open | UploadComplete | InProgress | JobComplete | Aborted | Failed
  createdDate: string
  numberRecordsProcessed?: number
  numberRecordsFailed?: number
  errorMessage?: string
  /** Present on query jobs. */
  isQuery?: boolean
}

export type ResultKind = 'successful' | 'failed' | 'unprocessed'

/** A remembered field mapping from a past load, reused on matching loads. */
export interface LoadMapping {
  object: string
  operation: BulkOperation
  /** CSV column set this mapping was built for (the match signature). */
  columns: string[]
  /** CSV column -> sObject field API name (empty/missing = ignored). */
  mapping: Record<string, string>
  /** Upsert external Id field, when applicable. */
  externalIdField?: string
  /** Id column for destructive ops, when applicable. */
  idColumn?: string
  /** ms since epoch, when this mapping was last used. */
  updatedAt: number
}

/** What the renderer sends to remember a mapping (the store stamps updatedAt). */
export type LoadMappingInput = Omit<LoadMapping, 'updatedAt'>

export interface QueryJobRequest {
  soql: string
}

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

// Shape exposed on window.api via the preload bridge.
export interface BulkerApi {
  auth: {
    /** Saved orgs plus CLI-authenticated orgs, all directly connectable. */
    listConnectable(): Promise<IpcResult<SavedOrgView[]>>
    deleteOrg(id: string): Promise<IpcResult<null>>
    connect(id: string): Promise<IpcResult<OrgIdentity>>
    disconnect(): Promise<IpcResult<null>>
    current(): Promise<OrgIdentity | null>
    /** Whether the Salesforce CLI is installed (decides which login path the UI offers). */
    cliAvailable(): Promise<IpcResult<boolean>>
    /** Launch `sf org login web` (opens a browser). Resolves with the new username. */
    loginCli(opts: { alias?: string; instanceUrl: string }): Promise<IpcResult<{ username: string }>>
    /** CLI-free browser login (OAuth PKCE). Resolves with the connected org identity. */
    loginWeb(opts: { alias?: string; instanceUrl: string }): Promise<IpcResult<OrgIdentity>>
    /** Log an org out of the Salesforce CLI. */
    logoutCli(username: string): Promise<IpcResult<null>>
  }
  metadata: {
    listObjects(): Promise<IpcResult<SObjectInfo[]>>
    describeObject(object: string): Promise<IpcResult<SObjectField[]>>
  }
  ingest: {
    submit(req: IngestJobRequest): Promise<IpcResult<JobInfo>>
    results(jobId: string, kind: ResultKind): Promise<IpcResult<string>> // CSV
  }
  query: {
    submit(req: QueryJobRequest): Promise<IpcResult<{ jobId: string; csv: string; rows: number }>>
  }
  jobs: {
    status(jobId: string): Promise<IpcResult<JobInfo>>
    abort(jobId: string): Promise<IpcResult<null>>
    /** Every bulk job in the org (ingest + query), all pages, newest first. */
    listAll(): Promise<IpcResult<JobInfo[]>>
  }
  files: {
    /** Open one or more CSV files; null when the dialog is cancelled. */
    openCsv(): Promise<IpcResult<{ name: string; content: string }[] | null>>
    saveCsv(defaultName: string, content: string): Promise<IpcResult<{ path: string } | null>>
  }
  history: {
    /** Remember the field mapping used for a load (scoped to the active org). */
    saveLoadMapping(m: LoadMappingInput): Promise<IpcResult<null>>
    /** Best remembered mapping matching object + operation + column set, or null. */
    suggestMapping(q: {
      object: string
      operation: BulkOperation
      columns: string[]
    }): Promise<IpcResult<LoadMapping | null>>
  }
}
