import { clipboard } from 'electron'
import { sendCopyAdvanced } from './input'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Trigger the game's advanced item copy and poll the clipboard for the result.
 * Restores whatever was on the clipboard before. Returns null if no item text
 * appeared within the timeout (no item under cursor).
 */
export async function grabItemText(): Promise<string | null> {
  const previous = clipboard.readText()
  clipboard.clear()

  sendCopyAdvanced()

  let item: string | null = null
  const deadline = Date.now() + 600
  while (Date.now() < deadline) {
    await sleep(20)
    const text = clipboard.readText()
    if (text.startsWith('Item Class:')) {
      item = text
      break
    }
  }

  if (previous) clipboard.writeText(previous)
  return item
}
