import { createRequire } from 'node:module'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureText, textPath } from '../builder/text.ts'

const require = createRequire(import.meta.url)
const NepaliDate = (require('nepali-date-converter') as {
  default: new (date: Date) => { format: (format: string, language?: 'np' | 'en') => string }
}).default

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetRoot = path.join(repositoryRoot, 'examples', 'glass-lock', 'assets')

const WHITE = '#ffffff'
const SOFT = '#dce4f5'

function document(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`
}

async function write(relative: string, width: number, height: number, body: string): Promise<void> {
  const output = path.join(assetRoot, relative)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, document(width, height, body))
}

function text(value: string, x: number, y: number, size: number, weight: number, color: string, anchor: 'start' | 'middle' | 'end' = 'middle'): string {
  return textPath(value, x, y, { size, weight, fill: color, anchor, tabularNumbers: true })
}

async function generateDigitSet(directory: string, width: number, height: number, baseline: number, size: number, weight: number, color: string): Promise<void> {
  const glyphs: Record<string, string> = Object.fromEntries([...'0123456789'].map((digit) => [digit, digit]))
  glyphs.minus = '−'
  const widest = Math.max(...Object.values(glyphs).map((glyph) => measureText(glyph, { size, weight, fill: color, tabularNumbers: true })))
  const fitted = widest > width ? (size * width) / widest : size
  await Promise.all(Object.entries(glyphs).map(([name, glyph]) => write(
    `${directory}/${name}.svg`,
    width,
    height,
    text(glyph, width / 2, baseline, fitted, weight, color),
  )))
}

function wave(id: string, top: string, bottom: string, d: string): { gradient: string, path: string } {
  return {
    gradient: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
    path: `<path d="${d}" fill="url(#${id})"/>`,
  }
}

// Layered flowing bands in the style of stock iOS wave wallpapers.
async function generateWallpaper(): Promise<void> {
  const bands = [
    wave('w1', '#13295e', '#0b1a44', 'M0 340 C60 310 120 380 212 330 V520 H0Z'),
    wave('w2', '#1a3c86', '#10276a', 'M0 385 C70 350 140 430 212 380 V520 H0Z'),
    wave('w3', '#22509f', '#173582', 'M0 430 C80 405 130 470 212 435 V520 H0Z'),
    wave('w4', '#2f68c4', '#1f479e', 'M0 475 C60 460 150 505 212 478 V520 H0Z'),
  ]
  await write('wallpaper/waves.svg', 212, 520, `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#050a1c"/>
        <stop offset=".5" stop-color="#0a1638"/>
        <stop offset="1" stop-color="#0d1d4a"/>
      </linearGradient>
      ${bands.map((band) => band.gradient).join('')}
    </defs>
    <rect width="212" height="520" fill="url(#sky)"/>
    ${bands.map((band) => band.path).join('')}`)
}

async function generateChrome(): Promise<void> {
  await Promise.all([
    write('icons/bolt.svg', 14, 20, `<g transform="translate(0 2) scale(1.4)"><path d="M6 0 0 7h4l-1 5 7-7.5H6z" fill="${WHITE}"/></g>`),
    write('icons/steps.svg', 20, 20, `<g transform="translate(1 1) scale(1.5)" fill="${WHITE}"><ellipse cx="3.5" cy="4" rx="2.3" ry="3.4"/><ellipse cx="8.5" cy="7" rx="2.3" ry="3.4"/></g>`),
    write('icons/heart.svg', 20, 20, `<g transform="translate(1 2) scale(1.5)"><path d="M6 10.5S0 7 0 3.2A3 3 0 0 1 6 2a3 3 0 0 1 6 1.2C12 7 6 10.5 6 10.5z" fill="#ff5a5f"/></g>`),
    write('units/percent.svg', 14, 24, text('%', 7, 21, 18, 600, SOFT)),
    write('units/degree.svg', 9, 24, text('°', 4, 20, 24, 600, SOFT)),
  ])
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

async function generateDate(): Promise<void> {
  await Promise.all([
    ...WEEKDAYS.map((name, index) => write(`date/weekday-${index}.svg`, 118, 30, text(`${name},`, 118, 22, 21, 600, SOFT, 'end'))),
    ...MONTHS.map((name, index) => write(`date/month-${index + 1}.svg`, 46, 30, text(name, 0, 22, 21, 600, SOFT, 'start'))),
  ])
}

function currentMonthAnchor(): { year: number, month: number } {
  const override = process.env.GLASS_AD_MONTH
  if (override) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(override)
    if (!match) throw new Error('GLASS_AD_MONTH must use YYYY-MM, for example 2026-11')
    return { year: Number(match[1]), month: Number(match[2]) - 1 }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

// The band has no BS calendar source, so each AD day of the target month maps to a pre-rendered BS line.
async function generateNepaliDates(): Promise<void> {
  const { year, month } = currentMonthAnchor()
  await rm(path.join(assetRoot, 'nepali'), { recursive: true, force: true })
  await Promise.all(Array.from({ length: 31 }, (_, index) => {
    const adDate = new Date(Date.UTC(year, month, index + 1, 12))
    const body = text(new NepaliDate(adDate).format('D MMMM', 'np'), 106, 46, 44, 700, WHITE, 'middle')
    return write(`nepali/day-${String(index + 1).padStart(2, '0')}.svg`, 212, 60, body)
  }))
  console.log(`Nepali date lookup generated for ${year}-${String(month + 1).padStart(2, '0')}`)
}

const CLOUD = 'M8 21a5 5 0 0 1 0-10 7 7 0 0 1 13 2 4 4 0 0 1 0 8z'
const WEATHER: Record<string, string> = {
  clear: `<g stroke="${WHITE}" stroke-width="2" stroke-linecap="round">${Array.from({ length: 8 }, (_, index) => {
    const angle = (index * Math.PI) / 4
    return `<line x1="${14 + Math.cos(angle) * 9}" y1="${14 + Math.sin(angle) * 9}" x2="${14 + Math.cos(angle) * 12}" y2="${14 + Math.sin(angle) * 12}"/>`
  }).join('')}</g><circle cx="14" cy="14" r="6" fill="${WHITE}"/>`,
  cloudy: `<path d="${CLOUD}" fill="${WHITE}"/>`,
  rain: `<path d="M8 17a5 5 0 0 1 0-10 7 7 0 0 1 13 2 4 4 0 0 1 0 8z" fill="${WHITE}"/><g stroke="${WHITE}" stroke-width="2" stroke-linecap="round"><line x1="9" y1="20" x2="8" y2="25"/><line x1="14" y1="20" x2="13" y2="25"/><line x1="19" y1="20" x2="18" y2="25"/></g>`,
  snow: `<path d="M8 17a5 5 0 0 1 0-10 7 7 0 0 1 13 2 4 4 0 0 1 0 8z" fill="${WHITE}"/><g fill="${WHITE}"><circle cx="9" cy="22" r="1.5"/><circle cx="14" cy="24" r="1.5"/><circle cx="19" cy="22" r="1.5"/></g>`,
  fog: `<g stroke="${WHITE}" stroke-width="2.4" stroke-linecap="round"><line x1="4" y1="9" x2="24" y2="9"/><line x1="6" y1="14" x2="22" y2="14"/><line x1="4" y1="19" x2="24" y2="19"/></g>`,
  unknown: text('?', 14, 22, 22, 700, WHITE),
}

async function generateWeather(): Promise<void> {
  await Promise.all(Object.entries(WEATHER).map(([name, icon]) => write(
    `weather/${name}.svg`,
    24,
    24,
    `<g transform="scale(${24 / 28})">${icon}</g>`,
  )))
}

for (const stale of ['wallpaper', 'glass', 'icons', 'ring', 'card', 'units', 'weather', 'time', 'digits-medium', 'digits-small', 'digits-date']) {
  await rm(path.join(assetRoot, stale), { recursive: true, force: true })
}

await Promise.all([
  generateDigitSet('digits-time', 88, 122, 118, 156, 700, WHITE),
  generateDigitSet('digits-aod', 88, 122, 118, 156, 700, '#8e8e96'),
  generateDigitSet('digits-stat', 14, 26, 23, 25, 700, WHITE),
  generateDigitSet('digits-date', 13, 30, 22, 21, 600, SOFT),
  generateWallpaper(),
  generateChrome(),
  generateDate(),
  generateNepaliDates(),
  generateWeather(),
])

console.log(`Generated Glass Lock assets in ${assetRoot}`)
