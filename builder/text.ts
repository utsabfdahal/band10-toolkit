import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as hb from 'harfbuzzjs'

export type FontFamily = 'inter' | 'devanagari'

export interface TextOptions {
  size: number
  fill: string
  weight?: number
  family?: FontFamily
  anchor?: 'start' | 'middle' | 'end'
  tabularNumbers?: boolean
}

const FONT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts')
const FONT_FILES: Record<FontFamily, string> = {
  inter: 'Inter.ttf',
  devanagari: 'NotoSansDevanagari.ttf',
}
const DEVANAGARI = /[\u0900-\u097f]/

const faces = new Map<FontFamily, hb.Face>()
const fonts = new Map<string, hb.Font>()

function face(family: FontFamily): hb.Face {
  let cached = faces.get(family)
  if (!cached) {
    const data = readFileSync(path.join(FONT_DIRECTORY, FONT_FILES[family]))
    cached = new hb.Face(new hb.Blob(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)))
    faces.set(family, cached)
  }
  return cached
}

function font(family: FontFamily, weight: number): hb.Font {
  const key = `${family}:${weight}`
  let cached = fonts.get(key)
  if (!cached) {
    cached = new hb.Font(face(family))
    cached.setVariations([new hb.Variation('wght', weight)])
    fonts.set(key, cached)
  }
  return cached
}

interface ShapedGlyph {
  path: string
  x: number
  y: number
}

function shapeText(value: string, options: TextOptions): { glyphs: ShapedGlyph[], advance: number, scale: number } {
  const family = options.family ?? (DEVANAGARI.test(value) ? 'devanagari' : 'inter')
  const shaper = font(family, options.weight ?? 400)
  const buffer = new hb.Buffer()
  buffer.addText(value)
  buffer.guessSegmentProperties()
  const features = options.tabularNumbers ? [hb.Feature.fromString('tnum')].filter((feature) => feature !== undefined) : []
  hb.shape(shaper, buffer, features)
  const positions = buffer.getGlyphPositions()
  const glyphs: ShapedGlyph[] = []
  let cursor = 0
  for (const [index, info] of buffer.getGlyphInfos().entries()) {
    const position = positions[index]
    if (!position) continue
    glyphs.push({ path: shaper.glyphToPath(info.codepoint), x: cursor + position.xOffset, y: position.yOffset })
    cursor += position.xAdvance
  }
  return { glyphs, advance: cursor, scale: options.size / face(family).upem }
}

export function measureText(value: string, options: TextOptions): number {
  const { advance, scale } = shapeText(value, options)
  return advance * scale
}

/** Renders shaped text as SVG outlines so output is identical on every OS. `y` is the baseline. */
export function textPath(value: string, x: number, y: number, options: TextOptions): string {
  const { glyphs, advance, scale } = shapeText(value, options)
  const anchor = options.anchor ?? 'start'
  const startX = anchor === 'middle' ? x - (advance * scale) / 2 : anchor === 'end' ? x - advance * scale : x
  const paths = glyphs
    .filter((glyph) => glyph.path)
    .map((glyph) => `<path transform="translate(${(startX + glyph.x * scale).toFixed(3)} ${(y - glyph.y * scale).toFixed(3)}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})" d="${glyph.path}"/>`)
    .join('')
  return `<g fill="${options.fill}">${paths}</g>`
}
