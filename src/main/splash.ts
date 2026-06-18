import { app, BrowserWindow } from "electron";
import { readFileSync } from "node:fs";
import splashAsset from "../../build/splash.png?asset";

// The branded card shown dead-centre while the app warms up (data fetches,
// update check). build/ isn't packed into the asar, but `?asset` copies the
// PNG into the build output so it loads in dev and the packaged app alike; we
// inline it as a data URL so the frameless transparent window has nothing to
// fetch over a protocol. Source art is 986x555 (~16:9); shown at half size.
const WIDTH = 520;
const HEIGHT = Math.round((WIDTH * 555) / 986);

// Fade duration for both the in and out transitions. Driven by a CSS opacity
// transition on the image (GPU-composited, smooth) rather than window opacity,
// which is unreliable on transparent windows.
const FADE_MS = 280;

export interface Splash {
  /** Fade the card out, then destroy the window. Idempotent. */
  close(): void;
  /**
   * Replace the version label with a status line (e.g. "Updating to v0.1.14…").
   * Used by the startup auto-update path so a silent download+relaunch isn't a
   * mystery restart. Pass null to restore the plain version label.
   */
  setStatus(text: string | null): void;
}

/**
 * Create and show the startup splash, centered and always-on-top. It fades in
 * on its own; the caller fades it out via `close()` once the app is ready (see
 * index.ts).
 */
export function createSplashWindow(): Splash {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    center: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { sandbox: true },
  });
  win.setMenu(null);
  // Sit above a windowed-fullscreen game (plain alwaysOnTop loses to it) and let
  // every click fall through to the game — the card is purely decorative, so it
  // must never grab input. Same recipe as the price-check overlay (overlay.ts).
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true);

  const dataUrl = `data:image/png;base64,${readFileSync(splashAsset).toString("base64")}`;
  // Version label sat just under the right end of the wordmark (below the final
  // "D"), right-aligned, fading in with the card. Positioned by percentage so it
  // tracks the artwork as the card scales.
  const version = app.getVersion();
  const html =
    '<!doctype html><meta charset="utf-8">' +
    "<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}" +
    "body{display:flex;align-items:center;justify-content:center}" +
    "#card{position:relative;width:100%;height:100%}" +
    `img{width:100%;height:100%;object-fit:contain;-webkit-user-drag:none;user-select:none}` +
    "#ver{position:absolute;right:17.4%;top:53.2%;font:600 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;" +
    "color:hsl(44 42% 63% / 1);letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.6)}" +
    `#card{opacity:0;transition:opacity ${FADE_MS}ms ease}</style>` +
    `<div id="card"><img src="${dataUrl}"><span id="ver">v${version}</span></div>`;
  void win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);

  // showInactive: appear without stealing focus from whatever is up front. Kick
  // the fade-in only after the first paint so the transition actually animates
  // from 0 rather than snapping to 1.
  win.once("ready-to-show", () => {
    win.showInactive();
    void win.webContents
      .executeJavaScript(
        "requestAnimationFrame(()=>{const e=document.getElementById('card');if(e)e.style.opacity='1'})",
      )
      .catch(() => {});
  });

  let closing = false;
  const close = (): void => {
    if (closing || win.isDestroyed()) return;
    closing = true;
    void win.webContents
      .executeJavaScript("const e=document.getElementById('card');if(e)e.style.opacity='0'")
      .catch(() => {});
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, FADE_MS);
  };

  const setStatus = (text: string | null): void => {
    if (closing || win.isDestroyed()) return;
    // The version label doubles as the status slot: a startup update swaps it
    // from "v0.1.14" to "Updating to v0.1.14…". JSON.stringify both escapes the
    // string and quotes it for safe injection.
    const label = text === null ? `"v${version}"` : JSON.stringify(text);
    void win.webContents
      .executeJavaScript(`{const e=document.getElementById('ver');if(e)e.textContent=${label}}`)
      .catch(() => {});
  };

  return { close, setStatus };
}
