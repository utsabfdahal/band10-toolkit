#!/usr/bin/env node
import { readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Command, Option } from 'commander'
import { buildProject, packageProject, prepareWallpaper, syncPreviewProject, unpackWatchFace, validateProject } from '../builder/index.ts'
import { inspectWatchFace } from '../parser/index.ts'
import type { CompilerTarget, ValidationIssue } from '../core/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const program = new Command()

function run(command: string, args: string[], cwd = root): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code ?? 'unknown'}`)))
  })
}

function icon(issue: ValidationIssue): string {
  if (issue.severity === 'error') return '✖'
  if (issue.severity === 'warning') return '▲'
  return '●'
}

function printIssues(issues: ValidationIssue[]): void {
  if (issues.length === 0) {
    console.log('✓ No validation issues')
    return
  }
  for (const issue of issues) {
    console.log(`${icon(issue)} ${issue.severity.toUpperCase()} ${issue.code}${issue.path ? ` (${issue.path})` : ''}`)
    console.log(`  ${issue.message}`)
    if (issue.hint) console.log(`  Hint: ${issue.hint}`)
  }
}

program
  .name('band10')
  .description('Source-first Xiaomi Smart Band 10 watch-face toolkit')
  .version('0.1.0')

program.command('validate')
  .description('Validate manifest, layout, assets, coordinates, and device constraints')
  .argument('[project]', 'project directory', '.')
  .option('--json', 'emit machine-readable JSON')
  .action(async (project: string, options: { json?: boolean }) => {
    const report = await validateProject(project)
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else {
      printIssues(report.issues)
      console.log(`${report.stats.widgets} widgets · ${report.stats.assets} assets${report.stats.estimatedBytes ? ` · ${(report.stats.estimatedBytes / 1024).toFixed(0)} KiB raw estimate` : ''}`)
    }
    if (!report.valid) process.exitCode = 1
  })

program.command('assets')
  .description('Normalize source assets to deterministic Band 10 PNG resources')
  .argument('[project]', 'project directory', '.')
  .action(async (project: string) => {
    const result = await buildProject(project)
    console.log(`✓ Normalized ${result.report.stats.assets} assets`)
    console.log(`  ${path.join(result.buildDirectory, 'assets-normal')}`)
    if (result.project.layout.aod?.enabled) console.log(`  ${path.join(result.buildDirectory, 'assets-aod')}`)
  })

program.command('build')
  .description('Validate and emit preview, FPRJ, and GMF intermediates')
  .argument('[project]', 'project directory', '.')
  .action(async (project: string) => {
    const result = await buildProject(project)
    printIssues(result.report.issues)
    console.log('✓ Build complete')
    console.log(`  Preview: ${result.previewPath}`)
    console.log(`  FPRJ:    ${result.fprjPath}`)
    console.log(`  GMF:     ${result.gmfPath}`)
  })

program.command('package')
  .description('Build and package an installable .face/.bin binary')
  .argument('[project]', 'project directory', '.')
  .addOption(new Option('--target <target>', 'compiler backend').choices(['native', 'mi-create', 'mi8-tool']))
  .option('--compiler <path>', 'path to user-supplied compile.exe')
  .option('--java-tool <path>', 'path to user-supplied Mi8WfBinTool.java/.jar')
  .action(async (project: string, options: { target?: CompilerTarget; compiler?: string; javaTool?: string }) => {
    const result = await packageProject(project, {
      target: options.target,
      compilerPath: options.compiler,
      javaToolPath: options.javaTool,
    })
    printIssues(result.report.issues)
    console.log(`✓ Packaged with ${result.target} (${(result.bytes / 1024).toFixed(1)} KiB)`)
    console.log(`  ${result.facePath}`)
    console.log(`  ${result.binPath}`)
    if (result.target === 'native') console.log('  Native o66 packing is structurally round-tripped but still requires physical Band 10 verification.')
  })

program.command('inspect')
  .description('Inspect a .face/.bin header, sections, resources, and widget bindings')
  .argument('<file>', 'watch-face binary')
  .option('--json', 'emit machine-readable JSON')
  .action(async (file: string, options: { json?: boolean }) => {
    const inspection = inspectWatchFace(new Uint8Array(await readFile(path.resolve(file))))
    if (options.json) {
      console.log(JSON.stringify(inspection, null, 2))
      return
    }
    const header = inspection.header
    console.log(`${header.name || '(unnamed)'} · ID ${header.id || '(none)'}`)
    console.log(`Magic ${header.magic} · ${(header.fileSize / 1024).toFixed(1)} KiB · ${header.faceCount} face record(s) · ${header.namedFaces ? 'named-style' : 'legacy layout'}`)
    for (const face of inspection.faces) {
      console.log(`Face ${face.header.index}: ${face.elements.length} elements, ${face.definitions.length} definitions${face.header.name ? `, “${face.header.name}”` : ''}`)
      for (const element of face.elements) {
        const binding = element.dataSourceName ? ` ← ${element.dataSourceName} (${element.dataSource})` : ''
        console.log(`  [${element.index}] ${element.kind} @ ${element.x},${element.y}${binding}`)
      }
    }
    for (const warning of inspection.warnings) console.log(`▲ ${warning}`)
  })

program.command('unpack')
  .description('Decompile a .face/.bin into an editable project (layout.json, manifest.json, PNG assets)')
  .argument('<file>', 'watch-face binary')
  .argument('<directory>', 'output project directory')
  .action(async (file: string, directory: string) => {
    const result = await unpackWatchFace(path.resolve(file), directory)
    console.log(`✓ Unpacked ${result.widgets} widgets and ${result.images} images to ${result.directory}`)
    for (const warning of result.warnings) console.log(`▲ ${warning}`)
    console.log(`Next: band10 validate ${directory} && band10 preview ${directory}`)
  })

program.command('wallpaper')
  .description('Turn a photo into a 212×520 indexed-PNG wallpaper sized for Band 10')
  .argument('<image>', 'source photo (JPEG, PNG, HEIF, WebP…)')
  .argument('[output]', 'output PNG path', 'wallpaper.png')
  .option('--dim <amount>', 'darken 0–1 so white text stays readable', '0.35')
  .option('--colors <count>', 'palette size 2–256', '128')
  .option('--position <gravity>', 'crop focus: attention, entropy, centre, north, south…', 'attention')
  .action(async (image: string, output: string, options: { dim: string; colors: string; position: string }) => {
    const result = await prepareWallpaper(path.resolve(image), output, { dim: Number(options.dim), colors: Number(options.colors), position: options.position })
    console.log(`✓ Wallpaper ${result.width}×${result.height} · ${(result.bytes / 1024).toFixed(1)} KiB → ${result.outputPath}`)
    console.log('Add it as the first image widget (x 0, y 0, z 0, allowOverlap true) in layout.json.')
  })

program.command('clean')
  .description('Remove generated build and dist directories')
  .argument('[project]', 'project directory', '.')
  .action(async (project: string) => {
    const directory = path.resolve(project)
    await Promise.all([
      rm(path.join(directory, 'build'), { recursive: true, force: true }),
      rm(path.join(directory, 'dist'), { recursive: true, force: true }),
    ])
    console.log(`✓ Cleaned ${directory}`)
  })

program.command('preview')
  .description('Start the React live editor for a project')
  .argument('[project]', 'project directory', '.')
  .option('--host <host>', 'host to bind', '127.0.0.1')
  .option('--port <port>', 'port to bind', '5173')
  .action(async (project: string, options: { host: string; port: string }) => {
    const synchronized = await syncPreviewProject(project)
    console.log(`✓ Synced preview project to ${synchronized}`)
    await run('npm', ['--prefix', 'preview', 'run', 'dev', '--', '--host', options.host, '--port', options.port])
  })

program.command('install')
  .description('Stage a verified binary on Android and optionally open Gadgetbridge’s confirmation UI')
  .argument('<file>', 'watch-face .face or .bin')
  .option('--serial <serial>', 'ADB device serial')
  .option('--launch-gadgetbridge', 'open Gadgetbridge FileInstallerActivity after staging')
  .action(async (file: string, options: { serial?: string; launchGadgetbridge?: boolean }) => {
    const absolute = path.resolve(file)
    const fileStat = await stat(absolute)
    if (!fileStat.isFile()) throw new Error(`${absolute} is not a file`)
    const inspection = inspectWatchFace(new Uint8Array(await readFile(absolute)))
    const destination = `/sdcard/Download/${path.basename(absolute).replace(/\.face$/i, '.bin')}`
    const adb = options.serial ? ['-s', options.serial] : []
    await run('adb', [...adb, 'push', absolute, destination])
    console.log(`✓ Staged ${inspection.header.name || path.basename(file)} at ${destination}`)
    if (options.launchGadgetbridge) {
      await run('adb', [...adb, 'shell', 'am', 'start',
        '-a', 'android.intent.action.VIEW',
        '-d', `file://${destination}`,
        '-t', 'application/octet-stream',
        '-n', 'nodomain.freeyourgadget.gadgetbridge/.activities.install.FileInstallerActivity',
      ])
      console.log('Gadgetbridge opened. Review the target/model warning and tap Install manually.')
    } else {
      console.log('Open the staged .bin in Android Files and choose Gadgetbridge FW/App Installer or Notify for Xiaomi.')
    }
  })

program.parseAsync().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})