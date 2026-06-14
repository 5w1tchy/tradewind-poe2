/// <reference types="vite/client" />

import type { TradewindApi } from '../../shared/ipc'

declare global {
  interface Window {
    tradewind: TradewindApi
  }
}

export {}
