import { useMemo, useState } from 'react'
import { essencesForItem } from '../../../core/craft/essences'
import { liquidsForItem } from '../../../core/craft/liquids'
import type { ItemPayload } from '../../../shared/ipc'
import styles from './CraftPane.module.css'

/** Inner sections of the craft tab; essences first, more to come. */
type Section = 'essences' | 'liquids'

// Craft art is bundled at build time (scripts/gen-essences.mjs / gen-liquids.mjs
// download it); resolve id -> asset URL through Vite's glob so CSP stays 'self'.
const ESSENCE_ICONS = import.meta.glob('../assets/essences/*.webp', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>
const LIQUID_ICONS = import.meta.glob('../assets/liquids/*.webp', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>

function essenceIcon(file: string | null): string | null {
  return file ? (ESSENCE_ICONS[`../assets/essences/${file}`] ?? null) : null
}
function liquidIcon(file: string | null): string | null {
  return file ? (LIQUID_ICONS[`../assets/liquids/${file}`] ?? null) : null
}

export default function CraftPane({ payload }: { payload: ItemPayload }): React.JSX.Element {
  const [section, setSection] = useState<Section>('essences')

  const essences = useMemo(() => {
    const p = payload.prepared
    if (!p) return null
    return essencesForItem(
      p.itemClass,
      p.rarity,
      payload.craftedSlots ?? undefined,
      payload.itemMods ?? undefined
    )
  }, [payload])

  const liquids = useMemo(() => {
    const p = payload.prepared
    if (!p) return null
    // Liquids key off the jewel's gem base type (every jewel is `Item Class:
    // Jewels`); rares carry it on baseTypeFilter, uniques on type.
    const baseType = p.baseTypeFilter?.value ?? p.type ?? ''
    return liquidsForItem(p.itemClass, baseType, p.rarity, payload.craftedSlots ?? undefined)
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
        <button
          className={`${styles['section-btn']} ${section === 'liquids' ? styles.active : ''}`}
          onClick={() => setSection('liquids')}
        >
          Liquids
        </button>
      </nav>

      {section === 'essences' &&
        (!essences ? (
          <div className={styles.empty}>stat database still loading</div>
        ) : (
          <>
            {essences.note && <div className={styles.note}>{essences.note}</div>}

            {essences.applicable.length > 0 ? (
              <div className={styles.list}>
                {essences.applicable.map((e) => {
                  const url = essenceIcon(e.icon)
                  return (
                    <div
                      key={e.id}
                      className={`${styles.row} ${e.blockedBy ? styles.blocked : ''}`}
                    >
                      <span className={styles.art}>
                        {url && <img src={url} alt={e.name} />}
                      </span>
                      <span className={styles.text}>
                        <span className={`${styles.name} ${styles['tier-' + e.tier] ?? ''}`}>
                          {e.name}
                        </span>
                        <span className={styles.mod}>{e.modText}</span>
                      </span>
                      {e.blockedBy && (
                        <span
                          className={styles.blockedBy}
                          title={`Blocked: the item already has "${e.blockedBy}", which shares this mod's group`}
                        >
                          blocked by “{e.blockedBy}”
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              !essences.note && (
                <div className={styles.empty}>
                  no essences exist for {payload.prepared?.itemClass ?? 'this item'}
                </div>
              )
            )}
          </>
        ))}

      {section === 'liquids' &&
        (!liquids ? (
          <div className={styles.empty}>stat database still loading</div>
        ) : (
          <>
            {liquids.note && <div className={styles.note}>{liquids.note}</div>}

            {liquids.applicable.length > 0 ? (
              <div className={styles.list}>
                {liquids.applicable.map((l) => {
                  const url = liquidIcon(l.icon)
                  return (
                    <div key={l.id} className={styles.row}>
                      <span className={styles.art}>{url && <img src={url} alt={l.name} />}</span>
                      <span className={styles.text}>
                        <span className={`${styles.name} ${l.potent ? styles.potent : styles.liquid}`}>
                          {l.name}
                          {l.mods.length > 1 && <span className={styles.oneof}>rolls one of</span>}
                        </span>
                        {l.mods.map((m, i) => (
                          <span key={i} className={styles.mod} title={m.text}>
                            <span className={styles.affix}>{m.affix === 'prefix' ? 'P' : 'S'}</span>
                            {m.text}
                          </span>
                        ))}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              !liquids.note && (
                <div className={styles.empty}>liquids only apply to jewels</div>
              )
            )}
          </>
        ))}
    </div>
  )
}
