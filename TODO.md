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

- **Migrate the renderer from Vue 3 to React.** Move the overlay UI off Vue 3
  onto React. Core logic under `src/core` (parser, query, craft) is
  framework-agnostic and should carry over unchanged; the work is the renderer
  layer (`src/renderer`). Plan the migration component-by-component and keep the
  Electron main/preload boundary intact.
