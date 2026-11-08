import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SIMULATION, type SimulationState } from '../core/index.ts'
import { copyStagedAssets } from './assets.ts'
import { buildProject } from './build.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function rewriteAssetReferences(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === 'string') return replacements.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => rewriteAssetReferences(item, replacements))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteAssetReferences(item, replacements)]))
  }
  return value
}

export interface SyncPreviewOptions {
  /** Directory under preview/public that receives the project. */
  outputDirectory?: string
  /** Page-relative URL prefix of that directory, e.g. `project/` or `templates/glass-lock/`. */
  urlPrefix?: string
  simulation?: SimulationState
}

export async function syncPreviewProject(directory: string, options: SyncPreviewOptions = {}): Promise<string> {
  const build = await buildProject(directory)
  const outputDirectory = options.outputDirectory ?? path.join(repositoryRoot, 'preview', 'public', 'project')
  const urlPrefix = options.urlPrefix ?? 'project/'
  const assetDirectory = path.join(outputDirectory, 'assets')
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(assetDirectory, { recursive: true })
  await Promise.all([
    copyStagedAssets(build.normalAssets, assetDirectory),
    copyStagedAssets(build.aodAssets, assetDirectory),
    copyFile(build.previewPath, path.join(outputDirectory, 'preview.png')),
    copyFile(build.fprjPath, path.join(outputDirectory, 'project.fprj')),
  ])
  const replacements = new Map<string, string>()
  for (const asset of [...build.normalAssets.values(), ...build.aodAssets.values()]) {
    replacements.set(asset.reference, `${urlPrefix}assets/${asset.fileName}`)
  }
  const layout = rewriteAssetReferences(build.project.layout, replacements)
  const manifest = { ...build.project.manifest, preview: `${urlPrefix}preview.png` }
  await Promise.all([
    writeFile(path.join(outputDirectory, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`),
    writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(outputDirectory, 'simulation.json'), `${JSON.stringify(options.simulation ?? DEFAULT_SIMULATION, null, 2)}\n`),
    writeFile(path.join(outputDirectory, 'source.json'), `${JSON.stringify({ directory: build.project.directory }, null, 2)}\n`),
  ])
  return outputDirectory
}