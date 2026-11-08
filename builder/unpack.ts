import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BAND10_DEVICE, type DataSourceKey, type DigitSet, type WatchFaceLayout, type WatchFaceManifest, type WatchFaceTheme, type WatchFaceWidget } from '../core/index.ts'
import { inspectWatchFace, type Definition, type ParsedElement } from '../parser/binary.ts'
import { readI16LE, readU24LE } from '../parser/bytes.ts'
import { decodeImageBlock, decodeImageListBlock, writeDecodedPng, type DecodedImage } from '../parser/imageCodec.ts'

export interface UnpackResult {
  directory: string
  widgets: number
  images: number
  warnings: string[]
}

const NATIVE_ALIGN = { 0: 'right', 1: 'left', 2: 'center' } as const

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported-face'
}

/** Decompiles a Band 10 .face/.bin into an editable layout.json + manifest.json + PNG assets. */
export async function unpackWatchFace(filePath: string, outputDirectory: string): Promise<UnpackResult> {
  const buffer = new Uint8Array(await readFile(filePath))
  const inspection = inspectWatchFace(buffer)
  const warnings = [...inspection.warnings]
  const directory = path.resolve(outputDirectory)
  const digitSets: Record<string, DigitSet> = {}
  const themes: WatchFaceTheme[] = []
  let images = 0

  for (const face of inspection.faces.slice(0, 2)) {
    const prefix = face.header.index === 0 ? 'normal' : 'aod'
    const assetDirectory = path.join(directory, 'assets', prefix)
    await mkdir(assetDirectory, { recursive: true })
    const definitions = new Map(face.definitions.map((definition) => [`${definition.type}:${definition.index}`, definition]))
    const singles = new Map<number, string>()
    const lists = new Map<number, string[]>()

    const single = async (index: number): Promise<string | undefined> => {
      if (singles.has(index)) return singles.get(index)
      const definition = definitions.get(`2:${index}`)
      if (!definition) return undefined
      const reference = `assets/${prefix}/image-${index}.png`
      await writeDecodedPng(decodeImageBlock(buffer, definition.offset), path.join(directory, reference))
      images += 1
      singles.set(index, reference)
      return reference
    }
    const list = async (index: number): Promise<string[] | undefined> => {
      if (lists.has(index)) return lists.get(index)
      const definition = definitions.get(`3:${index}`)
      if (!definition) return undefined
      const decoded: DecodedImage[] = decodeImageListBlock(buffer, definition.offset)
      const references = await Promise.all(decoded.map(async (image, item) => {
        const reference = `assets/${prefix}/list-${index}-${item}.png`
        await writeDecodedPng(image, path.join(directory, reference))
        return reference
      }))
      images += references.length
      lists.set(index, references)
      return references
    }

    const widgets: WatchFaceWidget[] = []
    for (const element of face.elements) {
      const base = { id: `${prefix}-${element.index}`, x: element.x, y: element.y, z: element.index, allowOverlap: true }
      const widget = await convertElement(element, base, definitions, buffer, single, list, digitSets, prefix, warnings)
      if (widget) widgets.push(widget)
    }
    themes.push({ background: '#000000', widgets })
  }

  const [normal, aod] = themes
  if (!normal) throw new Error('The file contains no faces')
  const layout: WatchFaceLayout = {
    $schema: '../../schemas/layout.schema.json',
    formatVersion: 1,
    canvas: { width: BAND10_DEVICE.width, height: BAND10_DEVICE.height, clip: 'pill' },
    assets: { digitSets },
    normal,
    ...(aod ? { aod: { ...aod, enabled: true } } : {}),
  }
  const name = inspection.header.name || path.basename(filePath).replace(/\.(face|bin)$/i, '')
  const manifest: WatchFaceManifest = {
    $schema: '../../schemas/manifest.schema.json',
    formatVersion: 1,
    id: /^\d{9}$/.test(inspection.header.id) ? inspection.header.id : '999999999',
    name: name.slice(0, 60),
    author: 'Imported',
    version: '1.0.0',
    description: `Decompiled from ${path.basename(filePath)}`,
    license: 'UNLICENSED',
    device: 'xiaomi-smart-band-10',
    preview: 'generated',
    output: slug(name),
    compiler: { target: 'native', imageCompression: true },
  }
  await writeFile(path.join(directory, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`)
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { directory, widgets: themes.reduce((total, theme) => total + theme.widgets.length, 0), images, warnings }
}

async function convertElement(
  element: ParsedElement,
  base: { id: string, x: number, y: number, z: number, allowOverlap: boolean },
  definitions: Map<string, Definition>,
  buffer: Uint8Array,
  single: (index: number) => Promise<string | undefined>,
  list: (index: number) => Promise<string[] | undefined>,
  digitSets: Record<string, DigitSet>,
  prefix: string,
  warnings: string[],
): Promise<WatchFaceWidget | undefined> {
  if (element.kind === 'image') {
    const asset = await single(element.referenceIndex)
    return asset ? { ...base, type: 'image', asset } : undefined
  }
  if (element.kind === 'animation') {
    const frames = await list(Number(element.details?.imageListIndex ?? -1))
    if (!frames || frames.length < 2) return undefined
    return { ...base, type: 'animation', frames, intervalMs: Math.max(16, Number(element.details?.intervalMs ?? 100)), repeat: Number(element.details?.repeat ?? 0) }
  }
  const property = definitions.get(`7:${element.referenceIndex}`)
  const source = element.dataSourceName as DataSourceKey | undefined
  if (!property || !source) {
    warnings.push(`Skipped ${prefix} element ${element.index} (${element.kind}): unsupported or unknown data source ${element.dataSource ?? ''}`.trim())
    return undefined
  }
  if (element.kind === 'number') {
    const listIndex = Number(element.details?.imageListIndex ?? -1)
    const glyphs = await list(listIndex)
    if (!glyphs || glyphs.length < 10) {
      warnings.push(`Skipped ${prefix} number element ${element.index}: digit list has ${glyphs?.length ?? 0} images`)
      return undefined
    }
    const setName = `${prefix}-${listIndex}`
    digitSets[setName] = { digits: glyphs.slice(0, 10) as DigitSet['digits'], minus: glyphs[10] ?? glyphs[0]! }
    const hasUnit = property.length >= 20 && buffer[property.offset + 19] === 2
    const unitAsset = hasUnit ? await single(readU24LE(buffer, property.offset + 16)) : undefined
    return {
      ...base,
      type: 'number',
      source,
      digitSet: setName,
      digits: Number(element.details?.digits ?? 1),
      align: NATIVE_ALIGN[(Number(element.details?.align ?? 1) & 3) as 0 | 1 | 2] ?? 'left',
      spacing: buffer[property.offset + 13] ?? 0,
      leadingZero: Boolean(element.details?.leadingZero),
      ...(unitAsset ? { unitAsset } : {}),
    }
  }
  if (element.kind === 'image-list') {
    const assets = await list(Number(element.details?.imageListIndex ?? -1))
    if (!assets?.length) return undefined
    const values = Array.from({ length: Number(element.details?.mappedValues ?? 0) }, (_, index) => readI16LE(buffer, property.offset + 16 + index * 4))
    const items = assets.map((asset, index) => ({ value: values[index] ?? index, asset }))
    return { ...base, type: 'image-list', source, fallback: 'floor', items }
  }
  if (element.kind === 'progress') {
    const foreground = await single(readU24LE(buffer, property.offset + 8))
    if (!foreground) return undefined
    warnings.push(`${prefix} progress element ${element.index} imported as a bar; adjust width/height/thickness manually`)
    return { ...base, type: 'progress', source, maximum: 100, shape: 'bar', width: 100, height: 8, thickness: 8, foreground }
  }
  warnings.push(`Skipped ${prefix} element ${element.index}: ${element.kind} widgets are not editable yet`)
  return undefined
}
