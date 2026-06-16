# Changelog

All notable user-facing changes to Tradewind. Newest first. The top entry of
each release is reused verbatim as that release's GitHub Release notes.

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
