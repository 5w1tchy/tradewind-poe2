import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Config {
  /** Exact window title to attach the overlay to. */
  gameWindowTitle: string
  /** Treat any foreground window as the game — desktop testing without PoE2 running. */
  devAnyWindow: boolean
}

const defaults: Config = {
  gameWindowTitle: 'Path of Exile 2',
  devAnyWindow: false
}

export function loadConfig(): Config {
  const file = join(app.getPath('userData'), 'config.json')
  try {
    if (existsSync(file)) {
      return { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) }
    }
    writeFileSync(file, JSON.stringify(defaults, null, 2))
  } catch (err) {
    console.error('[config] failed to load, using defaults:', err)
  }
  return { ...defaults }
}
