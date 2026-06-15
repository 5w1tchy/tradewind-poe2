import { app, dialog, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { Config } from "./config";
import type { UpdateStatus } from "../shared/ipc";

// How often to re-check after the startup check. Releases are infrequent; a
// few hours keeps us current without hammering the GitHub feed.
const POLL_INTERVAL_MS = 15 * 60 * 1000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
// True while a tray-initiated check is in flight: the silent startup/poll
// checks stay quiet, but a manual one reports its outcome with a dialog.
let manualCheck = false;

/**
 * Wire electron-updater against the GitHub releases feed. An update found by the
 * startup check is downloaded and then installed-and-relaunched automatically
 * (silently — see quitAndInstall). Updates found later by the background poll
 * are NOT auto-installed (that would yank the user out of a live game); they
 * fall back to autoInstallOnAppQuit plus the renderer's "Restart now" toast.
 * Startup is never blocked, and every failure path (offline, no release yet,
 * rate limit) is swallowed — the overlay must keep working regardless.
 */
export function initAutoUpdater(overlay: BrowserWindow, config: Config): void {
  // Only an installed build can replace itself; in dev there is no feed and
  // checkForUpdates would throw. `npm run dev` stays untouched.
  if (!app.isPackaged) return;

  // Armed for the startup check only: the first check's outcome consumes it, so
  // a later poll that finds an update can't auto-quit a running game.
  let autoInstallOnStartup = true;

  // Channel selection, the GitHub way: leave autoUpdater.channel at its default
  // and toggle allowPrerelease. Stable users see only full releases (GitHub's
  // "latest release" endpoint skips pre-releases). Demo users also see
  // pre-releases and always land on the newest of *either* channel — the
  // provider reads beta.yml for a vX.Y.Z-beta.N tag and latest.yml for a plain
  // tag (see electron-updater GitHubProvider.getLatestVersion).
  autoUpdater.allowPrerelease = config.updateChannel === "demo";
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (status: UpdateStatus): void => {
    if (!overlay.isDestroyed())
      overlay.webContents.send("tw:update-status", status);
  };

  autoUpdater.on("checking-for-update", () => send({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    send({ state: "available", version: info.version });
    if (manualCheck) {
      void dialog.showMessageBox({
        type: "info",
        title: "Tradewind",
        message: `Update ${info.version} available`,
        detail:
          "Downloading in the background — you’ll be prompted to restart when it’s ready.",
      });
    }
  });
  autoUpdater.on("update-not-available", () => {
    send({ state: "not-available" });
    autoInstallOnStartup = false;
    if (manualCheck) {
      manualCheck = false;
      void dialog.showMessageBox({
        type: "info",
        title: "Tradewind",
        message: "You’re up to date",
        detail: `Tradewind ${app.getVersion()} is the latest version.`,
      });
    }
  });
  autoUpdater.on("download-progress", (p) =>
    send({ state: "downloading", percent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => {
    send({ state: "downloaded", version: info.version });
    const fromStartup = autoInstallOnStartup;
    autoInstallOnStartup = false;
    if (manualCheck) {
      manualCheck = false;
      void dialog
        .showMessageBox({
          type: "info",
          title: "Tradewind",
          message: `Update ${info.version} ready`,
          detail: "Restart Tradewind to finish installing.",
          buttons: ["Restart now", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) quitAndInstall();
        });
      return;
    }
    // Startup update: install silently and relaunch into the new version. A
    // poll-time download (fromStartup === false) just waits for the next quit.
    if (fromStartup) {
      console.log(`[updater] installing ${info.version} on startup`);
      quitAndInstall();
    }
  });
  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater]", message);
    send({ state: "error", message });
    autoInstallOnStartup = false;
    if (manualCheck) {
      manualCheck = false;
      dialog.showErrorBox("Update check failed", message);
    }
  });

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error(
        "[updater] check failed:",
        err instanceof Error ? err.message : err,
      );
    });
  };

  check();
  pollTimer = setInterval(check, POLL_INTERVAL_MS);
}

/**
 * Tray-initiated "Check for updates". Unlike the silent startup/poll checks,
 * this always reports back: "up to date", "downloading", a restart prompt when
 * ready, or an error — via the dialogs wired in initAutoUpdater. In dev there
 * is no feed, so it just says so.
 */
export function checkForUpdatesManually(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: "info",
      title: "Tradewind",
      message: "Updates are only available in the installed app",
      detail: "Run a packaged build to use auto-update.",
    });
    return;
  }
  manualCheck = true;
  autoUpdater.checkForUpdates().catch((err) => {
    manualCheck = false;
    dialog.showErrorBox(
      "Update check failed",
      err instanceof Error ? err.message : String(err),
    );
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
