import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { BAND10_DEVICE } from '../core/index.ts'

export interface WallpaperOptions {
  /** 0 keeps the photo as-is, 1 is fully black. Darkening keeps white text readable. */
  dim?: number
  /** Palette size; indexed PNGs pack at ~1 byte per pixel on the band. */
  colors?: number
  /** sharp crop gravity, e.g. 'centre', 'north', 'attention'. */
  position?: string
}

export interface WallpaperResult {
  outputPath: string
  width: number
  height: number
  bytes: number
}

export async function prepareWallpaper(inputPath: string, outputPath: string, options: WallpaperOptions = {}): Promise<WallpaperResult> {
  const dim = Math.min(1, Math.max(0, options.dim ?? 0.35))
  const colors = Math.min(256, Math.max(2, Math.round(options.colors ?? 128)))
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true })
  const info = await sharp(inputPath)
    .rotate()
    .resize(BAND10_DEVICE.width, BAND10_DEVICE.height, { fit: 'cover', position: options.position ?? 'attention' })
    .flatten({ background: '#000000' })
    .linear(1 - dim, 0)
    .png({ compressionLevel: 9, palette: true, colours: colors, dither: 0.6 })
    .toFile(outputPath)
  return { outputPath: path.resolve(outputPath), width: info.width, height: info.height, bytes: info.size }
}
