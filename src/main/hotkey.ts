import { UiohookKey } from 'uiohook-napi'

export interface ParsedHotkey {
  ctrl: boolean
  alt: boolean
  shift: boolean
  /** Electron accelerator ("Control+D", "F5") for globalShortcut. */
  accelerator: string
  /** uiohook keycode for the observe-only fallback. */
  keycode: number
  /** Windows virtual-key code for the native low-level hook. */
  vk: number
}

/**
 * Parse a config hotkey like "Ctrl+D", "Ctrl+Alt+P" or "F6". Supported keys:
 * single letters/digits and F1-F24. Null on anything else — the caller falls
 * back to its default.
 */
export function parseHotkey(spec: string): ParsedHotkey | null {
  const parts = spec
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const out = { ctrl: false, alt: false, shift: false }
  let key: string | null = null
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') out.ctrl = true
    else if (lower === 'alt') out.alt = true
    else if (lower === 'shift') out.shift = true
    else if (key === null) key = part.toUpperCase()
    else return null
  }
  if (key === null) return null
  if (!/^[A-Z0-9]$/.test(key) && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return null

  const keycode = (UiohookKey as Record<string, number>)[key]
  if (keycode === undefined) return null

  // Letters/digits are their char code; F-keys start at VK_F1 = 0x70.
  const vk = key.length === 1 ? key.charCodeAt(0) : 0x6f + Number(key.slice(1))

  const accelerator = [out.ctrl && 'Control', out.alt && 'Alt', out.shift && 'Shift', key]
    .filter(Boolean)
    .join('+')
  return { ...out, accelerator, keycode, vk }
}
