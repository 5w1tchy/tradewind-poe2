import { useLayoutEffect, useRef, useState } from 'react'
import type { ItemProperty, ListingItem, ListingMod } from '../../../core/trade/types'
import styles from './ListingTooltip.module.css'

/** Keep the panel this far from the viewport edges. */
const MARGIN = 8

/** Where the tooltip sits relative to the hovered row (overlay-local px). */
export interface TooltipAnchor {
  item: ListingItem
  top: number
  /** Right edge of the panel when placed left; left edge when placed right. */
  edge: number
  placeLeft: boolean
}

/** Join a property's display values: ["+20%"] → "+20%". */
function propText(p: ItemProperty): string {
  const vals = p.values.map((v) => v[0]).filter(Boolean)
  return vals.length > 0 ? `${p.name}: ${vals.join(', ')}` : p.name
}

function ModSection({ mods, cls }: { mods: string[]; cls: string }): React.JSX.Element {
  return (
    <div className={styles.section}>
      {mods.map((m, i) => (
        <div key={i} className={`${styles.mod} ${cls}`}>
          {m}
        </div>
      ))}
    </div>
  )
}

/** One rolled mod with its prefix/suffix tier tag in the left gutter. */
function AffixRow({ mod }: { mod: ListingMod }): React.JSX.Element {
  const tag = mod.affix ? `${mod.affix}${mod.tier ?? ''}` : ''
  return (
    <div className={`${styles.affix} ${styles['src-' + mod.source]}`}>
      {tag && (
        <span className={`${styles.tag} ${mod.affix === 'P' ? styles.prefix : styles.suffix}`}>
          {tag}
        </span>
      )}
      {mod.text}
    </div>
  )
}

/**
 * A read-only PoE-style item tooltip. Fixed-positioned beside the hovered
 * listing; pointer-events are off (see the CSS) so moving toward it simply
 * dismisses it via the row's mouseleave.
 */
export default function ListingTooltip({
  anchor,
  onMouseEnter,
  onMouseLeave
}: {
  anchor: TooltipAnchor
  onMouseEnter: () => void
  onMouseLeave: () => void
}): React.JSX.Element {
  const { item, edge, placeLeft } = anchor
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchor.top)

  // Once the panel's real height is known, lift it up so it never spills past
  // the bottom edge (and never above the top). Runs before paint — no flash.
  // The overlay window is full-size whenever a tooltip is up (it's a
  // viewport-anchored surface), so window.innerHeight is the true viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const maxTop = window.innerHeight - el.offsetHeight - MARGIN
    setTop(Math.max(MARGIN, Math.min(anchor.top, maxTop)))
  }, [anchor])

  const style: React.CSSProperties = {
    top,
    [placeLeft ? 'right' : 'left']: edge,
    // Taller-than-viewport items still scroll rather than overflow.
    maxHeight: `calc(100vh - ${2 * MARGIN}px)`
  }

  const props = item.properties ?? []
  const reqs = item.requirements ?? []

  return (
    <div
      ref={ref}
      className={styles.tooltip}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-surface
      data-viewport-anchored
    >
      <div className={styles.head}>
        {item.name && <div className={`${styles.name} ${styles['rarity-' + item.rarity]}`}>{item.name}</div>}
        <div className={`${styles.base} ${styles['rarity-' + item.rarity]}`}>{item.baseType}</div>
      </div>

      {props.length > 0 && (
        <div className={styles.section}>
          {props.map((p, i) => (
            <div key={i} className={styles.prop}>
              {propText(p)}
            </div>
          ))}
        </div>
      )}

      {reqs.length > 0 && (
        <div className={styles.section}>
          <div className={styles.prop}>Requires {reqs.map(propText).join(', ')}</div>
        </div>
      )}

      {item.enchantMods && <ModSection mods={item.enchantMods} cls={styles.enchant} />}
      {item.implicitMods && <ModSection mods={item.implicitMods} cls={styles.implicit} />}
      {item.runeMods && <ModSection mods={item.runeMods} cls={styles.rune} />}

      {item.affixMods && (
        <div className={styles.section}>
          {item.affixMods.map((m, i) => (
            <AffixRow key={i} mod={m} />
          ))}
        </div>
      )}

      {(item.ilvl !== undefined || item.corrupted) && (
        <div className={styles.section}>
          {item.ilvl !== undefined && <div className={styles.meta}>Item Level: {item.ilvl}</div>}
          {item.corrupted && <div className={styles.corrupted}>Corrupted</div>}
        </div>
      )}
    </div>
  )
}
