import type { BulkerApi } from './shared/types'

declare global {
  interface Window {
    api: BulkerApi
  }
}

export {}
