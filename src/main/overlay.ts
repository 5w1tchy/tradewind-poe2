import { BrowserWindow } from 'electron'
import { join } from 'node:path'

/**
 * The single transparent, click-through, always-on-top overlay window. It is
 * NOT fullscreen: main resizes it to the renderer's current content (popup +
 * floats, or full-screen only while a viewport-anchored surface like the toast
 * is up) and hides it when nothing shows. A fullscreen transparent surface is
 * crippling to composite when the GPU falls back to software/WARP — keeping the
 * window content-sized is what keeps the popup smooth there.
 */
export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  // Truly click-through: no { forward: true }. Forwarding mouse-move messages to
  // our renderer starves the game of them, freezing PoE2's own item tooltip on
  // screen. The main process hit-tests the cursor against the popup rect and
  // flips this off only while the cursor is actually over the popup.
  win.setIgnoreMouseEvents(true)
  win.setMenu(null)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
