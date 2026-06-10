/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface ItemPayload {
  text: string | null
  x: number
  y: number
}

interface Window {
  tradewind: {
    onItem(cb: (payload: ItemPayload) => void): void
    onHide(cb: () => void): void
  }
}
