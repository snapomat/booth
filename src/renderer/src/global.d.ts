import type { PhotoboothApi } from '@shared/types'

declare global {
  interface Window {
    api: PhotoboothApi
  }
}

export {}
