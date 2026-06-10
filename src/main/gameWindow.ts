import { EventEmitter } from 'node:events'
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')

koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })

const GetForegroundWindow = user32.func('void* GetForegroundWindow()')
const GetWindowTextW = user32.func('int GetWindowTextW(void* hWnd, void* lpString, int nMaxCount)')
const GetWindowRect = user32.func('bool GetWindowRect(void* hWnd, _Out_ RECT* lpRect)')
const GetWindowThreadProcessId = user32.func(
  'uint32_t GetWindowThreadProcessId(void* hWnd, void* lpdwProcessId)'
)

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface GameState {
  active: boolean
  /** Physical (device) pixels — convert with screen.screenToDipRect before use in Electron. */
  bounds: Bounds | null
}

/**
 * Polls the foreground window and emits 'state' whenever the game's
 * focus or window rect changes. Never matches windows of our own process
 * (overlay, devtools), so devAnyWindow mode can't latch onto ourselves.
 */
export class GameWindowTracker extends EventEmitter {
  isGameActive = false

  private timer: ReturnType<typeof setInterval> | null = null
  private lastKey = ''

  constructor(
    private readonly windowTitle: string,
    private readonly matchAnyWindow = false
  ) {
    super()
  }

  start(intervalMs = 300): void {
    this.timer = setInterval(() => this.poll(), intervalMs)
    this.poll()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    const state = this.read()
    this.isGameActive = state.active
    const key = JSON.stringify(state)
    if (key !== this.lastKey) {
      this.lastKey = key
      this.emit('state', state)
    }
  }

  private read(): GameState {
    const inactive: GameState = { active: false, bounds: null }

    const hwnd = GetForegroundWindow()
    if (!hwnd) return inactive

    const pidBuf = Buffer.alloc(4)
    GetWindowThreadProcessId(hwnd, pidBuf)
    if (pidBuf.readUInt32LE(0) === process.pid) return inactive

    const titleBuf = Buffer.alloc(1024)
    const len = GetWindowTextW(hwnd, titleBuf, 511)
    if (len <= 0) return inactive
    const title = titleBuf.toString('utf16le', 0, len * 2)

    const matches = this.matchAnyWindow || title === this.windowTitle
    if (!matches) return inactive

    const rect: { left: number; top: number; right: number; bottom: number } = {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    }
    if (!GetWindowRect(hwnd, rect)) return inactive

    const width = rect.right - rect.left
    const height = rect.bottom - rect.top
    if (width <= 0 || height <= 0) return inactive

    return { active: true, bounds: { x: rect.left, y: rect.top, width, height } }
  }
}
