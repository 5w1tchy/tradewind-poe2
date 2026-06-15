import { contextBridge, ipcRenderer } from 'electron'
import type { ItemPayload, OverlayLayout, TradewindApi, UpdateStatus } from '../shared/ipc'

const api: TradewindApi = {
  onItem(cb) {
    ipcRenderer.on('tw:item', (_event, payload: ItemPayload) => cb(payload))
  },
  onHide(cb) {
    ipcRenderer.on('tw:hide', () => cb())
  },
  onViewport(cb) {
    ipcRenderer.on('tw:viewport', (_event, size: { w: number; h: number }) => cb(size))
  },
  search(prepared) {
    return ipcRenderer.invoke('tw:search', prepared)
  },
  setLeague(league) {
    return ipcRenderer.invoke('tw:set-league', league)
  },
  setLayout(layout: OverlayLayout) {
    ipcRenderer.send('tw:layout', layout)
  },
  requestFocus() {
    ipcRenderer.send('tw:focus-input')
  },
  releaseFocus() {
    ipcRenderer.send('tw:release-focus')
  },
  openUrl(url) {
    ipcRenderer.send('tw:open-url', url)
  },
  onUpdateStatus(cb) {
    ipcRenderer.on('tw:update-status', (_event, status: UpdateStatus) => cb(status))
  },
  restartToUpdate() {
    ipcRenderer.send('tw:restart-update')
  }
}

contextBridge.exposeInMainWorld('tradewind', api)
