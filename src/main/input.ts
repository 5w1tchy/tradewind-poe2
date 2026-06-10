import { uIOhook, UiohookKey } from 'uiohook-napi'
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const keybd_event = user32.func(
  'void keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
)

const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_RETURN = 0x0d
const VK_A = 0x41
const VK_C = 0x43
const VK_V = 0x56
const KEYEVENTF_KEYUP = 0x0002

function tapKey(vk: number): void {
  keybd_event(vk, 0, 0, 0)
  keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
}

function tapWithCtrl(vk: number): void {
  keybd_event(VK_CONTROL, 0, 0, 0)
  tapKey(vk)
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
}

/**
 * Synthesize Ctrl+Alt+C into the focused window (PoE2's "advanced copy" —
 * includes mod tiers and roll ranges).
 */
export function sendCopyAdvanced(): void {
  keybd_event(VK_CONTROL, 0, 0, 0)
  keybd_event(VK_MENU, 0, 0, 0)
  tapKey(VK_C)
  keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
}

export const sendEnter = (): void => tapKey(VK_RETURN)
export const sendSelectAll = (): void => tapWithCtrl(VK_A)
export const sendPaste = (): void => tapWithCtrl(VK_V)

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
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.keycode === UiohookKey.D) {
        handlers.onPriceCheck()
      } else if (!e.ctrlKey && !e.altKey && !e.shiftKey && e.keycode === UiohookKey.F5) {
        handlers.onHideout()
      } else if (e.keycode === UiohookKey.Escape) {
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
