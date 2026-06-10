<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ItemPayload } from '../../shared/ipc'
import PriceCheck from './components/PriceCheck.vue'

const visible = ref(false)
const payload = ref<ItemPayload | null>(null)
const pos = ref({ x: 0, y: 0 })
const popup = ref<HTMLElement | null>(null)

let anchor = { x: 0, y: 0 }

/** Keep the popup on-screen at its current size, anchored near the cursor. */
function clamp(): void {
  const el = popup.value
  if (!el) return
  const pad = 12
  pos.value = {
    x: Math.max(pad, Math.min(anchor.x, window.innerWidth - el.offsetWidth - pad)),
    y: Math.max(pad, Math.min(anchor.y, window.innerHeight - el.offsetHeight - pad))
  }
}

// Listings arriving make the popup grow after open — re-clamp on every resize.
const resizer = new ResizeObserver(() => clamp())
watch(popup, (el, prev) => {
  if (prev) resizer.unobserve(prev)
  if (el) resizer.observe(el)
})
onBeforeUnmount(() => resizer.disconnect())

window.tradewind.onItem(async (p) => {
  payload.value = p
  anchor = { x: p.x, y: p.y }
  pos.value = anchor
  visible.value = true
  await nextTick()
  clamp()
})

window.tradewind.onHide(() => {
  visible.value = false
  window.tradewind.setInteractive(false)
})

function onEnter(): void {
  window.tradewind.setInteractive(true)
}

function onLeave(): void {
  window.tradewind.setInteractive(false)
}
</script>

<template>
  <div
    v-if="visible && payload"
    ref="popup"
    class="popup"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <PriceCheck :payload="payload" />
  </div>
</template>

<style>
html,
body {
  margin: 0;
  background: transparent;
  overflow: hidden;
  user-select: none;
}

.popup {
  position: fixed;
  max-width: 520px;
  max-height: 80vh;
  overflow: hidden;
  background: rgba(16, 16, 20, 0.94);
  border: 1px solid rgba(175, 96, 37, 0.55);
  border-radius: 6px;
  padding: 10px 14px;
  color: #d6d3cd;
  font:
    12px/1.45 Consolas,
    monospace;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
}
</style>
