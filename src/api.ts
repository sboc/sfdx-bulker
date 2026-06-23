import type { IpcResult } from './shared/types'

export const api = window.api

/** Unwrap an IpcResult, throwing the error message on failure. */
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error ?? 'Unknown error')
  return r.data as T
}
