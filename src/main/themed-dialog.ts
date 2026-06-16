import { BrowserWindow, screen } from 'electron'

// A themed replacement for electron's native dialog.showMessageBox — the grey
// Win32 box clashes with the overlay. Same window recipe as tray-menu.ts/
// splash.ts (frameless, transparent, always-on-top, inline-HTML data URL,
// palette mirrored from theme.css) and the same preload-free `tw://` navigation
// channel for button clicks. Centered and modal-feeling: unlike the tray menu it
// does NOT dismiss on blur — only a button or Esc resolves it.

const CARD_WIDTH = 320
const SHADOW_PAD = 10
const WIN_WIDTH = CARD_WIDTH + SHADOW_PAD * 2

export interface ThemedDialogOptions {
  /** Small-caps bronze title row. Defaults to "Tradewind". */
  title?: string
  /** The headline line. */
  message: string
  /** Optional muted secondary line(s). */
  detail?: string
  /** Button labels, left→right. Defaults to a single "OK". */
  buttons?: string[]
  /** Index of the primary (highlighted, Enter-default) button. Defaults to 0. */
  defaultId?: number
  /** Index resolved on Esc / window close without a choice. Defaults to the last button. */
  cancelId?: number
}

// Only one dialog at a time — a second replaces the first.
let current: BrowserWindow | null = null

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function buildHtml(o: Required<Pick<ThemedDialogOptions, 'buttons' | 'defaultId'>> & ThemedDialogOptions): string {
  const title = escapeHtml(o.title ?? 'Tradewind')
  const detail = o.detail ? `<div class="detail">${escapeHtml(o.detail)}</div>` : ''
  const btns = o.buttons
    .map(
      (b, i) =>
        `<a class="btn${i === o.defaultId ? ' primary' : ''}" href="tw://btn/${i}">${escapeHtml(b)}</a>`
    )
    .join('')

  // Palette mirrors theme.css: bronze-dim border on near-black glass, Cinzel
  // bronze title, body text, muted detail, .tw-btn-style buttons (gold on hover,
  // primary pre-highlighted). Body font falls back to Segoe UI in this
  // standalone window (the bundled Alegreya web font isn't reachable here).
  return (
    '<!doctype html><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:transparent;' +
    'user-select:none;cursor:default}' +
    `#wrap{box-sizing:border-box;padding:${SHADOW_PAD}px}` +
    // The card is a drag handle (-webkit-app-region) so the frameless window can
    // be moved like a normal one; the buttons opt back out so they stay clickable.
    '#card{background:rgba(19,17,15,0.98);border:1px solid rgba(160,92,40,0.45);' +
    'border-radius:3px;padding:16px 18px;box-shadow:0 8px 26px rgba(0,0,0,0.7);' +
    '-webkit-app-region:drag}' +
    ".title{color:#d08a3c;font:600 10px/1.2 'Cinzel','Times New Roman',serif;" +
    'letter-spacing:0.14em;text-transform:uppercase;margin-bottom:10px}' +
    ".msg{color:#d8d4cb;font:14px/1.4 'Alegreya Sans','Segoe UI',sans-serif}" +
    ".detail{color:#97928a;font:12px/1.45 'Alegreya Sans','Segoe UI',sans-serif;margin-top:6px}" +
    '.row{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}' +
    ".btn{text-decoration:none;background:rgba(255,252,245,0.04);" +
    'border:1px solid rgba(216,212,203,0.16);border-radius:2px;color:#d8d4cb;' +
    "font:12px/1.2 'Alegreya Sans','Segoe UI',sans-serif;padding:5px 12px;" +
    '-webkit-app-region:no-drag}' +
    '.btn:hover{border-color:#a05c28;color:#e8c878}' +
    '.btn.primary{border-color:#a05c28;color:#e8c878}' +
    '.btn.primary:hover{border-color:#d08a3c}' +
    `</style><div id="wrap"><div id="card"><div class="title">${title}</div>` +
    `<div class="msg">${escapeHtml(o.message)}</div>${detail}` +
    `<div class="row">${btns}</div></div></div>` +
    // Enter triggers the primary button; Esc cancels. Both route through the same
    // nav channel as a click.
    '<script>addEventListener("keydown",e=>{' +
    `if(e.key==="Escape")location.href="tw://cancel";` +
    `else if(e.key==="Enter")location.href="tw://btn/${o.defaultId}"})</script>`
  )
}

/**
 * Show a centered, themed modal dialog and resolve with the index of the button
 * the user picked (or `cancelId` on Esc / close). Replaces the native
 * dialog.showMessageBox while keeping the same return shape (a button index).
 */
export function showThemedDialog(options: ThemedDialogOptions): Promise<number> {
  if (current && !current.isDestroyed()) current.destroy()

  const buttons = options.buttons ?? ['OK']
  const defaultId = options.defaultId ?? 0
  const cancelId = options.cancelId ?? buttons.length - 1

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: WIN_WIDTH,
      height: 10, // placeholder; resized to measured content before showing
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { sandbox: true }
    })
    current = win
    win.setMenu(null)
    win.setAlwaysOnTop(true, 'screen-saver')

    let settled = false
    const finish = (index: number): void => {
      if (settled) return
      settled = true
      if (current === win) current = null
      resolve(index)
      if (!win.isDestroyed()) win.destroy()
    }

    win.webContents.on('will-navigate', (e, url) => {
      e.preventDefault()
      const m = /^tw:\/\/btn\/(\d+)$/.exec(url)
      finish(m ? Number(m[1]) : cancelId)
    })
    // Closed by the window manager (Alt+F4 etc.) without a choice → cancel.
    win.on('closed', () => finish(cancelId))

    void win.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(buildHtml({ ...options, buttons, defaultId }))}`
    )

    win.once('ready-to-show', () => {
      void win.webContents
        .executeJavaScript('document.getElementById("wrap").scrollHeight')
        .then((h: number) => {
          if (win.isDestroyed()) return
          const height = Math.ceil(h)
          const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
          const x = Math.round(area.x + (area.width - WIN_WIDTH) / 2)
          const y = Math.round(area.y + (area.height - height) / 2)
          win.setBounds({ x, y, width: WIN_WIDTH, height })
          win.show() // focuses, so Enter/Esc land
        })
        .catch(() => finish(cancelId))
    })
  })
}
