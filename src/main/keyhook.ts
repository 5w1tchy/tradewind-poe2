import type { ParsedHotkey } from './hotkey'

const HOTKEY_PRICE_CHECK = 1
const HOTKEY_HIDEOUT = 2

interface KeyhookAddon {
  start(callback: (id: number) => void): boolean
  setHotkeys(
    hotkeys: Array<{ id: number; vk: number; ctrl: boolean; alt: boolean; shift: boolean }>
  ): void
  setEnabled(enabled: boolean): void
  stop(): void
}

export interface KeyHookHandlers {
  onPriceCheck(): void
  onHideout(): void
}

/**
 * Wrapper around the tradewind-keyhook native addon (WH_KEYBOARD_LL,
 * suppression decided in native code). Loading or installing can fail —
 * missing build, hook rejected — and the caller falls back to
 * globalShortcut, which swallows the message but leaks the key state.
 */
export class NativeKeyHook {
  private constructor(private readonly addon: KeyhookAddon) {}

  static load(): NativeKeyHook | null {
    try {
      return new NativeKeyHook(require('tradewind-keyhook') as KeyhookAddon)
    } catch (err) {
      console.warn(
        '[input] native keyhook unavailable, falling back to globalShortcut:',
        err instanceof Error ? err.message : err
      )
      return null
    }
  }

  /** Install the hook (suppression stays disabled until setEnabled(true)). */
  start(
    hotkeys: { priceCheck: ParsedHotkey; hideout: ParsedHotkey },
    handlers: KeyHookHandlers
  ): boolean {
    const installed = this.addon.start((id) => {
      if (id === HOTKEY_PRICE_CHECK) handlers.onPriceCheck()
      else if (id === HOTKEY_HIDEOUT) handlers.onHideout()
    })
    if (!installed) {
      console.warn('[input] WH_KEYBOARD_LL hook failed to install')
      return false
    }
    const entry = (id: number, h: ParsedHotkey) => ({
      id,
      vk: h.vk,
      ctrl: h.ctrl,
      alt: h.alt,
      shift: h.shift
    })
    this.addon.setHotkeys([
      entry(HOTKEY_PRICE_CHECK, hotkeys.priceCheck),
      entry(HOTKEY_HIDEOUT, hotkeys.hideout)
    ])
    return true
  }

  setEnabled(enabled: boolean): void {
    this.addon.setEnabled(enabled)
  }

  stop(): void {
    this.addon.stop()
  }
}
