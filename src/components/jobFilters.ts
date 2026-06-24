export interface JobFilters {
  object: string
  state: string
  operation: string
  from: string
  to: string
}

export const EMPTY_JOB_FILTERS: JobFilters = { object: '', state: '', operation: '', from: '', to: '' }
