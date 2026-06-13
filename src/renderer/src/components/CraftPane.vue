<script setup lang="ts">
import { computed, ref } from 'vue'
import { essencesForItem } from '../../../core/craft/essences'
import type { ItemPayload } from '../../../shared/ipc'

const props = defineProps<{ payload: ItemPayload }>()

/** Inner sections of the craft tab; essences first, more to come. */
type Section = 'essences'
const section = ref<Section>('essences')

// Essence art is bundled at build time (scripts/gen-essences.mjs downloads
// it); resolve id -> asset URL through Vite's glob so CSP stays 'self'.
const ICONS = import.meta.glob('../assets/essences/*.webp', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>

function iconUrl(file: string | null): string | null {
  return file ? (ICONS[`../assets/essences/${file}`] ?? null) : null
}

const advice = computed(() => {
  const p = props.payload.prepared
  if (!p) return null
  return essencesForItem(p.itemClass, p.rarity)
})
</script>

<template>
  <div class="craft">
    <nav class="sections">
      <button
        class="section-btn"
        :class="{ active: section === 'essences' }"
        @click="section = 'essences'"
      >
        Essences
      </button>
    </nav>

    <template v-if="section === 'essences'">
      <div v-if="!advice" class="empty">stat database still loading</div>

      <template v-else>
        <div v-if="advice.note" class="note">{{ advice.note }}</div>

        <div v-if="advice.applicable.length > 0" class="list">
          <div v-for="e in advice.applicable" :key="e.id" class="row">
            <span class="art">
              <img v-if="iconUrl(e.icon)" :src="iconUrl(e.icon)!" :alt="e.name" />
            </span>
            <span class="text">
              <span class="name" :class="'tier-' + e.tier">{{ e.name }}</span>
              <span class="mod">{{ e.modText }}</span>
            </span>
          </div>
        </div>

        <div v-else-if="!advice.note" class="empty">
          no essences exist for {{ payload.prepared?.itemClass ?? 'this item' }}
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.craft {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 340px;
}

.sections {
  display: flex;
  gap: 6px;
}

/* Engraved chip rail — visually subordinate to the main Price/Craft tabs. */
.section-btn {
  background: var(--tw-bg-inset);
  border: 1px solid var(--tw-line);
  border-radius: 2px;
  color: var(--tw-text-mute);
  font-family: var(--tw-font-body);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 10px;
  cursor: pointer;
  transition:
    color 120ms ease,
    border-color 120ms ease;
}

.section-btn:hover { color: var(--tw-text); }

.section-btn.active {
  color: var(--tw-bronze-bright);
  border-color: var(--tw-bronze-dim);
  background: var(--tw-bronze-faint);
}

.note {
  color: var(--tw-text-mute);
  font-style: italic;
  font-size: 12px;
  border-bottom: 1px solid var(--tw-line);
  padding-bottom: 6px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 340px;
  overflow-y: auto;
  padding-right: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 2px 4px;
  border-radius: 2px;
}

.row:hover { background: var(--tw-bg-raised); }

.art {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.art img {
  max-width: 28px;
  max-height: 28px;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.8));
}

.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.name {
  font-size: 12px;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tier-greater { color: var(--tw-bronze-bright); }
.tier-perfect { color: var(--tw-gold); }
.tier-corrupted { color: var(--tw-bad); }

.mod {
  color: var(--tw-text);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  color: var(--tw-text-faint);
  font-style: italic;
  padding: 10px 0 6px;
}
</style>
