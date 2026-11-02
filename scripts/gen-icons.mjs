// Generates PWA PNG icons (no dependencies). Run: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public')

function crc32(buf) {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crcBuf])
}

function encodePNG(width, height, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0 // filter none
    for (let x = 0; x < width; x++) {
      const c = px(x, y)
      raw[p++] = c[0]
      raw[p++] = c[1]
      raw[p++] = c[2]
      raw[p++] = c[3]
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function renderIcon(size) {
  const cx = size / 2
  const cy = size / 2
  const rOut = size * 0.34
  const rIn = size * 0.22
  const ring = (x, y) => {
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy)
    return d2 <= rOut * rOut && d2 >= rIn * rIn
  }
  const px = (x, y) => {
    let cov = 0
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        if (ring(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) cov++
      }
    }
    cov /= 9
    const r = Math.round(0xe6 * (1 - cov) + 0xff * cov)
    const g = Math.round(0x00 * (1 - cov) + 0xff * cov)
    const b = Math.round(0x12 * (1 - cov) + 0xff * cov)
    return [r, g, b, 255]
  }
  return encodePNG(size, size, px)
}

writeFileSync(path.join(outDir, 'icon-192.png'), renderIcon(192))
writeFileSync(path.join(outDir, 'icon-512.png'), renderIcon(512))
writeFileSync(path.join(outDir, 'apple-touch-icon.png'), renderIcon(180))
console.log('icons written to', outDir)