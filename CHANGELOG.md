# Changelog

All notable user-facing changes to Tradewind. Newest first. The top entry of
each release is reused verbatim as that release's GitHub Release notes.

## v0.2.0

### 🛠️ Search works again after the June league patch
The **Runes of Aldur** patch changed the trade site's item format, which made
every price check fail with an error the moment results came back. This release
fixes that — searches parse and display listings again, and mod **tiers** are
read straight from the new format. If your price check stopped working today,
this is the fix. (#93)

### 🔮 Unidentified uniques show what they might be
Hover an **unidentified unique** and Tradewind now lists **every unique that
drops on that base**, ranked by market price (from poe2scout) — so you get a
read on whether it's worth identifying before you spend the Scroll. Identified
uniques keep their single instant price banner. (#88)

### 💠 Gem price checks + Uncut Support Gem prices
Skill and Spirit gems get a **dedicated filter view** — it arms Gem Level,
Quality, Gem Sockets, and Corruption to the gem's own values so you find ones at
least as good. And because regular support gems aren't traded directly, hovering
a **cuttable support gem** now shows a banner of **Uncut Support Gem** prices
(levels 1–5) so you can see the realistic cost to make one. (#58)

### ⚗️ Runic Alloy craft advisor
The **Craft** tab has a new **Alloys** section for **Verisium (Runic) Alloys**.
Hover a Rare item and Tradewind shows which alloys apply and the exact modifier
each one guarantees for that item class — greying out any that the game would
refuse because the item already has a conflicting modifier, the same way it
already does for essences. (#51)

### 🎚️ Smarter filters by default
- The **item-level filter** is now capped at **82** (the level where every
  rollable mod reaches its top tier), so a high-ilvl search still matches every
  equivalent listing instead of needlessly narrowing. It defaults **on** for
  white/Normal bases (where ilvl is the thing you're buying) and stays opt-in
  for Magic/Rare. (#84)
- **Quality** and **Gem Sockets** now default **on** for exceptional items, so
  the things that define their price are checked from the start. (#14)

### ✨ Cleaner Miscellaneous section
The Miscellaneous filters were reworked with a **centered legend** and
**tri-state chips**, making it clearer at a glance which toggles are required,
excluded, or ignored. (#57)

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.17...v0.2.0

## v0.1.17

### 💎 Instant price banner for uniques
Hovering a **unique** now shows an **aggregate market price** (from poe2scout) the
moment the popup opens — a quick ballpark in Exalted, Divine, and Chaos, styled
as a sliver of the item's own tooltip. The live trade search no longer runs
automatically for uniques; it **arms the Search button** instead (like rares),
so you get the price at a glance and only hit the trade site when you want the
per-roll listings. (#80)

### 💧 Liquid Emotion advisor for jewel crafting
The **Craft** tab has a new **Liquids** section for **Liquid Emotions** — the
jewel-crafting counterpart to essences. Hover a Rare jewel and Tradewind shows
which liquids apply and the exact modifier each one would add, keyed to the
jewel's base (Time-Lost vs basic, and the right attribute for Ruby / Sapphire /
Emerald / Diamond). Wildcard and **Potent** liquids that can land one of several
mods are tagged "rolls one of". (#48)

### 🚫 Craft advice flags conflicting modifiers
On the **Craft** tab, an essence or liquid whose guaranteed modifier would clash
with one already on the item is now shown **greyed out with the reason** — e.g.
*blocked by "+38% to Cold Resistance"* — instead of being listed as if it would
work. The game refuses these crafts because two modifiers can't share a group,
and Tradewind now matches that for Perfect/corrupted essences on Rares, Greater
essences upgrading a Magic item, and Liquid Emotions on Rare jewels. It even
tells prefix and suffix versions of the same stat apart (a suffix Rarity mod
blocks Greater Essence of Opulence, a prefix one doesn't). (#72, #78)

### 🔄 Startup updates explain themselves
When Tradewind installs an update at startup it used to just vanish and reappear
on a new version — a mystery restart. Now the **splash screen narrates it**
(*Updating to vX.Y.Z… → Downloading N% → Restarting…*), so you can see what's
happening before you're in-game. (#65)

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.16...v0.1.17

## v0.1.16

### 🔍 Find craftable bases by their open modifier slots
A new filter lets you search by **how many prefix and suffix slots are empty** —
e.g. "1 open prefix and 2 open suffixes" — so you can hunt down the right
craftable base instead of eyeballing every listing. Offered on rares and magic
items. (#22)

### 🧪 Essence advice now knows the crafted-mod cap
On the **Craft** tab, a Perfect or corrupted Essence augments a Rare with a
guaranteed modifier in its single **crafted** slot — so the game blocks it when
that slot is already full. Tradewind now spots this and shows a plain reason
instead of listing essences you can't use. It also accounts for **Astrid's
Creativity**, which raises the cap to two crafted mods. (#24)

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.15...v0.1.16

## v0.1.15

### 🪙 The buyout-price currency now sticks
The buyout-price filter used to reset to **Exalted Orb Equivalent** on every
price check. Now Tradewind **remembers the last currency you picked** (Divine,
Chaos, …) and defaults to it on the next item — and across restarts. (#20)

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.14...v0.1.15

## v0.1.14

### 🪙 Currency & exchange items get a price and a chart
Price-checking anything the in-game **Currency Exchange** trades — currency,
fragments, runes, essences, lineage support gems, and more — now shows an
**aggregate market price** in Exalted, Divine, and Chaos, plus a **price &
volume chart** of its recent history, instead of an empty listing search. (#56)

### 🏷️ Mod-origin tags on your stats
Each stat row now shows a small colored tag after its prefix/suffix badge, so
you can tell a mod's origin at a glance:

- **F** fractured · **C** crafted · **D** desecrated · **E** enhanced
  (anoint/enchant) · **CE** corruption-enhanced — each colored to match its
  in-game origin.
- A chat-linked item shows an enhancement as **E** (the game doesn't reveal
  corruption in a chat link); an inventory copy tells **CE** apart. (#54)

### 🧬 Fractured mods read correctly
Fractured mods now display as the **prefix or suffix they actually are**, with
proper tier badges — instead of being lumped in with the pseudo totals. (#53)

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.13...v0.1.14

## v0.1.13

### 🏷️ Tier badges on chat-linked items
Price-checking an item linked in **chat** now looks just like checking one from
your **inventory** — same prefix/suffix grouping and `P#`/`S#` **tier badges**,
plus the `=`/`%`/`T` quick buttons (including **Match Tier**).

A chat-linked copy leaves out the tier/affix info the game includes for an
inventory copy, so Tradewind now reconstructs it from the rolled values:

- Prefixes and suffixes are **grouped and tier-badged**, including
  **crafted**, **desecrated**, and **essence** mods.
- **Match Tier** works on these too, with proper decimals for stats like
  Critical Hit Chance and Attacks per Second.
- When a roll is genuinely undecidable (a value that could be either a prefix
  or a suffix), Tradewind leaves it **unbadged rather than guess wrong** — but
  it resolves automatically once the item's other mods fill one side.

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.12...v0.1.13

## v0.1.12

### 🌐 Updates won't spike your ping mid-match
Tradewind no longer downloads updates silently in the background — a download
mid-game could cause a ping spike at the worst possible moment.

- New updates are now downloaded **only with your say-so**: when you click
  **Update** on the in-app toast, or quietly at startup (before you're in a
  match). Once a download finishes, the app restarts to install right away —
  no extra "restart now?" prompt, since you already opted in.
- The **Update** toast now shows live progress while downloading and an
  installing state, so you can see exactly what's happening.

### 🎨 Themed tray menu & update dialogs
The last bits of plain Windows chrome now match the in-game overlay's look:

- The **tray menu** (click the tray icon) is now a themed popup styled like the
  overlay, instead of the default grey Windows menu — and it opens on either a
  left or right click.
- The **Check for updates…** dialogs are themed to match too, walking through
  Checking… → Available → Downloading → relaunch in one window.
- The app **version** now appears on the startup splash and in the tray menu.

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.11...v0.1.12

## v0.1.11

### 📐 Resize the popup — and it remembers
The price-check popup is now a proper resizable window:

- **Drag the bottom-right corner** to set its size. Your choice is **saved** and restored on every price check and after a restart — no more resizing each time.
- It now opens **toward the top-middle** of the screen, closer to where the game shows its own item tooltip.
- The window **keeps its size when you switch tabs** — flipping between **Price** and **Craft/Essences** no longer makes it jump around.

### 📊 More stats, resizable results
- The stats list now **fills the available space**, so you see far more mods at a glance instead of a cramped few with empty space below.
- Once results load, **drag the grip above the listings** to make the results list taller or shorter; the stats list takes the rest. That height is **remembered** too.

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.10...v0.1.11

## v0.1.10

### 🛠️ Stability
- Fixed a rare **"A JavaScript error occurred in the main process"** crash
  dialog that could appear during the auto-update **restart-to-install**. A
  mouse-move handler could fire a moment after the overlay was torn down; it
  now bows out cleanly so the update installs without interruption (#37).

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.9...v0.1.10

## v0.1.9

### 📌 Pin & click-away to close
The price-check popup now behaves like Path of Exile 2's own item tooltip:

- **Click anywhere outside the popup to close it** — and that click still reaches the game.
- A new **pin button** sits in the top-right of the header. Click it to pin the popup (its icon becomes an **✕**). While pinned:
  - clicking away no longer closes it, and
  - price-checking another item **updates the same window in place** and stays pinned — great for comparing items back-to-back.
- A pinned popup closes only via its **✕** or **Esc**. Each new check starts unpinned again.

### ⚔️ Weapon & defence filters
- The **DPS** and **defence** rows' `=` button now **cycles** between a smart "90% of your roll" minimum and your exact roll — one click to loosen or tighten, just like the modifier rows.
- Physical/attack weapons now expose **Attacks per Second** and **Critical Hit Chance** as searchable filters (with their real fractional values).

---
**Full changelog:** https://github.com/5w1tchy/tradewind-poe2/compare/v0.1.8...v0.1.9
