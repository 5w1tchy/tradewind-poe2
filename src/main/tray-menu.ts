import { BrowserWindow, screen } from 'electron'

// Windows' native tray context menu is the flat light-grey Win32 menu and can't
// be themed. To match the overlay's "in-game artifact" look we draw our own:
// a frameless, transparent, always-on-top BrowserWindow shown at the cursor,
// styled from the same palette as src/renderer/src/styles/theme.css. Same window
// recipe as splash.ts — inline HTML data URL, no renderer/preload involved.
//
// Item clicks come back through an intercepted navigation to a custom `tw://`
// scheme (will-navigate), so this needs no preload and no IPC channel: the menu
// is wholly owned by the main process.

/** An action row, a non-interactive header/label, or a divider between groups. */
export type TrayMenuItem =
  | { label: string; action: () => void }
  | { header: string }
  | { separator: true }

// Visual width of the menu card; the window is wider to leave room for the
// drop-shadow (which we draw in CSS, since a transparent window has no native
// shadow). The card height is measured from content after load.
const CARD_WIDTH = 196
const SHADOW_PAD = 7
const WIN_WIDTH = CARD_WIDTH + SHADOW_PAD * 2

// Only one menu at a time — a second right-click replaces the first.
let current: BrowserWindow | null = null

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function buildHtml(items: TrayMenuItem[]): string {
  const rows = items
    .map((it, i) => {
      if ('separator' in it) return '<div class="sep"></div>'
      if ('header' in it) return `<div class="header">${escapeHtml(it.header)}</div>`
      return `<a class="item" href="tw://item/${i}">${escapeHtml(it.label)}</a>`
    })
    .join('')

  // Palette mirrors theme.css's .tw-menu (bronze-dim border, near-black glass,
  // bronze-faint hover, gold hover text). Body font falls back to Segoe UI since
  // the bundled Alegreya web font isn't available to this standalone window.
  return (
    '<!doctype html><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:transparent;' +
    'user-select:none;cursor:default}' +
    `#wrap{box-sizing:border-box;padding:${SHADOW_PAD}px}` +
    '#menu{background:rgba(19,17,15,0.98);border:1px solid rgba(160,92,40,0.45);' +
    'border-radius:2px;padding:3px;box-shadow:0 2px 6px rgba(0,0,0,0.5);' +
    'opacity:0;transition:opacity 110ms ease}' +
    ".item{display:block;text-decoration:none;color:#d8d4cb;border-radius:1px;" +
    "font:13px/1.2 'Alegreya Sans','Segoe UI',sans-serif;padding:7px 12px;" +
    '-webkit-user-drag:none}' +
    '.item:hover{background:rgba(160,92,40,0.22);color:#e8c878}' +
    // Non-interactive title row: small-caps bronze label, no hover/pointer.
    ".header{padding:6px 12px 5px;color:#d08a3c;font:600 10px/1.2 'Cinzel'," +
    "'Times New Roman',serif;letter-spacing:0.12em;text-transform:uppercase;" +
    'cursor:default}' +
    '.sep{height:1px;margin:3px 6px;background:rgba(216,212,203,0.16)}' +
    `</style><div id="wrap"><div id="menu">${rows}</div></div>` +
    // Esc dismisses; route it through the same nav channel as a click.
    "<script>addEventListener('keydown',e=>{if(e.key==='Escape')location.href='tw://dismiss'})</script>"
  )
}

/**
 * Show the themed tray menu at the current cursor position. The window is
 * created fresh each call and destroyed on dismiss (Esc, click-away/blur, or a
 * selection), so there's no stale state to manage between openings.
 */
export function showTrayMenu(items: TrayMenuItem[]): void {
  if (current && !current.isDestroyed()) current.destroy()

  const win = new BrowserWindow({
    width: WIN_WIDTH,
    height: 10, // placeholder; resized to measured content before showing
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { sandbox: true }
  })
  current = win
  win.setMenu(null)
  // Sit above a windowed-fullscreen game, same as the overlay/splash.
  win.setAlwaysOnTop(true, 'screen-saver')

  let closing = false
  const close = (): void => {
    if (closing || win.isDestroyed()) return
    closing = true
    if (current === win) current = null
    win.destroy()
  }

  // Menu rows navigate to `tw://item/<index>`; Esc/other to `tw://dismiss`. We
  // never actually navigate — preventDefault, then act and close.
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    const m = /^tw:\/\/item\/(\d+)$/.exec(url)
    close()
    if (m) {
      const it = items[Number(m[1])]
      // Defer so the window is gone before the action (e.g. a modal dialog) runs.
      if (it && 'action' in it) setImmediate(it.action)
    }
  })
  // Click-away: the focused menu loses focus → dismiss, mirroring native menus.
  win.on('blur', close)

  void win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(buildHtml(items))}`)

  win.once('ready-to-show', () => {
    void win.webContents
      .executeJavaScript('document.getElementById("wrap").scrollHeight')
      .then((h: number) => {
        if (win.isDestroyed()) return
        const height = Math.ceil(h)
        const cursor = screen.getCursorScreenPoint()
        const area = screen.getDisplayNearestPoint(cursor).workArea

        // Windows convention: the menu's bottom-right sits at the cursor (grows
        // up-left from the tray). Flip to below/right when it would overflow the
        // work area, then clamp fully inside it.
        let x = cursor.x - WIN_WIDTH
        let y = cursor.y - height
        if (x < area.x) x = cursor.x
        if (y < area.y) y = cursor.y
        x = Math.max(area.x, Math.min(x, area.x + area.width - WIN_WIDTH))
        y = Math.max(area.y, Math.min(y, area.y + area.height - height))

        win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIN_WIDTH, height })
        win.show() // focuses, so the blur-to-dismiss works
        void win.webContents
          .executeJavaScript(
            "requestAnimationFrame(()=>{const e=document.getElementById('menu');if(e)e.style.opacity='1'})"
          )
          .catch(() => {})
      })
      .catch(() => close())
  })
}
