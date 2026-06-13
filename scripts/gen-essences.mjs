/**
 * Generate src/core/craft/essences.json from poe2db's Essence page.
 *
 *   node scripts/gen-essences.mjs [path-to-saved-essence.html]
 *
 * poe2db renders client data we can't get from repoe-fork (the essence ->
 * guaranteed-mod table per item category). Re-run after PoE2 patches; the
 * output is committed so the app never scrapes at runtime.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const URL = 'https://poe2db.tw/us/Essence'
const OUT = new globalThis.URL('../src/core/craft/essences.json', import.meta.url)
const ICON_DIR = new globalThis.URL('../src/renderer/src/assets/essences/', import.meta.url)

const html = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : await (await fetch(URL, { headers: { 'User-Agent': 'tradewind-gen/0.0.1' } })).text()

/** Strip tags, decode the entities poe2db actually uses, squeeze whitespace. */
function clean(fragment) {
  return fragment
    .replace(/<span class="ndash">—<\/span>/g, '–')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

// Each essence card links its base-item metadata id; cards live in the
// "Essence" tab pane. Split on the card cells and parse each independently.
const pane = html.slice(html.indexOf('<div id="Essence"'), html.indexOf('<div id="EssenceStashTab"'))
const cards = pane.split('<div class="col">').slice(1)

const essences = []
for (const card of cards) {
  const id = card.match(/Currency%2F(Currency[A-Za-z0-9]+)/)?.[1]
  const name = clean(card.match(/height="16" \/>([^<]+)<\/a>/)?.[1] ?? '')
  if (!id || !name) continue
  const iconUrl = card.match(/<img loading="lazy" src="(https:\/\/cdn\.poe2db\.tw\/[^"]+\.webp)"/)?.[1]

  const modLines = [...card.matchAll(/<div class="explicitMod">(.*?)<\/div>/gs)].map((m) =>
    clean(m[1])
  )
  if (modLines.length === 0) continue

  // First explicitMod is the behavior sentence; the rest are
  // "Category[, Category…]: mod text" lines.
  const [behavior, ...rest] = modLines
  const mods = []
  for (const line of rest) {
    const m = line.match(/^([A-Za-z][A-Za-z, ]*?): (.+)$/)
    if (m) {
      // "Belt, Boots, Gloves, Helmet or Jewellery" -> individual tokens.
      const targets = m[1].split(/,| or /).map((t) => t.trim()).filter(Boolean)
      mods.push({ targets, text: m[2] })
    } else {
      mods.push({ targets: ['Any'], text: line })
    }
  }

  essences.push({ id, name, behavior, mods, iconUrl })
}

if (essences.length < 50) {
  console.error(`Parsed only ${essences.length} essences — page layout changed?`)
  process.exit(1)
}

// Surface the distinct target tokens so the item-class mapping in
// essences.ts can be kept in sync by eye.
const tokens = new Set()
for (const e of essences) for (const m of e.mods) for (const t of m.targets) tokens.add(t)

// Bundle the item art locally: the overlay's CSP (img-src 'self') is right
// for an app that reads the game's screen, so no CDN hotlinking at runtime.
mkdirSync(ICON_DIR, { recursive: true })
let downloaded = 0
for (const e of essences) {
  if (!e.iconUrl) continue
  const file = new globalThis.URL(`${e.id}.webp`, ICON_DIR)
  if (!existsSync(file)) {
    // Some files 403 without a Referer (hotlink protection).
    const res = await fetch(e.iconUrl, {
      headers: { 'User-Agent': 'tradewind-gen/0.0.1', Referer: URL }
    })
    if (!res.ok) {
      console.warn(`icon ${e.id}: HTTP ${res.status}`)
      continue
    }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    downloaded++
    await new Promise((r) => setTimeout(r, 150))
  }
  e.icon = `${e.id}.webp`
}
for (const e of essences) delete e.iconUrl

writeFileSync(OUT, JSON.stringify({ generatedFrom: URL, essences }, null, 1))
console.log(`Wrote ${essences.length} essences, downloaded ${downloaded} icons.`)
console.log('Target tokens:', [...tokens].sort().join(' | '))
