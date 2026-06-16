import { uIOhook, UiohookKey } from 'uiohook-napi'
import koffi from 'koffi'
import type { ParsedHotkey } from './hotkey'

const user32 = koffi.load('user32.dll')
const keybd_event = user32.func(
  'void keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
)
const MapVirtualKeyW = user32.func('uint MapVirtualKeyW(uint uCode, uint uMapType)')
const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)')

const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_C = 0x43
const KEYEVENTF_KEYUP = 0x0002
const MAPVK_VK_TO_VSC = 0

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
// Real scan code: PoE2 reconciles key state by scan code, and a bScan=0 release
// can be dropped — leaving Alt "stuck down" and the advanced tooltip pinned.
const scanCode = (vk: number): number => MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)
const isDown = (vk: number): boolean => (GetAsyncKeyState(vk) & 0x8000) !== 0
const keyDown = (vk: number): void => keybd_event(vk, scanCode(vk), 0, 0)
const keyUp = (vk: number): void => keybd_event(vk, scanCode(vk), KEYEVENTF_KEYUP, 0)

// A frame-sized gap so the game registers each key transition separately;
// fired back-to-back, the Alt up/down coalesce and the release is missed.
const KEY_STEP_MS = 25

/**
 * Synthesize Ctrl+Alt+C into the focused window (PoE2's "advanced copy" —
 * includes mod tiers and roll ranges).
 *
 * The hotkey is Ctrl+D, so Ctrl is already physically held. We must NOT
 * press/release a modifier the user is holding: a synthetic Ctrl up landing
 * while the real key is down churns the modifier state and the Alt release gets
 * lost, leaving the game stuck showing the advanced tooltip. So we supply only
 * the modifiers that aren't already down, and release only those.
 */
export async function sendCopyAdvanced(): Promise<void> {
  const supply = [VK_CONTROL, VK_MENU].filter((vk) => !isDown(vk))
  for (const vk of supply) {
    keyDown(vk)
    await sleep(KEY_STEP_MS)
  }
  keyDown(VK_C)
  await sleep(KEY_STEP_MS)
  keyUp(VK_C)
  await sleep(KEY_STEP_MS)
  for (const vk of supply.reverse()) {
    keyUp(vk)
    await sleep(KEY_STEP_MS)
  }
}

export interface InputHandlers {
  onPriceCheck(): void
  onHideout(): void
  onEscape(): void
  /** Fires on every cursor move; drives popup hit-testing in the main process. */
  onMouseMove(): void
  /** Fires on every mouse press; drives click-outside-to-close in the main process. */
  onMouseDown(): void
}

export class InputManager {
  // uiohook can only observe keys, never swallow them — hotkeys claimed via
  // globalShortcut are consumed before the game sees them, and must then be
  // ignored here or they'd fire twice (low-level hooks still see them).
  private observed = { priceCheck: true, hideout: true }

  setObserved(keys: { priceCheck: boolean; hideout: boolean }): void {
    this.observed = keys
  }

  start(
    handlers: InputHandlers,
    hotkeys: { priceCheck: ParsedHotkey; hideout: ParsedHotkey }
  ): void {
    uIOhook.on('mousemove', () => handlers.onMouseMove())
    uIOhook.on('mousedown', () => handlers.onMouseDown())

    const matches = (e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; keycode: number },
      h: ParsedHotkey): boolean =>
      e.ctrlKey === h.ctrl && e.altKey === h.alt && e.shiftKey === h.shift && e.keycode === h.keycode

    uIOhook.on('keydown', (e) => {
      if (this.observed.priceCheck && matches(e, hotkeys.priceCheck)) {
        handlers.onPriceCheck()
      } else if (this.observed.hideout && matches(e, hotkeys.hideout)) {
        handlers.onHideout()
      } else if (e.keycode === UiohookKey.Escape) {
        // Never claimed via globalShortcut — swallowing Escape would break
        // the game's own menus. Observe only.
        handlers.onEscape()
      }
    })

    uIOhook.start()
  }

  stop(): void {
    uIOhook.stop()
  }
}
