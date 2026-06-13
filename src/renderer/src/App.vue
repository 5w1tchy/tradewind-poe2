<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ItemPayload } from '../../shared/ipc'
import CraftPane from './components/CraftPane.vue'
import PriceCheck from './components/PriceCheck.vue'

const visible = ref(false)
const payload = ref<ItemPayload | null>(null)
const pos = ref({ x: 0, y: 0 })
const popup = ref<HTMLElement | null>(null)

type Tab = 'price' | 'craft'
const tab = ref<Tab>('price')

let cursor = { x: 0, y: 0 }
const pad = 12
// Open beside the cursor, never under it: a popup under the cursor would force
// the overlay interactive immediately and freeze the game tooltip.
const CURSOR_GAP = 20

/** Report the popup's rect so the main process can hit-test the cursor. */
function reportRect(): void {
  const el = popup.value
  if (!visible.value || !el) {
    window.tradewind.setPopupRect(null)
    return
  }
  window.tradewind.setPopupRect({ x: pos.value.x, y: pos.value.y, w: el.offsetWidth, h: el.offsetHeight })
}

/** Initial placement: beside the cursor, flipping sides so it never covers it. */
function place(): void {
  const el = popup.value
  if (!el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x = cursor.x + CURSOR_GAP
  if (x + w + pad > window.innerWidth) x = cursor.x - CURSOR_GAP - w
  let y = cursor.y + CURSOR_GAP
  if (y + h + pad > window.innerHeight) y = cursor.y - CURSOR_GAP - h
  pos.value = {
    x: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
    y: Math.max(pad, Math.min(y, window.innerHeight - h - pad))
  }
  reportRect()
}

// Content growth (listings, switching to Craft) resizes the popup. Only pull it
// back on-screen — never re-flip, or it would jump out from under the cursor
// mid-interaction and trip the auto-hide.
function reclamp(): void {
  const el = popup.value
  if (!el) return
  pos.value = {
    x: Math.max(pad, Math.min(pos.value.x, window.innerWidth - el.offsetWidth - pad)),
    y: Math.max(pad, Math.min(pos.value.y, window.innerHeight - el.offsetHeight - pad))
  }
  reportRect()
}

const resizer = new ResizeObserver(() => reclamp())
watch(popup, (el, prev) => {
  if (prev) resizer.unobserve(prev)
  if (el) resizer.observe(el)
})
onBeforeUnmount(() => resizer.disconnect())

window.tradewind.onItem(async (p) => {
  payload.value = p
  tab.value = 'price'
  cursor = { x: p.x, y: p.y }
  visible.value = true
  await nextTick()
  place()
})

window.tradewind.onHide(() => {
  visible.value = false
  window.tradewind.setPopupRect(null)
})
</script>

<template>
  <div
    v-if="visible && payload"
    ref="popup"
    class="popup"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
  >
    <i class="corner tl" /><i class="corner tr" /><i class="corner bl" /><i class="corner br" />

    <nav class="tabs">
      <span class="mark">◆</span>
      <button class="tab tw-label" :class="{ active: tab === 'price' }" @click="tab = 'price'">
        Price
      </button>
      <button class="tab tw-label" :class="{ active: tab === 'craft' }" @click="tab = 'craft'">
        Craft
      </button>
    </nav>

    <PriceCheck v-show="tab === 'price'" :payload="payload" />

    <CraftPane v-if="tab === 'craft'" :payload="payload" />
  </div>
</template>

<style scoped>
.popup {
  position: fixed;
  max-width: 520px;
  max-height: 80vh;
  overflow: hidden;
  padding: 8px 14px 12px;
  border: 1px solid var(--tw-bronze-dim);
  border-radius: 3px;
  background:
    radial-gradient(140% 60% at 50% 0%, rgba(160, 92, 40, 0.1), transparent 55%),
    linear-gradient(rgba(255, 252, 245, 0.015), rgba(255, 252, 245, 0.015)),
    var(--tw-bg);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.6),
    0 8px 32px rgba(0, 0, 0, 0.65);
  animation: popup-in 130ms ease-out;
}

@keyframes popup-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }
}

/* Filigree corners — short bronze ticks like PoE2 panel framing. */
.corner {
  position: absolute;
  width: 9px;
  height: 9px;
  border: 1px solid var(--tw-bronze);
  pointer-events: none;
}

.corner.tl { top: 2px; left: 2px; border-right: none; border-bottom: none; }
.corner.tr { top: 2px; right: 2px; border-left: none; border-bottom: none; }
.corner.bl { bottom: 2px; left: 2px; border-right: none; border-top: none; }
.corner.br { bottom: 2px; right: 2px; border-left: none; border-top: none; }

.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 7px;
  border-bottom: 1px solid var(--tw-line);
  padding-bottom: 5px;
}

.mark {
  color: var(--tw-bronze);
  font-size: 8px;
  margin-right: 8px;
  padding-left: 2px;
}

.tab {
  background: none;
  border: none;
  padding: 2px 9px 3px;
  cursor: pointer;
  color: var(--tw-text-faint);
  position: relative;
  transition: color 120ms ease;
}

.tab:hover { color: var(--tw-text-mute); }

.tab.active { color: var(--tw-bronze-bright); }

/* Gold underline that marks the live tab, clipped short like an engraving. */
.tab.active::after {
  content: '';
  position: absolute;
  left: 9px;
  right: 9px;
  bottom: -6px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--tw-gold), transparent);
}

</style>
