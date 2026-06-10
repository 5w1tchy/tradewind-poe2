import { contextBridge, ipcRenderer } from 'electron'

export interface ItemPayload {
  text: string | null
  x: number
  y: number
}

contextBridge.exposeInMainWorld('tradewind', {
  onItem(cb: (payload: ItemPayload) => void): void {
    ipcRenderer.on('tw:item', (_event, payload: ItemPayload) => cb(payload))
  },
  onHide(cb: () => void): void {
    ipcRenderer.on('tw:hide', () => cb())
  }
})
