export interface JobFilters {
  id: string
  object: string
  state: string
  operation: string
  from: string
  to: string
}

export const EMPTY_JOB_FILTERS: JobFilters = {
  id: '',
  object: '',
  state: '',
  operation: '',
  from: '',
  to: '',
}
