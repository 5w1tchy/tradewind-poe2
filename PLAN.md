# Tradewind — PoE2 Trade Companion

A price-check overlay for Path of Exile 2. One hotkey on a hovered item → popup at cursor with a trustworthy price estimate and live listings, in under a second. The Awakened PoE Trade formula, built for PoE2's instant-buyout era, with two bets that beat the incumbents:

1. **Smarter pricing** — aggregate comparable listings into an estimate (range + confidence), not just a raw listing dump. Instant buyout makes listed prices real, so aggregation is finally trustworthy. Long game: opt-in data collection from day one builds the dataset for a future ML price model (the poeprices.info gap nobody fills for PoE2).
2. **Better mod matching** — stats database is **live-fetched from the trade API at startup** (cached, ETag) with matchers generated at runtime, so new GGG mods work day-one without an app release. Directly attacks Exiled Exchange 2's "breaks every patch" weakness and Sidekick's wrong-mod matching.

## Locked decisions

| Decision | Choice |
|---|---|
| Name / repo | **Tradewind** (`tradewind-poe2`), User-Agent `tradewind/x.y.z (contact: chaideb123@gmail.com)` |
| Stack | Electron + TypeScript + Vue 3 (the proven APT/EE2 architecture; both are MIT — study freely) |
| Platform / audience | Public release, Windows, English client first |
| License | MIT, public repo from day one (trust currency of this niche) |
| Auth | Anonymous — **no POESESSID**. Buying = deep-link to the exact trade-site listing where the user clicks Secure Item |
| Popup UX | APT-style: instant auto-search with pre-checked sensible filters |
| v1 scope | Polished price check + **mod tier badges/highlighting** (T1 etc. from advanced copy). Nothing else |
| Out of scope v1 | Bulk/currency trading (in-game exchange covers it), whisper macros, map check, multi-language, Linux |
| v2+ roadmap | Mod-value highlighting (+3 skills on amulet etc.), filter-edit hotkey (hide a base via keypress), crafting helper (chaos + whittling omen reroll preview, poe2db-style mod pools), flip-margin finder, ML price model, gear-advice tips on price check ("bows want flat phys + attack speed this league" — per-class desirable-stat hints, meta-aware) |
| Distribution | GitHub releases, electron-updater auto-update, NSIS installer, unsigned (SmartScreen click-through, same as EE2) |
| Data collection | Opt-in anonymized (item text + listings seen) → Cloudflare Worker + D1/R2, free tier |

## How the core loop works (PoE2, mid-2026 reality)

1. Global hook sees the hotkey (default `Ctrl+D`) while PoE2 is the focused window; keypress is swallowed.
2. App synthesizes `Ctrl+Alt+C` (advanced item description — includes mod tiers and ranges), polls the clipboard, restores the previous clipboard contents.
3. Parser splits the item text (`--------` sections) into a structured item: class, rarity, base, ilvl, quality, sockets/runes, mods with tier + roll info.
4. Matcher maps each mod line → trade-site stat ID (`explicit.stat_*`, `rune.*`, `enchant.*`, …) using the runtime-generated matcher DB. Pseudo-stat rules (total life, total resists) fold equivalent mods together.
5. Query builder produces a `POST /api/trade2/search/poe2/{league}` body with pre-checked filters (roll ranges with configurable spread, ilvl, corruption, etc.); listings fetched via `GET /api/trade2/fetch/{ids}?query={id}` (≤10 per call).
6. Pricing engine normalizes listing prices through exalted (divine ratio pulled live; oddball-currency listings ignored), rejects outliers, renders **estimate range + confidence + listings** in the popup at cursor.
7. Click a listing → opens that exact listing on the official trade site (overlay browser or default browser) for the Secure Item buyout.

ToS posture: clipboard + overlay only, no memory reading, one game action per keypress, dynamic rate limiting from `X-Rate-Limit-*` headers (pre-throttle, honor `Retry-After`), honest User-Agent.

## Architecture

```
tradewind/
├─ main/          Electron main process (TypeScript)
│   ├─ overlay window manager   transparent, frameless, always-on-top, click-through via
│   │                           setIgnoreMouseEvents(true, {forward:true}); tracks PoE2 window
│   │                           position/focus via Win32; toggles interactivity over widgets
│   ├─ input                    uiohook-napi global hotkeys; synthetic Ctrl+Alt+C; clipboard
│   │                           poll + restore
│   ├─ api gateway              localhost proxy all GGG/poe2scout calls flow through; ONE
│   │                           rate-limit queue parsing X-Rate-Limit headers; caching
│   ├─ config store             settings JSON (hotkeys, league, spread %, opt-in flag)
│   └─ updater                  electron-updater against GitHub releases
├─ renderer/      Vue 3 + Vite + Tailwind
│   ├─ price-check popup        filters UI, tier badges, estimate, listings
│   ├─ settings window
│   └─ widget shell             (future: crafting panel, filter editor)
├─ core/          pure TypeScript, no Electron imports — unit-testable
│   ├─ parser/                  clipboard text → ParsedItem
│   ├─ stats-db/                fetch+cache /api/trade2/data/{stats,items,static}, ETag;
│   │                           runtime matcher generation (text with # placeholders → regex);
│   │                           pseudo rules; RESERVED SLOT: poe2db mod-pool data for v2
│   │                           crafting/highlight features
│   ├─ matcher/                 mod line → stat ID(s), incl. hybrid/rune/desecrated handling
│   ├─ query/                   ParsedItem + user filters → trade2 query JSON
│   └─ pricing/                 normalization, outlier rejection, estimate + confidence
├─ telemetry/     opt-in anonymized logging client (+ /infra: CF Worker, D1 schema)
└─ fixtures/      real clipboard samples (the test corpus — see M1)
```

Design rules: `core/` stays pure (fast tests, no Electron); every network call goes through the api gateway; the stats DB is rebuilt from live data but ships a baseline snapshot as fallback for first-run/offline.

## Milestones

- **M0 — Proof of the loop.** Repo, Electron skeleton, transparent click-through overlay over PoE2, global hotkey, synthetic copy + clipboard read, raw item text shown in a popup at cursor. *Riskiest plumbing first.*
- **M1 — Parse & match.** Item parser + live stats DB + matcher. Built against a fixtures corpus of real `Ctrl+Alt+C` samples (rares with hybrids, runed items, uniques, waystones, jewels, charms, corrupted/desecrated). Unit tests per fixture.
- **M2 — Search.** Query builder, rate-limited API client, popup shows live listings with filter checkboxes and re-search. League selector (from `/api/trade2/data/leagues` equivalent).
- **M3 — Price brain.** ✅ (2026-06-11) Currency normalization (live divine:exalt), outlier rejection, estimate range + confidence display, tier badges/high-tier highlighting. Grew: poe2scout anchor cross-check, local-stat matching, base extraction for magic/white/unid-unique names, rarity selector.
- **M3.5 — Currency truth.** CF Worker with GGG OAuth (`service:cxapi`) pulling official in-game Currency Exchange hourly digests; app reads stackable headline prices from it. Kills the site-ask/Ange bracket problem. Prereq: apply for the OAuth client early — GGG approval takes time.
- **M4 — Ship it.** Friends-QA build first (NSIS unsigned, bundled data cache, SmartScreen note), then settings UI, locked-popup mode (`Ctrl+Alt+D`), open-listing-in-browser, auto-update, README/docs, first public GitHub release.
- **M5 — Long game.** CF Worker endpoint + opt-in logging toggle. Dataset starts growing for the v2 ML model.

## Risks & mitigations

- **GGG changes clipboard format / stat text mid-league** → live-fetch DB covers stat IDs; parser fixtures make format breaks loud and fast to fix; keep an "unmatched mod" graceful path (warn, exclude from query) instead of failing the whole check.
- **Rate limits at league start** → single queue, pre-throttle, cached results per identical item, instant-estimate path can come from cached economy data without hitting search.
- **Overlay vs fullscreen-exclusive** → require windowed-fullscreen (industry standard; APT/EE2/Sidekick all do); detect and warn.
- **Trade2 API is unofficial** → respectful client behavior + honest UA is the only insurance; same boat as every other tool.
- **Unsigned installer SmartScreen** → document the click-through; revisit signing once there's traction.

## Open homework

- [ ] User: collect `Ctrl+Alt+C` clipboard samples in-game across item classes → `fixtures/` (do this while playing normally; 30–50 diverse items is a great corpus)
- [ ] User: create GitHub repo `tradewind-poe2` (or hand over a name preference change before M0)
- [ ] User: free Cloudflare account before M5
- [ ] Dev: verify current league name + exact rate-limit header values live at M2 (do not hardcode)
