import { app, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { Config } from "./config";
import type { UpdateStatus } from "../shared/ipc";
import { showThemedDialog, type DialogController } from "./themed-dialog";

// How often to re-check after the startup check. Releases are infrequent; a
// few hours keeps us current without hammering the GitHub feed.
const POLL_INTERVAL_MS = 15 * 60 * 1000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

// Downloads are gated on the user's network: a background download can spike
// ping mid-game, so we never auto-download except at startup (when the user
// isn't yet in a match). autoDownload stays OFF; we call downloadUpdate()
// explicitly. Who triggered the in-flight check decides what an "available"
// update does:
//   startup → download immediately, then install+relaunch (silent).
//   poll    → push an "available" status; the renderer toast offers an Update
//             button, and only that click starts the download.
//   manual  → drive the themed dialog opened by checkForUpdatesManually:
//             Checking… → Available (+ Update button) → Downloading… → relaunch.
// Once a download finishes (always either startup or an explicit user click =
// consent to restart), we quitAndInstall immediately — no second prompt.
type CheckSource = "startup" | "poll" | "manual";
let source: CheckSource = "startup";

// The live manual-check dialog, if one is open. Its presence routes update
// events to the dialog instead of the toast.
let manualDialog: DialogController | null = null;

/**
 * Wire electron-updater against the GitHub releases feed. Discovery (startup +
 * poll) is automatic and cheap; the binary download is not — it only runs at
 * startup or after an explicit user click (toast/dialog). Startup is never
 * blocked, and every failure path (offline, no release yet, rate limit) is
 * swallowed — the overlay must keep working regardless.
 */
export function initAutoUpdater(overlay: BrowserWindow, config: Config): void {
  // Only an installed build can replace itself; in dev there is no feed and
  // checkForUpdates would throw. `npm run dev` stays untouched.
  if (!app.isPackaged) return;

  // Channel selection, the GitHub way: leave autoUpdater.channel at its default
  // and toggle allowPrerelease. Stable users see only full releases; demo users
  // also see pre-releases (see electron-updater GitHubProvider.getLatestVersion).
  autoUpdater.allowPrerelease = config.updateChannel === "demo";
  autoUpdater.autoDownload = false; // never download without startup/consent
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (status: UpdateStatus): void => {
    if (!overlay.isDestroyed())
      overlay.webContents.send("tw:update-status", status);
  };

  autoUpdater.on("update-available", (info) => {
    if (source === "startup") {
      // Pre-match: fetch it now; update-downloaded relaunches into it.
      downloadUpdate();
    } else if (manualDialog) {
      manualDialog.setContent(availableContent(info.version));
    } else {
      // Poll: let the toast offer the download.
      send({ state: "available", version: info.version });
    }
  });

  autoUpdater.on("update-not-available", () => {
    if (manualDialog) manualDialog.setContent(upToDateContent());
  });

  autoUpdater.on("download-progress", (p) => {
    const percent = Math.round(p.percent);
    if (manualDialog) manualDialog.setContent(downloadingContent(percent));
    else send({ state: "downloading", percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    // Every download was consented (startup or an explicit click), so install
    // and relaunch straight away — the click was the permission to restart.
    if (manualDialog) manualDialog.setContent(installingContent());
    else send({ state: "downloaded", version: info.version });
    console.log(`[updater] installing ${info.version}`);
    quitAndInstall();
  });

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater]", message);
    if (manualDialog) manualDialog.setContent(errorContent(message));
  });

  const check = (src: CheckSource): void => {
    source = src;
    autoUpdater.checkForUpdates().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[updater] check failed:", message);
      if (manualDialog) manualDialog.setContent(errorContent(message));
    });
  };

  check("startup");
  pollTimer = setInterval(() => check("poll"), POLL_INTERVAL_MS);
}

// ---- Themed-dialog content for the manual flow -------------------------------

const checkingContent = (): Parameters<typeof showThemedDialog>[0] => ({
  message: "Checking for updates…",
  buttons: [],
});

const upToDateContent = (): Parameters<typeof showThemedDialog>[0] => ({
  message: "You’re up to date",
  detail: `Tradewind ${app.getVersion()} is the latest version.`,
  buttons: [{ label: "Close", primary: true, cancel: true }],
});

const availableContent = (
  version: string,
): Parameters<typeof showThemedDialog>[0] => ({
  message: `Update ${version} available`,
  detail: "Tradewind will download it and restart — this only takes a moment.",
  buttons: [
    {
      label: "Update now",
      primary: true,
      keepOpen: true,
      onClick: () => {
        downloadUpdate();
        manualDialog?.setContent(downloadingContent(0));
      },
    },
    { label: "Later", cancel: true },
  ],
});

const downloadingContent = (
  percent: number,
): Parameters<typeof showThemedDialog>[0] => ({
  message: "Downloading update…",
  detail: `${percent}%`,
  buttons: [],
});

const installingContent = (): Parameters<typeof showThemedDialog>[0] => ({
  message: "Installing — restarting Tradewind…",
  buttons: [],
});

const errorContent = (
  message: string,
): Parameters<typeof showThemedDialog>[0] => ({
  title: "Update check failed",
  message: "Couldn’t check for updates.",
  detail: message,
  buttons: [{ label: "Close", primary: true, cancel: true }],
});

/**
 * Tray-initiated "Check for updates". Opens the themed dialog immediately in a
 * "Checking…" state, then morphs it in place to the result (up to date, or an
 * Update button that downloads + relaunches). In dev there is no feed, so it
 * just says so.
 */
export function checkForUpdatesManually(): void {
  if (!app.isPackaged) {
    showThemedDialog({
      message: "Updates are only available in the installed app",
      detail: "Run a packaged build to use auto-update.",
    });
    return;
  }
  manualDialog = showThemedDialog({
    ...checkingContent(),
    onClosed: () => {
      manualDialog = null;
    },
  });
  source = "manual";
  autoUpdater.checkForUpdates().catch((err) => {
    manualDialog?.setContent(
      errorContent(err instanceof Error ? err.message : String(err)),
    );
  });
}

/**
 * Start downloading the pending update. Called at startup, by the renderer toast
 * (tw:download-update), and by the manual dialog's Update button. The completion
 * (update-downloaded) installs and relaunches.
 */
export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] download failed:", message);
    if (manualDialog) manualDialog.setContent(errorContent(message));
  });
}

export function stopAutoUpdater(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Quit and install a downloaded update immediately, then relaunch. isSilent=true
 * runs the oneClick installer with no UI; isForceRunAfter=true brings the app
 * back up on the new version.
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(true, true);
}
