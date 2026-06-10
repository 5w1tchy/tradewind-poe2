import { clipboard } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Type a chat command into the focused game window: open chat, select any
 * draft text (so we replace instead of append), paste the command, send.
 * The taps go out as one synchronous burst — the game processes them in
 * order within a frame or two, so the chat never visibly opens.
 * The clipboard is restored afterwards. One game action per user keypress.
 */
export async function sendChatCommand(command: string): Promise<void> {
  const previous = clipboard.readText()
  clipboard.writeText(command)

  uIOhook.keyTap(UiohookKey.Enter)
  uIOhook.keyTap(UiohookKey.A, [UiohookKey.Ctrl])
  uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl])
  uIOhook.keyTap(UiohookKey.Enter)

  // Give the game time to consume the paste before the clipboard reverts;
  // the caller stays busy-locked until then so a price check can't race it.
  await sleep(120)
  if (previous) clipboard.writeText(previous)
  else clipboard.clear()
}
