import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const USER_AGENT = 'tradewind/0.0.1 (contact: nishnianidze.n@yahoo.com)'

/** Default: don't re-validate against GGG more often than this. */
const DEFAULT_FRESH_MS = 12 * 60 * 60 * 1000

interface CacheMeta {
  etag: string | null
  fetchedAt: number
}

/**
 * Fetch a GGG data endpoint with disk cache + ETag revalidation.
 * Resolution order:
 *  1. disk cache younger than 12h — no network at all
 *  2. conditional GET (If-None-Match) — 304 keeps cache, 200 refreshes it
 *  3. network failed — stale cache if present, else the bundled snapshot
 *
 * This is what makes new GGG mods work day-one without an app update.
 *
 * `freshMs` overrides the no-network window — GGG static data (stats/items)
 * barely changes so it defaults to 12h, but price snapshots want it shorter.
 */
export async function cachedFetchJson<T>(
  name: string,
  url: string,
  freshMs: number = DEFAULT_FRESH_MS
): Promise<T> {
  const dir = join(app.getPath('userData'), 'cache')
  mkdirSync(dir, { recursive: true })
  const dataFile = join(dir, `${name}.json`)
  const metaFile = join(dir, `${name}.meta.json`)

  let meta: CacheMeta | null = null
  if (existsSync(dataFile) && existsSync(metaFile)) {
    try {
      meta = JSON.parse(readFileSync(metaFile, 'utf8')) as CacheMeta
    } catch {
      meta = null
    }
  }

  if (meta && Date.now() - meta.fetchedAt < freshMs) {
    return JSON.parse(readFileSync(dataFile, 'utf8')) as T
  }

  try {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
    if (meta?.etag) headers['If-None-Match'] = meta.etag

    const res = await fetch(url, { headers })

    if (res.status === 304 && meta) {
      writeFileSync(metaFile, JSON.stringify({ ...meta, fetchedAt: Date.now() }))
      return JSON.parse(readFileSync(dataFile, 'utf8')) as T
    }
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)

    const text = await res.text()
    writeFileSync(dataFile, text)
    writeFileSync(
      metaFile,
      JSON.stringify({ etag: res.headers.get('etag'), fetchedAt: Date.now() } satisfies CacheMeta)
    )
    console.log(`[data] refreshed ${name} from ${url}`)
    return JSON.parse(text) as T
  } catch (err) {
    if (meta) {
      console.warn(`[data] ${name}: network failed, using stale cache:`, err)
      return JSON.parse(readFileSync(dataFile, 'utf8')) as T
    }
    const bundled = join(app.getAppPath(), 'data/trade-api-cache', `${name}.json`)
    if (existsSync(bundled)) {
      console.warn(`[data] ${name}: network failed, using bundled snapshot:`, err)
      return JSON.parse(readFileSync(bundled, 'utf8')) as T
    }
    throw err
  }
}
