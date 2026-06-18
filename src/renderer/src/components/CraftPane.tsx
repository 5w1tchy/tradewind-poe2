import { useMemo, useState } from 'react'
import { essencesForItem } from '../../../core/craft/essences'
import type { ItemPayload } from '../../../shared/ipc'
import styles from './CraftPane.module.css'

/** Inner sections of the craft tab; essences first, more to come. */
type Section = 'essences'

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

export default function CraftPane({ payload }: { payload: ItemPayload }): React.JSX.Element {
  const [section, setSection] = useState<Section>('essences')

  const advice = useMemo(() => {
    const p = payload.prepared
    if (!p) return null
    return essencesForItem(p.itemClass, p.rarity, payload.craftedSlots ?? undefined)
  }, [payload])

  return (
    <div className={styles.craft}>
      <nav className={styles.sections}>
        <button
          className={`${styles['section-btn']} ${section === 'essences' ? styles.active : ''}`}
          onClick={() => setSection('essences')}
        >
          Essences
        </button>
      </nav>

      {section === 'essences' &&
        (!advice ? (
          <div className={styles.empty}>stat database still loading</div>
        ) : (
          <>
            {advice.note && <div className={styles.note}>{advice.note}</div>}

            {advice.applicable.length > 0 ? (
              <div className={styles.list}>
                {advice.applicable.map((e) => {
                  const url = iconUrl(e.icon)
                  return (
                    <div key={e.id} className={styles.row}>
                      <span className={styles.art}>
                        {url && <img src={url} alt={e.name} />}
                      </span>
                      <span className={styles.text}>
                        <span className={`${styles.name} ${styles['tier-' + e.tier] ?? ''}`}>
                          {e.name}
                        </span>
                        <span className={styles.mod}>{e.modText}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              !advice.note && (
                <div className={styles.empty}>
                  no essences exist for {payload.prepared?.itemClass ?? 'this item'}
                </div>
              )
            )}
          </>
        ))}
    </div>
  )
}
