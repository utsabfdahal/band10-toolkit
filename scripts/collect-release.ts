import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = path.join(repositoryRoot, 'release')
// Video-backed examples are excluded: their source frames are not redistributable.
const EXAMPLES = ['minimal-amoled', 'flux-core', 'circuit-link', 'rlc-singularity', 'backend-json', 'glass-lock']

await rm(releaseDirectory, { recursive: true, force: true })
await mkdir(releaseDirectory, { recursive: true })

const checksums: string[] = []
const rows: string[] = []
for (const example of EXAMPLES) {
  const exampleDirectory = path.join(repositoryRoot, 'examples', example)
  const manifest = JSON.parse(await readFile(path.join(exampleDirectory, 'manifest.json'), 'utf8')) as { name: string, output: string }
  const faces = (await readdir(path.join(exampleDirectory, 'dist'))).filter((name) => name === `${manifest.output}.face`)
  if (!faces.length) throw new Error(`No .face output for ${example}; run its package script first`)
  for (const face of faces) {
    await copyFile(path.join(exampleDirectory, 'dist', face), path.join(releaseDirectory, face))
    checksums.push(`${createHash('sha256').update(await readFile(path.join(releaseDirectory, face))).digest('hex')}  ${face}`)
    rows.push(`| ${manifest.name} | \`${face}\` |`)
  }
  await copyFile(path.join(exampleDirectory, 'build', 'preview.png'), path.join(releaseDirectory, `${manifest.output}-preview.png`))
}

await writeFile(path.join(releaseDirectory, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
await writeFile(path.join(releaseDirectory, 'NOTES.md'), [
  'Prebuilt Xiaomi Smart Band 10 watch faces. Install a `.face` with Notify for Xiaomi:',
  'https://github.com/utsabfdahal/band10-toolkit/blob/main/docs/installation.md#notify-for-xiaomi-route',
  '',
  '| Face | File |',
  '|---|---|',
  ...rows,
  '',
  'Nepali-date faces (Glass Lock, RLC Singularity, utsab.json) contain Bikram Sambat dates for the AD month this release was built in. A new release is published automatically on the 1st of every month.',
  '',
  'Unofficial and not affiliated with Xiaomi. Verify checksums with `shasum -a 256 -c SHA256SUMS`.',
  '',
].join('\n'))

console.log(`Collected ${checksums.length} faces in ${releaseDirectory}`)
