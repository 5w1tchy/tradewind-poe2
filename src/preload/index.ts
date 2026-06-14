import { contextBridge, ipcRenderer } from 'electron'
import type { ItemPayload, TradewindApi } from '../shared/ipc'

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
  openUrl(url) {
    ipcRenderer.send('tw:open-url', url)
  }
}

contextBridge.exposeInMainWorld('tradewind', api)
