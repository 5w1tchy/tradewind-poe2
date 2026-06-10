/// <reference types="vite/client" />

import type { TradewindApi } from '../../shared/ipc'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare global {
  interface Window {
    tradewind: TradewindApi
  }
}

export {}
