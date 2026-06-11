// Native low-level keyboard hook (WH_KEYBOARD_LL) with in-hook suppression.
//
// Why native: the hook callback must decide block/pass synchronously within
// Windows' low-level-hook timeout (~300 ms — miss it and the hook is silently
// dropped), so the hotkey match can never round-trip through the JS event
// loop. JS only receives an async "hotkey N fired" notification afterwards.
//
// Why a low-level hook at all: RegisterHotKey (Electron globalShortcut)
// consumes the WM_KEYDOWN message but the keyboard state still updates, so a
// game polling key state for WASD movement sees the press anyway. Eating the
// event here keeps it out of the message queue and the key-state table both.

#include <napi.h>
#include <windows.h>

#include <atomic>
#include <mutex>
#include <thread>
#include <vector>

namespace {

struct Hotkey {
  int id;
  UINT vk;
  bool ctrl;
  bool alt;
  bool shift;
};

std::mutex hotkeysMutex;
std::vector<Hotkey> hotkeys;

std::atomic<bool> enabled{false};
std::atomic<DWORD> hookThreadId{0};
std::atomic<int> hookStatus{0};  // 0 installing, 1 installed, -1 failed

bool started = false;
Napi::ThreadSafeFunction tsfn;

// Touched only from the hook thread.
bool suppressedKeyUp[256] = {};

bool ModifierDown(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode != HC_ACTION) return CallNextHookEx(nullptr, nCode, wParam, lParam);

  const auto* kb = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
  // Synthetic input passes through untouched — our own Ctrl+Alt+C copy must
  // reach the game, and other macro tools' output isn't ours to filter.
  if ((kb->flags & LLKHF_INJECTED) || kb->vkCode >= 256)
    return CallNextHookEx(nullptr, nCode, wParam, lParam);

  const bool down = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;

  if (!down) {
    // A blocked keydown owes the game a blocked keyup, even if the modifiers
    // were released first or the hook was disabled in between — a stray
    // up-without-down confuses some input handling.
    if (suppressedKeyUp[kb->vkCode]) {
      suppressedKeyUp[kb->vkCode] = false;
      return 1;
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
  }

  if (!enabled.load(std::memory_order_relaxed))
    return CallNextHookEx(nullptr, nCode, wParam, lParam);

  const bool ctrl = ModifierDown(VK_CONTROL);
  const bool alt = ModifierDown(VK_MENU);
  const bool shift = ModifierDown(VK_SHIFT);

  int matched = -1;
  {
    std::lock_guard<std::mutex> lock(hotkeysMutex);
    for (const auto& h : hotkeys) {
      if (h.vk == kb->vkCode && h.ctrl == ctrl && h.alt == alt && h.shift == shift) {
        matched = h.id;
        break;
      }
    }
  }
  if (matched < 0) return CallNextHookEx(nullptr, nCode, wParam, lParam);

  // Autorepeat while held: keep blocking, but fire JS only on the first edge.
  const bool repeat = suppressedKeyUp[kb->vkCode];
  suppressedKeyUp[kb->vkCode] = true;
  if (!repeat) {
    int* id = new int(matched);
    napi_status status =
        tsfn.NonBlockingCall(id, [](Napi::Env env, Napi::Function cb, int* id) {
          cb.Call({Napi::Number::New(env, *id)});
          delete id;
        });
    if (status != napi_ok) delete id;
  }
  return 1;
}

void HookThreadMain() {
  // Hotkey latency must survive the game pegging every core.
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);

  MSG msg;
  // Force the message queue into existence so PostThreadMessage(WM_QUIT) from
  // stop() can reach us.
  PeekMessageW(&msg, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  hookThreadId.store(GetCurrentThreadId());

  HHOOK hook =
      SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandleW(nullptr), 0);
  hookStatus.store(hook ? 1 : -1);

  if (hook) {
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    UnhookWindowsHookEx(hook);
  }

  // The hook thread is the only caller of the tsfn, so it owns the release;
  // stop() never joins (no stall on quit, no terminate() from an unjoined
  // std::thread if the process exits without stop()).
  tsfn.Release();
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (started) {
    Napi::Error::New(env, "keyhook already started").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(callback) expects a function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  hookStatus.store(0);
  hookThreadId.store(0);
  tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(),
                                       "tradewind-keyhook", 0, 1);
  // The hook must not keep the app alive at quit.
  tsfn.Unref(env);

  std::thread(HookThreadMain).detach();

  // SetWindowsHookEx happens on the hook thread; startup-only wait for its
  // verdict so the caller knows whether to fall back to globalShortcut.
  for (int i = 0; i < 2000 && hookStatus.load() == 0; i++) Sleep(1);
  started = hookStatus.load() == 1;
  if (!started) {
    DWORD tid = hookThreadId.exchange(0);
    if (tid) PostThreadMessageW(tid, WM_QUIT, 0, 0);
  }
  return Napi::Boolean::New(env, started);
}

Napi::Value SetHotkeys(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "setHotkeys expects an array").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto arr = info[0].As<Napi::Array>();
  std::vector<Hotkey> next;
  next.reserve(arr.Length());
  for (uint32_t i = 0; i < arr.Length(); i++) {
    Napi::Value v = arr.Get(i);
    if (!v.IsObject()) continue;
    auto o = v.As<Napi::Object>();
    Hotkey h;
    h.id = o.Get("id").ToNumber().Int32Value();
    h.vk = o.Get("vk").ToNumber().Uint32Value();
    h.ctrl = o.Get("ctrl").ToBoolean();
    h.alt = o.Get("alt").ToBoolean();
    h.shift = o.Get("shift").ToBoolean();
    next.push_back(h);
  }
  std::lock_guard<std::mutex> lock(hotkeysMutex);
  hotkeys = std::move(next);
  return env.Undefined();
}

Napi::Value SetEnabled(const Napi::CallbackInfo& info) {
  enabled.store(info.Length() > 0 && info[0].ToBoolean());
  return info.Env().Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  enabled.store(false);
  started = false;
  DWORD tid = hookThreadId.exchange(0);
  if (tid) PostThreadMessageW(tid, WM_QUIT, 0, 0);
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("setHotkeys", Napi::Function::New(env, SetHotkeys));
  exports.Set("setEnabled", Napi::Function::New(env, SetEnabled));
  exports.Set("stop", Napi::Function::New(env, Stop));
  return exports;
}

}  // namespace

NODE_API_MODULE(keyhook, Init)
