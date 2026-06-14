# Tradewind

A price-check overlay for **Path of Exile 2**. One hotkey on a hovered item → popup at your cursor with a price estimate and live trade listings.

> ⚠️ **Early development.** The overlay, hotkey → clipboard loop, item parser, and stat matcher work; live trade search and pricing are in progress. Not ready for general use yet.

## Install

Windows only. Grab the latest `tradewind-*-setup.exe` from the
[Releases](https://github.com/5w1tchy/tradewind-poe2/releases) page and run it.

The installer is **unsigned**, so Windows SmartScreen will warn on first run:
click **More info → Run anyway**. (Same posture as other PoE trade tools; signing
is planned once there's traction.) After install, Tradewind **auto-updates** in the
background from GitHub Releases — new versions download silently and install on exit,
with a "Restart now" toast if you'd rather update immediately.

> **Demo channel:** to opt into pre-release builds, set `"updateChannel": "demo"` in
> `config.json` (in `%APPDATA%/tradewind/`). Demo users still receive stable releases.
> A settings toggle for this is coming later.

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

### Releasing

Releases are built and published by GitHub Actions on a version tag. Bump
`package.json` `version`, then push a matching tag:

```
# Stable release -> latest.yml (auto-update for everyone)
git tag v0.2.0 && git push origin v0.2.0

# Demo / pre-release -> beta.yml (demo-channel users only)
git tag v0.2.0-beta.1 && git push origin v0.2.0-beta.1
```

The workflow (`.github/workflows/release.yml`) packages the NSIS installer and
uploads it alongside the channel update manifest to the GitHub Release. To build a
local installer without publishing: `npm run build:win` (output in `release/`).

## License

[MIT](LICENSE)
