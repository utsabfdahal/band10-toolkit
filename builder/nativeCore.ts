import { DATA_SOURCES, type WatchFaceLayout, type WatchFaceManifest, type WatchFaceWidget } from '../core/index.ts'
import {
  FACE_HEADER_SIZE,
  MAIN_HEADER_SIZE,
  inspectWatchFace,
} from '../parser/binary.ts'
import { writeFixedString, writeU16LE, writeU24LE, writeU32LE } from '../parser/bytes.ts'
import { encodeRgbaBlock, encodeRgbaList, type RgbaImage } from '../parser/imageEncode.ts'

/** Resolves a GMF image name to decoded RGBA pixels (filesystem in Node, fetch+canvas in the browser). */
export type ImageLoader = (name: string) => Promise<RgbaImage>

export interface GmfDefinition {
  name: string
  id: string
  previewImg: string
  elementsNormal: GmfElement[]
  elementsAod: GmfElement[]
}

export interface GmfElement {
  type: 'element' | 'element_anim' | 'widge_dignum' | 'widge_imagelist' | 'widge_process'
  x: number
  y: number
  image?: string
  imageList?: string[]
  imageIndexList?: number[]
  dataSrc?: string
  showCount?: number
  align?: number
  spacing?: number
  showZero?: boolean
  maximum?: number
  animInterval?: number
  animRepeat?: number
}

interface BinaryResource {
  key: string
  index: number
  block: Uint8Array
}

interface PreparedElement {
  source: GmfElement
  referenceType: 2 | 4 | 7
  referenceIndex: number
}

interface PreparedAnimation {
  listIndex: number
  intervalMs: number
  repeat: number
}

interface PreparedWidget {
  source: GmfElement
  type: 'number' | 'image-list' | 'progress'
  listIndex?: number
  singleIndex?: number
}

interface PreparedFace {
  elements: PreparedElement[]
  singles: BinaryResource[]
  lists: BinaryResource[]
  animations: PreparedAnimation[]
  widgets: PreparedWidget[]
  definitionSize: number
  propertySize: number
}

const DEFINITION_SIZE = 16

export type ImageNamer = (reference: string) => string

export function gmfElementFor(widget: WatchFaceWidget, layout: WatchFaceLayout, nameOf: ImageNamer): GmfElement {
  if (widget.type === 'image') {
    return { type: 'element', x: widget.x, y: widget.y, image: nameOf(widget.asset) }
  }
  if (widget.type === 'number') {
    const set = layout.assets.digitSets[widget.digitSet]
    if (!set) throw new Error(`Unknown digit set: ${widget.digitSet}`)
    return {
      type: 'widge_dignum',
      x: widget.x,
      y: widget.y,
      showCount: widget.digits,
      align: { right: 0, left: 1, center: 2 }[widget.align],
      spacing: widget.spacing ?? 0,
      showZero: widget.leadingZero ?? false,
      dataSrc: DATA_SOURCES[widget.source].fprjId,
      imageList: [...set.digits, set.minus].map(nameOf),
      ...(widget.unitAsset ? { image: nameOf(widget.unitAsset) } : {}),
    }
  }
  if (widget.type === 'image-list') {
    const ordered = [...widget.items].sort((left, right) => left.value - right.value)
    return {
      type: 'widge_imagelist',
      x: widget.x,
      y: widget.y,
      dataSrc: DATA_SOURCES[widget.source].fprjId,
      imageList: ordered.map((item) => nameOf(item.asset)),
      imageIndexList: ordered.map((item) => item.value),
    }
  }
  if (widget.type === 'animation') {
    return {
      type: 'element_anim',
      x: widget.x,
      y: widget.y,
      imageList: widget.frames.map(nameOf),
      animInterval: widget.intervalMs,
      animRepeat: widget.repeat,
    }
  }
  return {
    type: 'widge_process',
    x: widget.x,
    y: widget.y,
    dataSrc: DATA_SOURCES[widget.source].fprjId,
    image: nameOf(widget.foreground),
    maximum: widget.maximum,
  }
}

function orderedElements(widgets: WatchFaceWidget[], layout: WatchFaceLayout, nameOf: ImageNamer): GmfElement[] {
  return [...widgets]
    .filter((widget) => widget.visible !== false)
    .sort((left, right) => left.z - right.z)
    .map((widget) => gmfElementFor(widget, layout, nameOf))
}

export function gmfDefinitionFor(manifest: WatchFaceManifest, layout: WatchFaceLayout, normalName: ImageNamer, aodName: ImageNamer): GmfDefinition & Record<string, unknown> {
  return {
    name: manifest.name,
    id: manifest.id,
    deviceType: 'xiaomi_band_10',
    previewImg: 'preview',
    forceIndex256: false,
    elementsNormal: orderedElements(layout.normal.widgets, layout, normalName),
    elementsAod: layout.aod?.enabled ? orderedElements(layout.aod.widgets, layout, aodName) : [],
  }
}

function imageListKey(names: string[]): string {
  return names.join('\u0000')
}

function widgetPropertySize(widget: PreparedWidget): number {
  if (widget.type === 'image-list') return 16 + (widget.source.imageIndexList?.length ?? 0) * 4
  if (widget.type === 'progress') return 40
  return 20
}

async function prepareFace(elements: GmfElement[], load: ImageLoader, compress: boolean): Promise<PreparedFace> {
  const singleNames: string[] = []
  const listNames: string[][] = []
  const singleIndex = new Map<string, number>()
  const listIndex = new Map<string, number>()
  const animations: PreparedAnimation[] = []
  const widgets: PreparedWidget[] = []
  const preparedElements: PreparedElement[] = []

  const useSingle = (name: string): number => {
    const existing = singleIndex.get(name)
    if (existing !== undefined) return existing
    const index = singleNames.length
    singleNames.push(name)
    singleIndex.set(name, index)
    return index
  }
  const useList = (names: string[]): number => {
    const key = imageListKey(names)
    const existing = listIndex.get(key)
    if (existing !== undefined) return existing
    const index = listNames.length
    listNames.push(names)
    listIndex.set(key, index)
    return index
  }

  for (const element of elements) {
    if (element.type === 'element') {
      if (!element.image) throw new Error('Static element is missing its image')
      preparedElements.push({ source: element, referenceType: 2, referenceIndex: useSingle(element.image) })
      continue
    }
    if (element.type === 'element_anim') {
      if (!element.imageList?.length) throw new Error('Animation is missing frames')
      const animationIndex = animations.length
      animations.push({
        listIndex: useList(element.imageList),
        intervalMs: element.animInterval ?? 72,
        repeat: element.animRepeat ?? 0,
      })
      preparedElements.push({ source: element, referenceType: 4, referenceIndex: animationIndex })
      continue
    }

    const widgetIndex = widgets.length
    if (element.type === 'widge_dignum') {
      if (!element.imageList?.length) throw new Error('Digital number is missing its digit images')
      widgets.push({
        source: element,
        type: 'number',
        listIndex: useList(element.imageList),
        singleIndex: element.image ? useSingle(element.image) : undefined,
      })
    } else if (element.type === 'widge_imagelist') {
      if (!element.imageList?.length) throw new Error('Image-list widget is missing images')
      widgets.push({ source: element, type: 'image-list', listIndex: useList(element.imageList) })
    } else {
      if (!element.image) throw new Error('Progress widget is missing its foreground image')
      widgets.push({ source: element, type: 'progress', singleIndex: useSingle(element.image) })
    }
    preparedElements.push({ source: element, referenceType: 7, referenceIndex: widgetIndex })
  }

  const singles = await Promise.all(singleNames.map(async (name, index): Promise<BinaryResource> => ({
    key: name,
    index,
    block: encodeRgbaBlock(await load(name), compress).block,
  })))
  const lists = await Promise.all(listNames.map(async (names, index): Promise<BinaryResource> => ({
    key: imageListKey(names),
    index,
    block: encodeRgbaList(await Promise.all(names.map(load)), compress).block,
  })))
  const definitionCount = preparedElements.length + singles.length + lists.length + animations.length + widgets.length
  const propertySize = preparedElements.length * 16 + animations.length * 12 + widgets.reduce((total, widget) => total + widgetPropertySize(widget), 0)
  return {
    elements: preparedElements,
    singles,
    lists,
    animations,
    widgets,
    definitionSize: definitionCount * DEFINITION_SIZE,
    propertySize,
  }
}

function writeSection(header: Uint8Array, offset: number, count: number, tableOffset: number): void {
  writeU32LE(header, offset, count)
  writeU32LE(header, offset + 4, tableOffset)
}

function makeFaceHeader(face: PreparedFace, definitionStart: number, previewOffset: number): Uint8Array {
  const header = new Uint8Array(FACE_HEADER_SIZE)
  writeU32LE(header, 4, previewOffset)
  let offset = definitionStart
  writeSection(header, 0x08, face.elements.length, offset)
  offset += face.elements.length * DEFINITION_SIZE
  writeSection(header, 0x10, 0, offset)
  writeSection(header, 0x18, face.singles.length, offset)
  offset += face.singles.length * DEFINITION_SIZE
  writeSection(header, 0x20, face.lists.length, offset)
  offset += face.lists.length * DEFINITION_SIZE
  writeSection(header, 0x28, face.animations.length, offset)
  offset += face.animations.length * DEFINITION_SIZE
  writeSection(header, 0x30, 0, offset)
  writeSection(header, 0x38, 0, offset)
  writeSection(header, 0x40, face.widgets.length, offset)
  offset += face.widgets.length * DEFINITION_SIZE
  writeSection(header, 0x48, 0, offset)
  writeSection(header, 0x50, 0, offset)
  return header
}

function writeDefinition(buffer: Uint8Array, offset: number, index: number, type: number, target: number, length: number): void {
  writeU16LE(buffer, offset, index)
  buffer[offset + 3] = type
  writeU32LE(buffer, offset + 8, target)
  writeU32LE(buffer, offset + 12, length)
}

function writeDataSource(buffer: Uint8Array, offset: number, source: string | undefined): void {
  if (!source) return
  const normalized = source.replace(/[^0-9a-f]/gi, '')
  if (normalized.length > 6) throw new Error(`Native compiler does not yet support data source ${source} (>3 bytes)`)
  const hex = normalized.length % 2 === 0 ? normalized : `0${normalized}`
  const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))
  buffer.set(bytes.subarray(0, 3), offset)
}

function makeWidgetProperty(widget: PreparedWidget): Uint8Array {
  const source = widget.source
  const property = new Uint8Array(widgetPropertySize(widget))
  writeDataSource(property, 0, source.dataSrc)

  if (widget.type === 'number') {
    property[2] = Math.max(1, source.showCount ?? 1)
    property[3] = 0x10 | ((source.showZero ? 1 : 0) << 2) | ((source.align ?? 1) & 0x03)
    writeU24LE(property, 8, widget.listIndex ?? 0)
    property[11] = 3
    property[13] = (source.spacing ?? 0) & 0xff
    if (widget.singleIndex !== undefined) {
      writeU24LE(property, 16, widget.singleIndex)
      property[19] = 2
    }
    return property
  }

  if (widget.type === 'image-list') {
    property[3] = 0x20
    writeU24LE(property, 8, widget.listIndex ?? 0)
    property[11] = 3
    writeU24LE(property, 12, 0x200)
    for (const [index, value] of (source.imageIndexList ?? []).entries()) {
      writeU16LE(property, 16 + index * 4, value)
    }
    return property
  }

  property[3] = 0x40
  writeU24LE(property, 8, widget.singleIndex ?? 0)
  property[11] = 2
  return property
}

function faceResources(face: PreparedFace): BinaryResource[] {
  return [...face.singles, ...face.lists]
}

function faceResourceLength(face: PreparedFace): number {
  return faceResources(face).reduce((total, resource) => total + resource.block.length, 0)
}

function resourceOffsets(face: PreparedFace, start: number): { singles: number[]; lists: number[] } {
  const singles: number[] = []
  const lists: number[] = []
  let offset = start
  for (const resource of face.singles) {
    singles.push(offset)
    offset += resource.block.length
  }
  for (const resource of face.lists) {
    lists.push(offset)
    offset += resource.block.length
  }
  return { singles, lists }
}

function makeFaceData(face: PreparedFace, propertyStart: number, resources: { singles: number[]; lists: number[] }): Uint8Array {
  const output = new Uint8Array(face.definitionSize + face.propertySize)
  let definitionOffset = 0
  let propertyOffset = face.definitionSize
  let absolutePropertyOffset = propertyStart

  for (const [index] of face.elements.entries()) {
    writeDefinition(output, definitionOffset, index, 0, absolutePropertyOffset, 16)
    definitionOffset += DEFINITION_SIZE
    absolutePropertyOffset += 16
  }
  for (const resource of face.singles) {
    writeDefinition(output, definitionOffset, resource.index, 2, resources.singles[resource.index] ?? 0, resource.block.length)
    definitionOffset += DEFINITION_SIZE
  }
  for (const resource of face.lists) {
    writeDefinition(output, definitionOffset, resource.index, 3, resources.lists[resource.index] ?? 0, resource.block.length)
    definitionOffset += DEFINITION_SIZE
  }
  for (const [index] of face.animations.entries()) {
    writeDefinition(output, definitionOffset, index, 4, absolutePropertyOffset, 12)
    definitionOffset += DEFINITION_SIZE
    absolutePropertyOffset += 12
  }
  for (const [index, widget] of face.widgets.entries()) {
    const size = widgetPropertySize(widget)
    writeDefinition(output, definitionOffset, index, 7, absolutePropertyOffset, size)
    definitionOffset += DEFINITION_SIZE
    absolutePropertyOffset += size
  }

  for (const element of face.elements) {
    writeU24LE(output, propertyOffset, element.referenceIndex)
    output[propertyOffset + 3] = element.referenceType
    writeU16LE(output, propertyOffset + 4, element.source.x & 0xffff)
    writeU16LE(output, propertyOffset + 6, element.source.y & 0xffff)
    propertyOffset += 16
  }
  for (const animation of face.animations) {
    writeU24LE(output, propertyOffset, animation.listIndex)
    output[propertyOffset + 3] = 3
    writeU16LE(output, propertyOffset + 6, animation.intervalMs)
    writeU16LE(output, propertyOffset + 8, animation.repeat)
    propertyOffset += 12
  }
  for (const widget of face.widgets) {
    const property = makeWidgetProperty(widget)
    output.set(property, propertyOffset)
    propertyOffset += property.length
  }
  return output
}

function makeMainHeader(definition: GmfDefinition, faceCount: number, previewOffset: number): Uint8Array {
  const header = new Uint8Array(MAIN_HEADER_SIZE)
  header.set([0x5a, 0xa5, 0x34, 0x12])
  writeU32LE(header, 0x10, 0x800)
  writeU16LE(header, 0x1c, faceCount)
  writeU16LE(header, 0x1e, faceCount > 1 ? faceCount + 2 : 1)
  writeU32LE(header, 0x20, previewOffset)
  writeFixedString(header, 0x28, 9, definition.id)
  writeFixedString(header, 0x68, 60, definition.name)
  return header
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export interface NativeImageSources {
  normal: ImageLoader
  aod: ImageLoader
}

export async function packGmfDefinition(definition: GmfDefinition, images: NativeImageSources, compress = true): Promise<Uint8Array> {
  if (!Array.isArray(definition.elementsNormal) || !Array.isArray(definition.elementsAod)) throw new Error('wfDef.json does not contain normal/AOD element arrays')
  if (!/^\d{9}$/.test(definition.id)) throw new Error('Native package IDs must contain exactly 9 digits')

  const normal = await prepareFace(definition.elementsNormal, images.normal, compress)
  const hasAod = definition.elementsAod.length > 0
  const aod = hasAod ? await prepareFace(definition.elementsAod, images.aod, compress) : undefined
  const faceCount = hasAod ? 2 : 1
  const headersEnd = MAIN_HEADER_SIZE + faceCount * FACE_HEADER_SIZE
  const normalDefinitionStart = headersEnd
  const normalPropertyStart = normalDefinitionStart + normal.definitionSize
  const preview = encodeRgbaBlock(await images.normal(definition.previewImg || 'preview'), compress).block
  const previewOffset = normalPropertyStart + normal.propertySize
  const normalResourceStart = previewOffset + preview.length
  const normalOffsets = resourceOffsets(normal, normalResourceStart)
  const normalData = makeFaceData(normal, normalPropertyStart, normalOffsets)

  let aodDefinitionStart = 0
  let aodData: Uint8Array | undefined
  let aodOffsets: { singles: number[]; lists: number[] } | undefined
  if (aod) {
    aodDefinitionStart = normalResourceStart + faceResourceLength(normal)
    const aodPropertyStart = aodDefinitionStart + aod.definitionSize
    const aodResourceStart = aodPropertyStart + aod.propertySize
    aodOffsets = resourceOffsets(aod, aodResourceStart)
    aodData = makeFaceData(aod, aodPropertyStart, aodOffsets)
  }

  const parts: Uint8Array[] = [
    makeMainHeader(definition, faceCount, previewOffset),
    makeFaceHeader(normal, normalDefinitionStart, previewOffset),
  ]
  if (aod) parts.push(makeFaceHeader(aod, aodDefinitionStart, 0))
  parts.push(normalData, preview, ...faceResources(normal).map((resource) => resource.block))
  if (aod && aodData && aodOffsets) parts.push(aodData, ...faceResources(aod).map((resource) => resource.block))
  const binary = concatenate(parts)
  const inspection = inspectWatchFace(binary)
  const structuralWarnings = inspection.warnings.filter((warning) => warning.includes('outside the file'))
  if (structuralWarnings.length > 0) throw new Error(`Native package failed structural inspection: ${structuralWarnings.join('; ')}`)
  return binary
}