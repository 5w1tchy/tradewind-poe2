import { describe, expect, it, vi } from 'vitest'
import { sanitize } from './config'

// config.ts imports `app` from electron only for the load/save file paths; the
// pure `sanitize` we test here never touches it. Stub the module so the import
// resolves under the node test environment (vi.mock is hoisted above the import).
vi.mock('electron', () => ({ app: { getPath: () => '.' } }))

describe('config sanitize', () => {
  it('fills every field from defaults for an empty/garbage input', () => {
    for (const raw of [{}, null, undefined, 42, 'nonsense', []]) {
      const c = sanitize(raw)
      expect(c.gameWindowTitle).toBe('Path of Exile 2')
      expect(c.spread).toBe(0.1)
      expect(c.updateChannel).toBe('stable')
      expect(c.popupSize).toEqual({ w: 520, h: 560 })
      expect(c.resultsHeight).toBe(200)
    }
  })

  it('keeps valid values untouched', () => {
    const c = sanitize({
      league: 'Standard',
      spread: 0.25,
      updateChannel: 'demo',
      popupSize: { w: 700, h: 480 },
      resultsHeight: 150
    })
    expect(c.league).toBe('Standard')
    expect(c.spread).toBe(0.25)
    expect(c.updateChannel).toBe('demo')
    expect(c.popupSize).toEqual({ w: 700, h: 480 })
    expect(c.resultsHeight).toBe(150)
  })

  it('heals a half-written nested popupSize without leaking undefined/NaN', () => {
    const c = sanitize({ popupSize: { w: 640 } })
    expect(c.popupSize.w).toBe(640)
    expect(c.popupSize.h).toBe(560) // missing → default, not NaN
  })

  it('rejects wrong types and a changed nested shape, falling back to defaults', () => {
    const c = sanitize({
      resultsHeight: 'big',
      spread: 'lots',
      popupSize: 999, // shape changed object → number
      updateChannel: 'beta' // not in the enum
    })
    expect(c.resultsHeight).toBe(200)
    expect(c.spread).toBe(0.1)
    expect(c.popupSize).toEqual({ w: 520, h: 560 })
    expect(c.updateChannel).toBe('stable')
  })

  it('clamps out-of-range numbers into their safe band', () => {
    expect(sanitize({ popupSize: { w: 5, h: 99999 } }).popupSize).toEqual({ w: 200, h: 20000 })
    expect(sanitize({ resultsHeight: -10 }).resultsHeight).toBe(40)
    expect(sanitize({ spread: 9 }).spread).toBe(1)
    expect(sanitize({ popupSize: { w: NaN, h: Infinity } }).popupSize).toEqual({ w: 520, h: 560 })
  })
})
