import { uIOhook, UiohookKey } from 'uiohook-napi'
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const keybd_event = user32.func(
  'void keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
)

const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_C = 0x43
const KEYEVENTF_KEYUP = 0x0002

/**
 * Synthesize Ctrl+Alt+C into the focused window (PoE2's "advanced copy" —
 * includes mod tiers and roll ranges).
 */
export function sendCopyAdvanced(): void {
  keybd_event(VK_CONTROL, 0, 0, 0)
  keybd_event(VK_MENU, 0, 0, 0)
  keybd_event(VK_C, 0, 0, 0)
  keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0)
  keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
}

export interface InputHandlers {
  onPriceCheck(): void
  onHideout(): void
  onEscape(): void
  onMouseMovedAway(): void
}

/** Distance (physical px) the cursor may travel from the popup before it auto-hides. */
const MOUSE_LEAVE_DISTANCE = 300

export class InputManager {
  private anchor: { x: number; y: number } | null = null
  private lastMouse = { x: 0, y: 0 }
  // uiohook can only observe keys, never swallow them — hotkeys claimed via
  // globalShortcut are consumed before the game sees them, and must then be
  // ignored here or they'd fire twice (low-level hooks still see them).
  private observed = { priceCheck: true, hideout: true }

  setObserved(keys: { priceCheck: boolean; hideout: boolean }): void {
    this.observed = keys
  }

  start(handlers: InputHandlers): void {
    uIOhook.on('mousemove', (e) => {
      this.lastMouse = { x: e.x, y: e.y }
      if (this.anchor) {
        const dx = e.x - this.anchor.x
        const dy = e.y - this.anchor.y
        if (dx * dx + dy * dy > MOUSE_LEAVE_DISTANCE * MOUSE_LEAVE_DISTANCE) {
          this.anchor = null
          handlers.onMouseMovedAway()
        }
      }
    })

    uIOhook.on('keydown', (e) => {
      if (
        this.observed.priceCheck &&
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.keycode === UiohookKey.D
      ) {
        handlers.onPriceCheck()
      } else if (
        this.observed.hideout &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        e.keycode === UiohookKey.F5
      ) {
        handlers.onHideout()
      } else if (e.keycode === UiohookKey.Escape) {
        // Never claimed via globalShortcut — swallowing Escape would break
        // the game's own menus. Observe only.
        handlers.onEscape()
      }
    })

    uIOhook.start()
  }

  /** Begin watching for the cursor wandering away from where the popup opened. */
  watchMouseLeave(): void {
    this.anchor = { ...this.lastMouse }
  }

  cancelMouseLeave(): void {
    this.anchor = null
  }

  stop(): void {
    uIOhook.stop()
  }
}
