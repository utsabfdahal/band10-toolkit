import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProject, renderPreviewPng } from '../builder/index.ts'
import { DEFAULT_SIMULATION } from '../core/index.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectDirectory = path.join(repositoryRoot, 'examples', 'glass-lock')
const outputDirectory = path.join(projectDirectory, 'screenshots')
const build = await buildProject(projectDirectory)
// The BS lookup covers the current AD month, so preview with today's date.
const now = new Date()
const simulation = { ...DEFAULT_SIMULATION, dateTime: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T10:08:00` }

await mkdir(outputDirectory, { recursive: true })
await renderPreviewPng(build.project, build.project.layout.normal, build.normalAssets, path.join(outputDirectory, 'active.png'), simulation)
if (!build.project.layout.aod?.enabled) throw new Error('Glass Lock AOD is not enabled')
await renderPreviewPng(
  build.project,
  build.project.layout.aod,
  build.aodAssets,
  path.join(outputDirectory, 'aod.png'),
  simulation,
)

console.log(`Rendered Glass Lock screenshots in ${outputDirectory}`)
