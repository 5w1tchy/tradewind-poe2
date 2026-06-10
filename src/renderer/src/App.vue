<script setup lang="ts">
import { nextTick, ref } from 'vue'

const visible = ref(false)
const text = ref<string | null>(null)
const pos = ref({ x: 0, y: 0 })
const popup = ref<HTMLElement | null>(null)

window.tradewind.onItem(async (payload) => {
  text.value = payload.text
  pos.value = { x: payload.x, y: payload.y }
  visible.value = true

  // Re-clamp once rendered so the popup never spills off the overlay edges.
  await nextTick()
  const el = popup.value
  if (!el) return
  const pad = 12
  pos.value = {
    x: Math.max(pad, Math.min(payload.x, window.innerWidth - el.offsetWidth - pad)),
    y: Math.max(pad, Math.min(payload.y, window.innerHeight - el.offsetHeight - pad))
  }
})

window.tradewind.onHide(() => {
  visible.value = false
})
</script>

<template>
  <div
    v-if="visible"
    ref="popup"
    class="popup"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
  >
    <pre v-if="text">{{ text }}</pre>
    <div v-else class="no-item">No item under cursor</div>
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
  max-width: 480px;
  max-height: 70vh;
  overflow: hidden;
  background: rgba(16, 16, 20, 0.92);
  border: 1px solid rgba(175, 96, 37, 0.55);
  border-radius: 6px;
  padding: 10px 14px;
  color: #d6d3cd;
  font:
    12px/1.45 Consolas,
    monospace;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
}

.popup pre {
  margin: 0;
  white-space: pre-wrap;
}

.no-item {
  color: #8a8782;
  font-style: italic;
}
</style>
