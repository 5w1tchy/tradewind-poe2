import { clipboard } from 'electron'
import { sendEnter, sendPaste, sendSelectAll } from './input'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Type a chat command into the focused game window: open chat, select any
 * draft text (so we replace instead of append), paste the command, send.
 * The clipboard is restored afterwards. One game action per user keypress.
 */
export async function sendChatCommand(command: string): Promise<void> {
  const previous = clipboard.readText()
  clipboard.writeText(command)

  sendEnter()
  await sleep(80)
  sendSelectAll()
  await sleep(40)
  sendPaste()
  await sleep(80)
  sendEnter()
  await sleep(80)

  if (previous) clipboard.writeText(previous)
  else clipboard.clear()
}
