/**
 * Generate src/core/mod-pool/{pool.json,bases.json} from repoe-fork's
 * client-extracted PoE2 data (mods + base_items).
 *
 *   node scripts/gen-mod-pool.mjs
 *
 * Reads scratch/mods.min.json + scratch/base_items.min.json if present
 * (the local repoe-fork dumps); otherwise fetches them from
 * https://repoe-fork.github.io/poe2/. Output is committed so the app never
 * fetches at runtime. Re-run after PoE2 patches rebalance mods.
 *
 * Why this exists: a chat-linked item copies in the *basic* clipboard form —
 * bare mod lines with no "{ Prefix … (Tier: N) }" headers — so the parser
 * can't read affix/tier from the text (see src/core/parser/parse.ts). This
 * pool lets src/core/mod-pool reconstruct affix + tier from the rolled value:
 * match the mod text, keep only brackets the roll falls into, read back the
 * mod's generation_type and its tier index within the group.
 *
 * The slimming mirrors src/core/stats-db normalization so the same clipboard
 * templates that match the trade stats DB also key into this pool.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BASE_URL = 'https://repoe-fork.github.io/poe2'
const SCRATCH = new URL('../scratch/', import.meta.url)
const OUT_DIR = new URL('../src/core/mod-pool/', import.meta.url)

async function load(name) {
  const local = new URL(name, SCRATCH)
  if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'))
  const res = await fetch(`${BASE_URL}/${name}`, {
    headers: { 'User-Agent': 'tradewind-gen/0.0.1' }
  })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json()
}

const mods = await load('mods.min.json')
const bases = await load('base_items.min.json')

// --- Text normalization, kept in lockstep with src/core/stats-db/statsDb.ts.
// repoe text carries link markup "[Display|key]" / "[Display]" and rolls as
// "(min-max)" ranges; trade/clipboard templates use "#". Collapse a range to a
// single number first so the shared number->'#' pass sees one token, then drop
// the '+' the trade texts never carry.
function resolveLinks(text) {
  return text
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
}

function normalize(text) {
  return resolveLinks(text)
    .replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, '$1') // range -> its min
    .replace(/-?\d+(?:\.\d+)?/g, '#') // every number (roll or literal) -> #
    .replace(/\+#/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
}

// Ordered spawn rule, compactly. PoE evaluates spawn_weights in order: the
// FIRST tag the base has decides the weight (> 0 means it can roll). A naive
// "any positive tag" test wrongly counts tiers a base can't roll (a specific
// "crossbow: 0" before "weapon: 1" blocks crossbows), which inflates tier
// counts. We keep the list in order up to the last positive (anything after it,
// or no match at all, means "doesn't spawn"); a weight-0 tag is prefixed "!".
function spawnRule(mod) {
  const sw = mod.spawn_weights ?? []
  let lastPos = -1
  sw.forEach((w, i) => {
    if (w.weight > 0) lastPos = i
  })
  return sw.slice(0, lastPos + 1).map((w) => (w.weight > 0 ? w.tag : `!${w.tag}`))
}

// Display brackets, parsed from the *text* in order — NOT from `stats`, whose
// units and sign can differ from what the clipboard shows (leech stats are
// permyriad 600-690 while the copy reads "6-6.9%"; "reduced" mods store -35 but
// display "35% reduced"). The text is exactly the clipboard's form, so a rolled
// value matches directly. A "(min-max)" is a roll bracket; a bare number is a
// fixed-value tier (or a literal like "per 100") → [n,n]. Literals line up
// because the parser templates them the same way on the clipboard side.
const TOKEN = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?)/g
function displayBrackets(text) {
  const out = []
  for (const m of resolveLinks(text).matchAll(TOKEN)) {
    if (m[1] !== undefined) out.push([Number(m[1]), Number(m[2])])
    else out.push([Number(m[3]), Number(m[3])])
  }
  return out
}

const entries = []
for (const key in mods) {
  const mod = mods[key]
  if (mod.domain !== 'item') continue
  const gen = mod.generation_type
  if (gen !== 'prefix' && gen !== 'suffix') continue
  if (!mod.text) continue
  // An empty rule (no positive spawn weight) marks a mod that can't be randomly
  // rolled — applied deliberately (essences, etc.). Keep it; the matcher reads
  // an empty rule as "any base" but only uses such mods as a fallback when the
  // stat has no normally-rolled version on the base, so they never make a
  // regular stat ambiguous.
  const tags = spawnRule(mod)

  entries.push({
    t: normalize(mod.text),
    g: mod.groups?.[0] ?? key, // groups encode reroll-exclusivity (one tier ladder)
    a: gen === 'prefix' ? 'p' : 's',
    r: mod.required_level ?? 1,
    b: displayBrackets(mod.text),
    w: tags
  })
}

if (entries.length < 1000) {
  console.error(`Only ${entries.length} pool entries — source layout changed?`)
  process.exit(1)
}

// Jewel mods live in the 'misc' domain (gear is 'item'); extract them as a
// separate group lookup for the liquid mod-group-conflict gate (#78). Only
// text -> group(s) + affix is needed (a conflict is by group, with no tier), so
// this is far leaner than the gear ladder and is kept apart from `entries` so it
// can never pollute gear tier reconstruction (the same stat text — e.g.
// "increased Area of Effect" — exists in both domains under different groups).
const jewelEntries = []
for (const key in mods) {
  const mod = mods[key]
  if (mod.domain !== 'misc') continue
  const gen = mod.generation_type
  if (gen !== 'prefix' && gen !== 'suffix') continue
  if (!mod.text || !mod.groups?.length) continue
  jewelEntries.push({
    t: normalize(mod.text),
    g: mod.groups, // full group list — jewel mods occasionally carry two
    a: gen === 'prefix' ? 'p' : 's'
  })
}

// Base name -> spawn tags. Names collide rarely; later wins (good enough — the
// tag sets for a duplicated base name are equivalent for spawn matching).
const baseTags = {}
for (const id in bases) {
  const base = bases[id]
  if (base.name && Array.isArray(base.tags)) baseTags[base.name] = base.tags
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
  new URL('pool.json', OUT_DIR),
  JSON.stringify({ generatedFrom: BASE_URL, entries, jewelEntries }, null, 0)
)
writeFileSync(
  new URL('bases.json', OUT_DIR),
  JSON.stringify({ generatedFrom: BASE_URL, baseTags }, null, 0)
)

console.log(
  `Wrote ${entries.length} pool entries, ${jewelEntries.length} jewel entries, ` +
    `${Object.keys(baseTags).length} bases.`
)
