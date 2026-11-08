import sharp from 'sharp'
import { assertRange, readU16LE, readU32LE } from './bytes.ts'
import { COMPRESSED_IMAGE_MAGIC, IMAGE_HEADER_SIZE, PALETTE_BYTES, encodeRgbaBlock, encodeRgbaList, type EncodedImage, type RgbaImage } from './imageEncode.ts'
import { decodeRleV1, decodeRleV2 } from './rle.ts'

export { COMPRESSED_IMAGE_MAGIC, IMAGE_HEADER_SIZE, PALETTE_BYTES, encodeRgbaBlock, encodeRgbaList, type EncodedImage, type RgbaImage }

export interface DecodedImage {
  rgba: Uint8Array
  width: number
  height: number
  sign: number
  encodedLength: number
  compressed: boolean
}

export async function readRgbaFile(path: string): Promise<RgbaImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.channels !== 4) throw new Error(`Expected RGBA data for ${path}; received ${info.channels} channels`)
  return { rgba: new Uint8Array(data), width: info.width, height: info.height }
}

export async function encodeImageFile(path: string, compress = true): Promise<EncodedImage> {
  return encodeRgbaBlock(await readRgbaFile(path), compress)
}

export async function encodeImageListFiles(paths: string[], compress = true): Promise<EncodedImage> {
  if (paths.length === 0 || paths.length > 255) throw new Error('Image lists must contain 1–255 images')
  return encodeRgbaList(await Promise.all(paths.map(readRgbaFile)), compress)
}

function hasCompressedMagic(buffer: Uint8Array, offset: number): boolean {
  return COMPRESSED_IMAGE_MAGIC.every((value, index) => buffer[offset + index] === value)
}

function decodeRawPixels(raw: Uint8Array, sign: number, width: number, height: number, bytesPerPixel: number): Uint8Array {
  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)

  if (sign === 0x10 || bytesPerPixel === 1) {
    if (raw.length < PALETTE_BYTES + pixelCount) throw new Error('Indexed image payload is shorter than its palette and pixels')
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const paletteOffset = (raw[PALETTE_BYTES + pixel] ?? 0) * 4
      const output = pixel * 4
      rgba[output] = raw[paletteOffset + 2] ?? 0
      rgba[output + 1] = raw[paletteOffset + 1] ?? 0
      rgba[output + 2] = raw[paletteOffset] ?? 0
      rgba[output + 3] = raw[paletteOffset + 3] ?? 0
    }
    return rgba
  }

  if (bytesPerPixel === 4) {
    if (raw.length < pixelCount * 4) throw new Error('BGRA image payload is truncated')
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const input = pixel * 4
      rgba[input] = raw[input + 2] ?? 0
      rgba[input + 1] = raw[input + 1] ?? 0
      rgba[input + 2] = raw[input] ?? 0
      rgba[input + 3] = raw[input + 3] ?? 0
    }
    return rgba
  }

  if (bytesPerPixel === 3 || bytesPerPixel === 2) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const input = pixel * bytesPerPixel
      const low = raw[input] ?? 0
      const high = raw[input + 1] ?? 0
      const output = pixel * 4
      rgba[output] = high & 0xf8
      rgba[output + 1] = (((high & 0x07) << 5) | ((low & 0xe0) >>> 3)) & 0xfc
      rgba[output + 2] = (low & 0x1f) << 3
      rgba[output + 3] = bytesPerPixel === 3 ? (raw[input + 2] ?? 255) : 255
    }
    return rgba
  }

  throw new Error(`Unsupported image bytes-per-pixel value ${bytesPerPixel}`)
}

function decodePayload(buffer: Uint8Array, offset: number, length: number, sign: number, width: number, height: number): { rgba: Uint8Array; compressed: boolean } {
  assertRange(buffer, offset, length, 'image payload')
  let raw: Uint8Array
  let bytesPerPixel: number
  let compressed = false

  if (length >= 8 && hasCompressedMagic(buffer, offset)) {
    const info = readU32LE(buffer, offset + 4)
    bytesPerPixel = info & 0x0f
    const expectedLength = info >>> 4
    const encoded = buffer.subarray(offset + 8, offset + length)
    raw = sign === 0x10 || bytesPerPixel === 1
      ? decodeRleV2(encoded, expectedLength)
      : decodeRleV1(encoded, expectedLength, bytesPerPixel)
    compressed = true
  } else {
    raw = buffer.subarray(offset, offset + length)
    bytesPerPixel = sign === 6 ? 3 : sign === 3 ? 2 : sign === 0x10 ? 1 : 4
  }

  return { rgba: decodeRawPixels(raw, sign, width, height, bytesPerPixel), compressed }
}

export function decodeImageBlock(buffer: Uint8Array, offset: number): DecodedImage {
  assertRange(buffer, offset, IMAGE_HEADER_SIZE, 'image header')
  const sign = buffer[offset] ?? 0
  const width = readU16LE(buffer, offset + 4)
  const height = readU16LE(buffer, offset + 6)
  const encodedLength = readU32LE(buffer, offset + 8)
  if (width === 0 || height === 0) throw new Error(`Invalid image dimensions ${width}×${height} at offset ${offset}`)
  const decoded = decodePayload(buffer, offset + IMAGE_HEADER_SIZE, encodedLength, sign, width, height)
  return { ...decoded, width, height, sign, encodedLength: IMAGE_HEADER_SIZE + encodedLength }
}

export function decodeImageListBlock(buffer: Uint8Array, offset: number): DecodedImage[] {
  assertRange(buffer, offset, IMAGE_HEADER_SIZE, 'image-list header')
  const sign = buffer[offset] ?? 0
  const count = buffer[offset + 1] ?? 0
  const compressed = buffer[offset + 2] === 4 || buffer[offset + 2] === 8
  const width = readU16LE(buffer, offset + 4)
  const height = readU16LE(buffer, offset + 6)
  const totalLength = readU32LE(buffer, offset + 8)
  if (count === 0 || width === 0 || height === 0) throw new Error(`Invalid image list at offset ${offset}`)
  assertRange(buffer, offset + IMAGE_HEADER_SIZE, totalLength, 'image-list payload')

  const lengths = compressed
    ? Array.from({ length: count }, (_, index) => readU32LE(buffer, offset + IMAGE_HEADER_SIZE + index * 4))
    : Array.from({ length: count }, () => Math.floor(totalLength / count))
  let payloadOffset = offset + IMAGE_HEADER_SIZE + (compressed ? count * 4 : 0)
  return lengths.map((length) => {
    const decoded = decodePayload(buffer, payloadOffset, length, sign, width, height)
    payloadOffset += length
    return { ...decoded, width, height, sign, encodedLength: length }
  })
}

export async function writeDecodedPng(image: DecodedImage, outputPath: string): Promise<void> {
  await sharp(Buffer.from(image.rgba), {
    raw: { width: image.width, height: image.height, channels: 4 },
  }).png().toFile(outputPath)
}