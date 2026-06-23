import type { JobInfo } from '../src/shared/types'

/** Raw Bulk API job record as returned by the REST endpoints. */
export interface RawJobInfo {
  id: string
  object: string
  operation: string
  state: string
  createdDate: string
  numberRecordsProcessed?: number
  numberRecordsFailed?: number
  errorMessage?: string
}

/** Map a raw Bulk API job record to the app's JobInfo shape. */
export function toJobInfo(j: RawJobInfo, isQuery = false): JobInfo {
  return {
    id: j.id,
    object: j.object,
    operation: j.operation,
    state: j.state,
    createdDate: j.createdDate,
    numberRecordsProcessed: j.numberRecordsProcessed,
    numberRecordsFailed: j.numberRecordsFailed,
    errorMessage: j.errorMessage,
    isQuery,
  }
}
