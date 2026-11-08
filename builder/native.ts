import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readRgbaFile } from '../parser/imageCodec.ts'
import { packGmfDefinition, type GmfDefinition, type ImageLoader } from './nativeCore.ts'

export * from './nativeCore.ts'

async function resolvePng(directory: string, name: string): Promise<string> {
  const candidates = [path.join(directory, name), path.join(directory, `${name}.png`)]
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next extension form.
    }
  }
  throw new Error(`Cannot resolve image "${name}" in ${directory}`)
}

function directoryLoader(directory: string): ImageLoader {
  return async (name) => readRgbaFile(await resolvePng(directory, name))
}

export async function packGmfDirectory(gmfDirectory: string, outputPath: string, compress = true): Promise<void> {
  const definition = JSON.parse(await readFile(path.join(gmfDirectory, 'wfDef.json'), 'utf8')) as GmfDefinition
  const binary = await packGmfDefinition(definition, {
    normal: directoryLoader(path.join(gmfDirectory, 'images')),
    aod: directoryLoader(path.join(gmfDirectory, 'images_aod')),
  }, compress)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.tmp`
  await writeFile(temporaryPath, binary)
  await rename(temporaryPath, outputPath)
}
