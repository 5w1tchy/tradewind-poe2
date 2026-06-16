import { BrowserWindow, screen } from 'electron'

// A themed replacement for electron's native dialog.showMessageBox — the grey
// Win32 box clashes with the overlay. Same window recipe as tray-menu.ts/
// splash.ts (frameless, transparent, always-on-top, inline-HTML data URL,
// palette mirrored from theme.css) and the same preload-free `tw://` navigation
// channel for button clicks.
//
// Unlike a one-shot message box this is *stateful*: showThemedDialog returns a
// controller whose setContent() morphs the live window in place, so a single
// dialog can walk through e.g. Checking… → Available → Downloading… (used by the
// manual update flow in updater.ts). Centered and modal-feeling — it does NOT
// dismiss on blur; only a button or Esc closes it. The card is a drag handle so
// the frameless window moves like a normal one.

const CARD_WIDTH = 320
const SHADOW_PAD = 10
const WIN_WIDTH = CARD_WIDTH + SHADOW_PAD * 2

export interface ThemedDialogButton {
  label: string
  /** Highlighted (gold) and triggered by Enter. */
  primary?: boolean
  /** Triggered by Esc. */
  cancel?: boolean
  /** Run on click; the window then closes unless `keepOpen` is set. */
  onClick?: () => void
  /** Keep the window open after the click (e.g. to setContent a new state). */
  keepOpen?: boolean
}

export interface ThemedDialogOptions {
  /** Small-caps bronze title row. Defaults to "Tradewind". */
  title?: string
  /** The headline line. */
  message: string
  /** Optional muted secondary line. */
  detail?: string
  /** Buttons, left→right. Omit for a single closing "OK"; pass [] for none. */
  buttons?: ThemedDialogButton[]
  /** Fired once when the window closes for any reason (initial call only). */
  onClosed?: () => void
}

export interface DialogController {
  /** Replace the live window's content (title/message/detail/buttons). */
  setContent(options: ThemedDialogOptions): void
  /** Close and destroy the window. Idempotent. */
  close(): void
}

const DEFAULT_BUTTONS: ThemedDialogButton[] = [{ label: 'OK', primary: true, cancel: true }]

// Only one dialog at a time — a second replaces the first.
let current: BrowserWindow | null = null

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// The static shell: all the styling, an empty card, and the keyboard handler.
// Content is injected (and re-injected on setContent) into #card from the main
// process; the keydown listener reads the current default/cancel button indices
// off window.__btns, which each render updates.
function shellHtml(): string {
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
    '</style><div id="wrap"><div id="card"></div></div><script>' +
    'window.__btns={def:null,cancel:null};' +
    'addEventListener("keydown",e=>{' +
    'if(e.key==="Escape")location.href=window.__btns.cancel!=null?"tw://btn/"+window.__btns.cancel:"tw://cancel";' +
    'else if(e.key==="Enter"&&window.__btns.def!=null)location.href="tw://btn/"+window.__btns.def})' +
    '</script>'
  )
}

function cardInnerHtml(o: ThemedDialogOptions, buttons: ThemedDialogButton[]): string {
  const title = escapeHtml(o.title ?? 'Tradewind')
  const detail = o.detail ? `<div class="detail">${escapeHtml(o.detail)}</div>` : ''
  const row = buttons.length
    ? `<div class="row">${buttons
        .map(
          (b, i) =>
            `<a class="btn${b.primary ? ' primary' : ''}" href="tw://btn/${i}">${escapeHtml(b.label)}</a>`
        )
        .join('')}</div>`
    : ''
  return `<div class="title">${title}</div><div class="msg">${escapeHtml(o.message)}</div>${detail}${row}`
}

/**
 * Show a centered, themed modal dialog. Returns a controller for morphing it in
 * place (setContent) or closing it (close). Button clicks fire each button's
 * onClick and then close the window unless the button is keepOpen.
 */
export function showThemedDialog(options: ThemedDialogOptions): DialogController {
  if (current && !current.isDestroyed()) current.destroy()

  const win = new BrowserWindow({
    width: WIN_WIDTH,
    height: 10, // placeholder; resized to measured content on each render
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

  let buttons: ThemedDialogButton[] = options.buttons ?? DEFAULT_BUTTONS
  let pending: ThemedDialogOptions = options
  let ready = false
  let shown = false

  let closing = false
  const close = (): void => {
    if (closing || win.isDestroyed()) return
    closing = true
    win.destroy()
  }
  win.on('closed', () => {
    if (current === win) current = null
    options.onClosed?.()
  })

  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    const m = /^tw:\/\/btn\/(\d+)$/.exec(url)
    if (!m) return close() // tw://cancel with no cancel button
    const btn = buttons[Number(m[1])]
    if (!btn) return close()
    btn.onClick?.()
    if (!btn.keepOpen) close()
  })

  // Inject content into the live window, measure it, then size/position. On the
  // first render the window is centered and revealed; later renders keep the
  // current top-left (so a dragged dialog stays put) and only re-fit the height.
  const render = (o: ThemedDialogOptions): void => {
    buttons = o.buttons ?? DEFAULT_BUTTONS
    const def = buttons.findIndex((b) => b.primary)
    const cancel = buttons.findIndex((b) => b.cancel)
    const js =
      `document.getElementById('card').innerHTML=${JSON.stringify(cardInnerHtml(o, buttons))};` +
      `window.__btns={def:${def < 0 ? 'null' : def},cancel:${cancel < 0 ? 'null' : cancel}};` +
      `document.getElementById('wrap').scrollHeight`
    void win.webContents
      .executeJavaScript(js)
      .then((h: number) => {
        if (win.isDestroyed()) return
        const height = Math.ceil(h)
        const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
        if (!shown) {
          const x = Math.round(area.x + (area.width - WIN_WIDTH) / 2)
          const y = Math.round(area.y + (area.height - height) / 2)
          win.setBounds({ x, y, width: WIN_WIDTH, height })
          win.show() // focuses, so Enter/Esc land
          shown = true
        } else {
          const b = win.getBounds()
          const y = Math.max(area.y, Math.min(b.y, area.y + area.height - height))
          win.setBounds({ x: b.x, y, width: WIN_WIDTH, height })
        }
      })
      .catch(() => {})
  }

  void win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(shellHtml())}`)
  win.once('ready-to-show', () => {
    ready = true
    render(pending)
  })

  return {
    setContent: (o) => {
      pending = o
      if (ready && !win.isDestroyed()) render(o)
    },
    close
  }
}
