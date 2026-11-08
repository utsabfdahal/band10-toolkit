import type { DigitSet, WatchFaceLayout, WatchFaceManifest } from '../../core/types.ts'
import { gmfDefinitionFor, packGmfDefinition } from '../../builder/nativeCore.ts'
import type { RgbaImage } from '../../parser/imageEncode.ts'

const SCREEN = { width: 212, height: 520 }

async function loadRgba(url: string): Promise<RgbaImage> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Cannot load ${url} (${response.status})`)
  const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  context.drawImage(bitmap, 0, 0)
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
  return { rgba: new Uint8Array(data.buffer), width: bitmap.width, height: bitmap.height }
}

/** Packs the current layout into an installable .face entirely in the browser. */
export async function exportFace(manifest: WatchFaceManifest, layout: WatchFaceLayout): Promise<Blob> {
  const cache = new Map<string, Promise<RgbaImage>>()
  const load = (name: string) => {
    const url = name === 'preview' ? manifest.preview : name
    let cached = cache.get(url)
    if (!cached) {
      cached = loadRgba(url)
      cache.set(url, cached)
    }
    return cached
  }
  const definition = gmfDefinitionFor(manifest, layout, (reference) => reference, (reference) => reference)
  const binary = await packGmfDefinition(definition, { normal: load, aod: load }, manifest.compiler.imageCompression)
  return new Blob([new Uint8Array(binary)], { type: 'application/octet-stream' })
}

async function canvasUrl(canvas: OffscreenCanvas): Promise<string> {
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

// A fixed 6×7×6 palette with ordered dithering keeps photos under 256 colours so they pack as 1 byte per pixel.
function quantize(data: Uint8ClampedArray, width: number): void {
  const levels = [6, 7, 6]
  for (let pixel = 0; pixel < data.length / 4; pixel += 1) {
    const threshold = (BAYER[(pixel % width % 4) + ((Math.floor(pixel / width) % 4) * 4)]! + 0.5) / 16 - 0.5
    for (let channel = 0; channel < 3; channel += 1) {
      const steps = levels[channel]! - 1
      const value = data[pixel * 4 + channel]! / 255
      data[pixel * 4 + channel] = Math.round(Math.min(steps, Math.max(0, Math.round(value * steps + threshold))) * (255 / steps))
    }
    data[pixel * 4 + 3] = 255
  }
}

/** Cover-crops a photo to 212×520, darkens it for text legibility, and quantizes to ≤256 colours. */
export async function makeWallpaper(file: File, dim: number): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.max(SCREEN.width / bitmap.width, SCREEN.height / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  const canvas = new OffscreenCanvas(SCREEN.width, SCREEN.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  context.drawImage(bitmap, (SCREEN.width - width) / 2, (SCREEN.height - height) / 2, width, height)
  context.fillStyle = `rgba(0,0,0,${Math.min(1, Math.max(0, dim))})`
  context.fillRect(0, 0, SCREEN.width, SCREEN.height)
  const image = context.getImageData(0, 0, SCREEN.width, SCREEN.height)
  quantize(image.data, SCREEN.width)
  context.putImageData(image, 0, 0)
  return canvasUrl(canvas)
}

export interface FontDigitOptions {
  font: File
  size: number
  weight: number
  color: string
}

/** Renders 0–9 and minus from any uploaded font into equally sized digit sprites. */
export async function makeDigitSet(options: FontDigitOptions): Promise<{ set: DigitSet, width: number, height: number }> {
  const family = `upload-${Date.now().toString(36)}`
  const face = new FontFace(family, await options.font.arrayBuffer(), { weight: String(options.weight) })
  await face.load()
  document.fonts.add(face)
  const probe = new OffscreenCanvas(8, 8).getContext('2d')
  if (!probe) throw new Error('Canvas 2D is unavailable')
  probe.font = `${options.weight} ${options.size}px "${family}"`
  const glyphs = [...'0123456789', '−']
  const metrics = glyphs.map((glyph) => probe.measureText(glyph))
  const width = Math.ceil(Math.max(...metrics.map((metric) => metric.width))) + 2
  const ascent = Math.ceil(Math.max(...metrics.map((metric) => metric.actualBoundingBoxAscent)))
  const descent = Math.ceil(Math.max(0, ...metrics.map((metric) => metric.actualBoundingBoxDescent)))
  const height = ascent + descent + 4
  const urls = await Promise.all(glyphs.map(async (glyph) => {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    context.font = probe.font
    context.fillStyle = options.color
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    context.fillText(glyph, width / 2, ascent + 2)
    return canvasUrl(canvas)
  }))
  return { set: { digits: urls.slice(0, 10) as DigitSet['digits'], minus: urls[10]! }, width, height }
}
