import { contextBridge, ipcRenderer } from 'electron'
import type { ItemPayload, TradewindApi, UpdateStatus } from '../shared/ipc'

const api: TradewindApi = {
  onItem(cb) {
    ipcRenderer.on('tw:item', (_event, payload: ItemPayload) => cb(payload))
  },
  onHide(cb) {
    ipcRenderer.on('tw:hide', () => cb())
  },
  search(prepared) {
    return ipcRenderer.invoke('tw:search', prepared)
  },
  setLeague(league) {
    return ipcRenderer.invoke('tw:set-league', league)
  },
  setPopupRect(rect) {
    ipcRenderer.send('tw:popup-rect', rect)
  },
  setTooltipRect(rect) {
    ipcRenderer.send('tw:tooltip-rect', rect)
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
  },
  setToastRect(rect) {
    ipcRenderer.send('tw:toast-rect', rect)
  }
}

contextBridge.exposeInMainWorld('tradewind', api)
