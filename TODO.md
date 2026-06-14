# TODO

Running list of known issues and follow-ups not yet scheduled into a milestone.

## Bugs

- **WASD unresponsive on the first Ctrl+D (intermittent).** Occasionally the
  first price-check of a session leaves the character unable to move (WASD dead)
  until the user clicks back into the game — i.e. PoE2 momentarily loses keyboard
  focus. Pre-existing (not caused by the overlay/copy rework in
  `input.ts`/`overlay.ts`). Suspect a focus/timing hiccup around the first
  overlay show or the synthetic `Ctrl+Alt+C` on a "cold" first press. Needs
  logging of foreground-window / focus transitions around the first check to pin
  down. Clicking in-game resets it.

## Features

- **Runes that act like essences.** Some PoE2 runes/soul cores behave like
  essences for crafting (guaranteed/targeted mod outcomes). Fold them into the
  Craft tab's essence feature (`src/core/craft/essences.ts`,
  `scripts/gen-essences.mjs`, the essence assets) so they show up alongside
  essences in the crafting helper.

## Tech debt

- _(none open)_

  ~~Migrate the renderer from Vue 3 to React.~~ **Done 2026-06-14** — `src/renderer`
  is now React (.tsx + CSS Modules); `src/core` carried over unchanged and the
  Electron main/preload boundary is intact.
