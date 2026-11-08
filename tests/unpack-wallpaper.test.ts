import { cp, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { packageProject, prepareWallpaper, unpackWatchFace, validateProject } from '../builder/index.ts'

describe('unpack', () => {
  it('round-trips a packaged face into a valid editable project', async () => {
    // Work on a copy so parallel tests that build flux-core do not race on its build directory.
    const source = await mkdtemp(path.join(tmpdir(), 'band10-source-'))
    await cp(path.resolve('examples/flux-core'), source, { recursive: true, filter: (entry) => !/[\\/](build|dist)$/.test(entry) })
    const packaged = await packageProject(source)
    const directory = await mkdtemp(path.join(tmpdir(), 'band10-unpack-'))
    const result = await unpackWatchFace(packaged.facePath, directory)
    expect(result.widgets).toBe(packaged.project.layout.normal.widgets.length + (packaged.project.layout.aod?.widgets.length ?? 0))
    const layout = JSON.parse(await readFile(path.join(directory, 'layout.json'), 'utf8'))
    expect(layout.normal.widgets.some((widget: { type: string, source?: string }) => widget.type === 'number' && widget.source === 'hour')).toBe(true)
    const report = await validateProject(directory)
    expect(report.valid).toBe(true)
  }, 60_000)
})

describe('wallpaper', () => {
  it('crops any photo to the Band 10 screen as an indexed PNG', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'band10-wallpaper-'))
    const photo = path.join(directory, 'photo.png')
    await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a7bd5' } }).png().toFile(photo)
    const result = await prepareWallpaper(photo, path.join(directory, 'wallpaper.png'), { dim: 0.5, colors: 64 })
    expect([result.width, result.height]).toEqual([212, 520])
    const header = await readFile(result.outputPath)
    expect(header[25]).toBe(3)
    const { dominant } = await sharp(result.outputPath).stats()
    expect(dominant.b).toBeLessThan(0xd5)
  })
})
