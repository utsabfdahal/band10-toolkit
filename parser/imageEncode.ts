import { writeU16LE, writeU32LE } from './bytes.ts'
import { encodeRleV1, encodeRleV2 } from './rle.ts'

export const COMPRESSED_IMAGE_MAGIC = Uint8Array.of(0xe0, 0x21, 0xa5, 0x5a)
export const IMAGE_HEADER_SIZE = 12
export const PALETTE_BYTES = 256 * 4

export interface EncodedImage {
  block: Uint8Array
  width: number
  height: number
  sign: number
  compressed: boolean
  colors: number
}

export interface RgbaImage {
  rgba: Uint8Array
  width: number
  height: number
}

function colorKey(data: Uint8Array, offset: number): number {
  return (
    ((data[offset + 3] ?? 0) << 24)
    | ((data[offset] ?? 0) << 16)
    | ((data[offset + 1] ?? 0) << 8)
    | (data[offset + 2] ?? 0)
  ) >>> 0
}

function rgbaToBgra(rgba: Uint8Array): Uint8Array {
  const output = new Uint8Array(rgba.length)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    output[offset] = rgba[offset + 2] ?? 0
    output[offset + 1] = rgba[offset + 1] ?? 0
    output[offset + 2] = rgba[offset] ?? 0
    output[offset + 3] = rgba[offset + 3] ?? 0
  }
  return output
}

function indexedPixels(rgba: Uint8Array): { data: Uint8Array; colors: number } | undefined {
  const palette = new Map<number, number>()
  const indices = new Uint8Array(rgba.length / 4)

  for (let offset = 0, pixel = 0; offset < rgba.length; offset += 4, pixel += 1) {
    const key = colorKey(rgba, offset)
    let index = palette.get(key)
    if (index === undefined) {
      if (palette.size === 256) return undefined
      index = palette.size
      palette.set(key, index)
    }
    indices[pixel] = index
  }

  const output = new Uint8Array(PALETTE_BYTES + indices.length)
  for (const [key, index] of palette) {
    const offset = index * 4
    output[offset] = key & 0xff
    output[offset + 1] = (key >>> 8) & 0xff
    output[offset + 2] = (key >>> 16) & 0xff
    output[offset + 3] = (key >>> 24) & 0xff
  }
  output.set(indices, PALETTE_BYTES)
  return { data: output, colors: palette.size }
}

function compressedPayload(raw: Uint8Array, bytesPerPixel: number, palette: boolean): Uint8Array {
  const encoded = palette ? encodeRleV2(raw) : encodeRleV1(raw, bytesPerPixel)
  const payload = new Uint8Array(8 + encoded.length)
  payload.set(COMPRESSED_IMAGE_MAGIC)
  writeU32LE(payload, 4, (raw.length << 4) | bytesPerPixel)
  payload.set(encoded, 8)
  return payload
}

export function encodeRgbaBlock(image: RgbaImage, compress: boolean): EncodedImage {
  const { rgba, width, height } = image
  const indexed = indexedPixels(rgba)
  const sign = indexed ? 0x10 : 0
  const bytesPerPixel = indexed ? 1 : 4
  const raw = indexed?.data ?? rgbaToBgra(rgba)
  const payload = compress ? compressedPayload(raw, bytesPerPixel, Boolean(indexed)) : raw
  const header = new Uint8Array(IMAGE_HEADER_SIZE)
  header[0] = sign
  if (compress) header[1] = 4
  writeU16LE(header, 4, width)
  writeU16LE(header, 6, height)
  writeU32LE(header, 8, payload.length)
  const block = new Uint8Array(header.length + payload.length)
  block.set(header)
  block.set(payload, header.length)
  return { block, width, height, sign, compressed: compress, colors: indexed?.colors ?? 257 }
}

export function encodeRgbaList(images: RgbaImage[], compress: boolean): EncodedImage {
  if (images.length === 0 || images.length > 255) throw new Error('Image lists must contain 1–255 images')
  const first = images[0]
  if (!first) throw new Error('Image list is empty')
  for (const [index, image] of images.entries()) {
    if (image.width !== first.width || image.height !== first.height) {
      throw new Error(`Image list item ${index} is ${image.width}×${image.height}; expected ${first.width}×${first.height}`)
    }
  }

  const palettes = images.map((image) => indexedPixels(image.rgba))
  const indexed = palettes.every((palette) => palette !== undefined)
  const sign = indexed ? 0x10 : 0
  const payloads = images.map((image, index) => {
    const raw = indexed ? palettes[index]!.data : rgbaToBgra(image.rgba)
    return compress ? compressedPayload(raw, indexed ? 1 : 4, indexed) : raw
  })
  const tableLength = compress ? payloads.length * 4 : 0
  const payloadLength = payloads.reduce((total, payload) => total + payload.length, tableLength)
  const block = new Uint8Array(IMAGE_HEADER_SIZE + payloadLength)
  block[0] = sign
  block[1] = images.length
  if (compress) block[2] = 4
  writeU16LE(block, 4, first.width)
  writeU16LE(block, 6, first.height)
  writeU32LE(block, 8, payloadLength)
  let offset = IMAGE_HEADER_SIZE + tableLength
  for (const [index, payload] of payloads.entries()) {
    if (compress) writeU32LE(block, IMAGE_HEADER_SIZE + index * 4, payload.length)
    block.set(payload, offset)
    offset += payload.length
  }

  return {
    block,
    width: first.width,
    height: first.height,
    sign,
    compressed: compress,
    colors: indexed ? Math.max(...palettes.map((palette) => palette?.colors ?? 0)) : 257,
  }
}
