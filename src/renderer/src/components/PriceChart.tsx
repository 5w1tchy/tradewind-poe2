import { useLayoutEffect, useRef, useState } from 'react'
import type { CurrencyPoint } from '../../../core/exchange'
import styles from './PriceChart.module.css'

/**
 * Lightweight, dependency-free dual-series chart: an aggregate-price line over a
 * faint volume histogram, sharing one time axis. Hand-rolled SVG rather than a
 * charting lib — the overlay is a tiny static UI rendered in software (see
 * main/index.ts), so a few <path>/<rect> elements keep it crisp and weightless.
 * Sized to its container via ResizeObserver so it tracks the resizable popup.
 */
export default function PriceChart({
  points,
  formatValue
}: {
  points: CurrencyPoint[]
  /** Render an exalted value as an axis label, in the caller's denomination. */
  formatValue: (exalted: number) => string
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={box} className={styles.chart}>
      {size.w > 0 && size.h > 0 && <Plot points={points} size={size} formatValue={formatValue} />}
    </div>
  )
}

const PAD = { l: 44, r: 8, t: 10, b: 18 }
// Volume bars occupy a band along the bottom; the price line uses the full height.
const VOL_BAND = 0.3

function Plot({
  points,
  size,
  formatValue
}: {
  points: CurrencyPoint[]
  size: { w: number; h: number }
  formatValue: (exalted: number) => string
}): React.JSX.Element {
  const { w, h } = size
  const innerW = Math.max(1, w - PAD.l - PAD.r)
  const innerH = Math.max(1, h - PAD.t - PAD.b)
  const baseY = PAD.t + innerH

  if (points.length === 0) {
    return (
      <svg className={styles.svg} width={w} height={h}>
        <text x={w / 2} y={h / 2} className={styles.empty} textAnchor="middle">
          no history yet
        </text>
      </svg>
    )
  }

  const prices = points.map((p) => p.priceExalted)
  let pMin = Math.min(...prices)
  let pMax = Math.max(...prices)
  if (pMin === pMax) {
    // Flat series: open a little window around it so the line sits mid-frame.
    pMin *= 0.95
    pMax *= 1.05
  }
  const vMax = Math.max(...points.map((p) => p.quantity), 1)

  const n = points.length
  const x = (i: number): number => PAD.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (price: number): number => PAD.t + (1 - (price - pMin) / (pMax - pMin)) * innerH
  const barH = (q: number): number => (q / vMax) * innerH * VOL_BAND
  const barW = Math.max(1, (innerW / n) * 0.6)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.priceExalted).toFixed(1)}`).join(' ')
  // Close the area down to the baseline for a faint fill under the line.
  const area = `${line} L${x(n - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`

  const last = points[n - 1]
  const dateLabel = (iso: string): string => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <svg className={styles.svg} width={w} height={h}>
      {/* price gridlines + axis labels (max / min) */}
      {[pMax, (pMax + pMin) / 2, pMin].map((p, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={y(p)} x2={w - PAD.r} y2={y(p)} className={styles.grid} />
          <text x={PAD.l - 5} y={y(p) + 3} className={styles.axis} textAnchor="end">
            {formatValue(p)}
          </text>
        </g>
      ))}

      {/* volume histogram (behind the line) */}
      {points.map((p, i) => (
        <rect
          key={i}
          className={styles.bar}
          x={x(i) - barW / 2}
          y={baseY - barH(p.quantity)}
          width={barW}
          height={barH(p.quantity)}
        />
      ))}

      {/* price area + line */}
      <path className={styles.area} d={area} />
      <path className={styles.line} d={line} vectorEffect="non-scaling-stroke" />
      <circle className={styles.dot} cx={x(n - 1)} cy={y(last.priceExalted)} r={2.5} />

      {/* first / last date ticks */}
      <text x={PAD.l} y={h - 5} className={styles.axis} textAnchor="start">
        {dateLabel(points[0].time)}
      </text>
      <text x={w - PAD.r} y={h - 5} className={styles.axis} textAnchor="end">
        {dateLabel(last.time)}
      </text>
    </svg>
  )
}
