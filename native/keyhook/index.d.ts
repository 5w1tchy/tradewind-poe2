export interface KeyhookHotkey {
  /** Caller-chosen id passed back to the callback when this hotkey fires. */
  id: number
  /** Windows virtual-key code. */
  vk: number
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/**
 * Install the WH_KEYBOARD_LL hook on a dedicated native thread. Returns false
 * if the hook could not be installed (caller should fall back). The callback
 * fires once per physical keydown of a matched hotkey (autorepeat collapsed).
 */
export function start(callback: (id: number) => void): boolean

/** Replace the matched hotkey set. Matching happens entirely in native code. */
export function setHotkeys(hotkeys: KeyhookHotkey[]): void

/** Toggle suppression — disabled, every key passes through untouched. */
export function setEnabled(enabled: boolean): void

/** Uninstall the hook and wind down the native thread. */
export function stop(): void
