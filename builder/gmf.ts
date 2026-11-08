import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LoadedProject } from '../core/index.ts'
import { copyStagedAssets, requireStagedAsset, type StagedAssetMap } from './assets.ts'
import { gmfDefinitionFor } from './nativeCore.ts'

function withoutExtension(fileName: string): string {
  return fileName.replace(/\.png$/i, '')
}

function imageName(assets: StagedAssetMap, reference: string): string {
  return withoutExtension(requireStagedAsset(assets, reference).fileName)
}

export async function writeGmfIntermediate(
  project: LoadedProject,
  normalAssets: StagedAssetMap,
  aodAssets: StagedAssetMap,
  outputDirectory: string,
  previewPath: string,
): Promise<string> {
  const imagesDirectory = path.join(outputDirectory, 'images')
  const aodImagesDirectory = path.join(outputDirectory, 'images_aod')
  await Promise.all([mkdir(imagesDirectory, { recursive: true }), mkdir(aodImagesDirectory, { recursive: true })])
  await Promise.all([
    copyStagedAssets(normalAssets, imagesDirectory),
    copyStagedAssets(aodAssets, aodImagesDirectory),
    copyFile(previewPath, path.join(imagesDirectory, 'preview.png')),
  ])
  const definition = gmfDefinitionFor(
    project.manifest,
    project.layout,
    (reference) => imageName(normalAssets, reference),
    (reference) => imageName(aodAssets, reference),
  )
  const outputPath = path.join(outputDirectory, 'wfDef.json')
  await writeFile(outputPath, `${JSON.stringify(definition, null, 2)}\n`)
  return outputPath
}