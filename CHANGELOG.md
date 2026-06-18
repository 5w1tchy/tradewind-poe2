# Changelog

All notable user-facing changes to Tradewind. Newest first. The top entry of
each release is reused verbatim as that release's GitHub Release notes.

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
