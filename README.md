# Tradewind

A price-check overlay for **Path of Exile 2**. One hotkey on a hovered item → popup at your cursor with a price estimate and live trade listings.

> ⚠️ **Early development.** The overlay, hotkey → clipboard loop, item parser, and stat matcher work; live trade search and pricing are in progress. Not ready for general use yet.

## Why another trade tool?

Two bets:

1. **Smarter pricing** — aggregate comparable listings into an estimate (range + confidence), not just a raw listing dump.
2. **Patch-resilient mod matching** — the stats database is fetched live from the trade API at startup (cached, ETag-revalidated), so new mods added by GGG patches match on day one without waiting for an app update.

## How it works

- Press the hotkey (default `Ctrl+D`) with PoE2 focused → Tradewind synthesizes the game's advanced item copy (`Ctrl+Alt+C`), parses the clipboard text (your clipboard is restored), and shows a popup at your cursor.
- Clipboard + overlay only: no memory reading, no injection, no automation, one game action per keypress. Anonymous trade API use with a proper `User-Agent`; rate limits respected via the `X-Rate-Limit-*` headers.
- The game must run in **windowed fullscreen** (overlays can't draw over exclusive fullscreen).

## Development

```
npm install
npm run dev        # launch with hot reload (watches for the PoE2 window)
npm test           # parser + matcher test suite
npm run fixtures   # re-split fixtures/inbox.txt into per-item test fixtures
```

Test fixtures are real in-game `Ctrl+Alt+C` item copies in `fixtures/`. Found an item that parses wrong? Paste it into `fixtures/inbox.txt` (with a `=====` line between items) and open an issue or PR.

## License

[MIT](LICENSE)
