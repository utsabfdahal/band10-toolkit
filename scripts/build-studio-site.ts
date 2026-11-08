import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncPreviewProject } from '../builder/index.ts'
import { DEFAULT_SIMULATION } from '../core/index.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatesDirectory = path.join(repositoryRoot, 'preview', 'public', 'templates')
const DEFAULT_TEMPLATE = 'glass-lock'
// Video-backed examples are excluded: their source frames are not redistributable.
const TEMPLATES = ['glass-lock', 'minimal-amoled', 'flux-core', 'circuit-link', 'rlc-singularity', 'backend-json']
// Nepali-date templates are built for the current AD month, so preview them on today's date.
const today = new Date()
const simulation = { ...DEFAULT_SIMULATION, dateTime: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T10:08:00` }

await rm(templatesDirectory, { recursive: true, force: true })
await mkdir(templatesDirectory, { recursive: true })
const index: Array<{ id: string, name: string }> = []
for (const id of TEMPLATES) {
  const exampleDirectory = path.join(repositoryRoot, 'examples', id)
  await syncPreviewProject(exampleDirectory, { outputDirectory: path.join(templatesDirectory, id), urlPrefix: `templates/${id}/`, simulation })
  const manifest = JSON.parse(await readFile(path.join(exampleDirectory, 'manifest.json'), 'utf8')) as { name: string }
  index.push({ id, name: manifest.name })
}
await writeFile(path.join(templatesDirectory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
await syncPreviewProject(path.join(repositoryRoot, 'examples', DEFAULT_TEMPLATE), { simulation })
console.log(`Synced ${index.length} studio templates (default: ${DEFAULT_TEMPLATE})`)
