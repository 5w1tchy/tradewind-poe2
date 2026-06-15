// Regenerates the base64 PNG embedded in src/main/tray.ts from build/icon.png.
// Run `node scripts/gen-tray.mjs` and paste the output into ICON_PNG.
//
// build/icon.png (the app icon electron-builder ships) isn't bundled into the
// asar, so the tray can't read it at runtime — we downscale it to 32x32 here
// and inline the base64 instead, so dev and the packaged app load identical
// bytes. Dependency-free: hand-rolled PNG decode → area-average resize → encode
// (build/icon.png is 8-bit RGBA, non-interlaced — the only case we handle).
import zlib from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZE = 32
const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')

function crc32(buf) {
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Decode an 8-bit RGBA, non-interlaced PNG to { w, h, data: Uint8Array }. */
function decode(buf) {
  if (buf.readBigUInt64BE(0) !== 0x89504e470d0a1a0an) throw new Error('not a PNG')
  let w = 0
  let h = 0
  const idat = []
  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error('expected 8-bit RGBA, non-interlaced')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = 4
  const stride = w * ch
  const out = new Uint8Array(w * h * ch)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const rowIn = y * (stride + 1) + 1
    const rowOut = y * stride
    for (let i = 0; i < stride; i++) {
      const x = raw[rowIn + i]
      const a = i >= ch ? out[rowOut + i - ch] : 0
      const b = y > 0 ? out[rowOut - stride + i] : 0
      const c = i >= ch && y > 0 ? out[rowOut - stride + i - ch] : 0
      let v
      if (filter === 0) v = x
      else if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + ((a + b) >> 1)
      else if (filter === 4) v = x + paeth(a, b, c)
      else throw new Error(`bad filter ${filter}`)
      out[rowOut + i] = v & 0xff
    }
  }
  return { w, h, data: out }
}

/** Area-average downscale to size x size, premultiplying alpha so transparent
 *  edges don't bleed dark fringes into the shrunk icon. */
function resize(img, size) {
  const { w, h, data } = img
  const out = new Uint8Array(size * size * 4)
  for (let oy = 0; oy < size; oy++) {
    const sy0 = Math.floor((oy * h) / size)
    const sy1 = Math.max(sy0 + 1, Math.floor(((oy + 1) * h) / size))
    for (let ox = 0; ox < size; ox++) {
      const sx0 = Math.floor((ox * w) / size)
      const sx1 = Math.max(sx0 + 1, Math.floor(((ox + 1) * w) / size))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * w + sx) * 4
          const al = data[i + 3] / 255
          r += data[i] * al
          g += data[i + 1] * al
          b += data[i + 2] * al
          a += data[i + 3]
          n++
        }
      }
      const o = (oy * size + ox) * 4
      const av = a / n
      const cov = av / 255 || 1
      out[o] = Math.round(r / n / cov)
      out[o + 1] = Math.round(g / n / cov)
      out[o + 2] = Math.round(b / n / cov)
      out[o + 3] = Math.round(av)
    }
  }
  return out
}

function encode(rgba, size) {
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const png = encode(resize(decode(readFileSync(src)), SIZE), SIZE)
process.stdout.write(png.toString('base64') + '\n')
