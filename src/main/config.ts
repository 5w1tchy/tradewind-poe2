import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Config {
  /** Exact window title to attach the overlay to. */
  gameWindowTitle: string
  /** Treat any foreground window as the game — desktop testing without PoE2 running. */
  devAnyWindow: boolean
  /** Trade league id; '' = auto (first league from the API). */
  league: string
  /** Fractional spread below each roll for pre-checked stat mins. */
  spread: number
  /** Price-check hotkey ("Ctrl+D", "F6", "Ctrl+Alt+P"). WASD players: pick a
   *  key the game ignores until native key suppression lands. */
  priceCheckHotkey: string
  /** Hotkey that sends the /hideout chat command. */
  hideoutHotkey: string
  /** Auto-update channel: 'stable' tracks releases; 'demo' also gets pre-releases.
   *  No settings UI yet — edit config.json to opt into the demo channel. */
  updateChannel: 'stable' | 'demo'
  /** Popup size in CSS px. Persisted so a user's manual resize sticks across
   *  price checks and restarts (the renderer reports new sizes via tw:set-popup-size). */
  popupSize: { w: number; h: number }
  /** Height (CSS px) of the Price-tab results list — the stats list above it fills
   *  the rest. Persisted like popupSize (reported via tw:set-results-height). */
  resultsHeight: number
}

const defaults: Config = {
  gameWindowTitle: 'Path of Exile 2',
  devAnyWindow: false,
  league: '',
  spread: 0.1,
  priceCheckHotkey: 'Ctrl+D',
  hideoutHotkey: 'F5',
  updateChannel: 'stable',
  popupSize: { w: 520, h: 560 },
  resultsHeight: 200
}

// ---- Field coercion -------------------------------------------------------
// loadConfig builds a Config field-by-field from whatever is on disk rather than
// blindly spreading it. A wrong type, a missing field, a half-written nested
// object, or a schema that changed shape across an update all heal back to the
// default instead of leaking `undefined`/`NaN` into the app.

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** A finite number clamped to [min, max]; anything else (NaN, string, …) → fallback. */
function asNumber(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/**
 * Normalize an arbitrary parsed value into a valid Config. Exported for unit
 * tests. When a new field is added, add a line here (and to `defaults`) — old
 * configs missing it, or carrying a stale shape, are repaired automatically.
 */
export function sanitize(raw: unknown): Config {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const size = (o.popupSize && typeof o.popupSize === 'object' ? o.popupSize : {}) as Record<
    string,
    unknown
  >
  return {
    gameWindowTitle: asString(o.gameWindowTitle, defaults.gameWindowTitle),
    devAnyWindow: asBool(o.devAnyWindow, defaults.devAnyWindow),
    league: asString(o.league, defaults.league),
    spread: asNumber(o.spread, defaults.spread, 0, 1),
    priceCheckHotkey: asString(o.priceCheckHotkey, defaults.priceCheckHotkey),
    hideoutHotkey: asString(o.hideoutHotkey, defaults.hideoutHotkey),
    updateChannel: asEnum(o.updateChannel, ['stable', 'demo'] as const, defaults.updateChannel),
    popupSize: {
      w: asNumber(size.w, defaults.popupSize.w, 200, 20000),
      h: asNumber(size.h, defaults.popupSize.h, 200, 20000)
    },
    resultsHeight: asNumber(o.resultsHeight, defaults.resultsHeight, 40, 20000)
  }
}

export function saveConfig(config: Config): void {
  const file = join(app.getPath('userData'), 'config.json')
  try {
    writeFileSync(file, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('[config] failed to save:', err)
  }
}

export function loadConfig(): Config {
  const file = join(app.getPath('userData'), 'config.json')
  let config = sanitize({})
  try {
    if (existsSync(file)) {
      config = sanitize(JSON.parse(readFileSync(file, 'utf8')))
    }
  } catch (err) {
    console.error('[config] failed to load, using defaults:', err)
  }
  // Persist the normalized form: this creates the file on first run, heals any
  // malformed values, and writes keys a newer version added — so the on-disk
  // file always matches the current schema.
  saveConfig(config)
  return config
}
