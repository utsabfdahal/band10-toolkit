import { describe, expect, it } from 'vitest'
import { measureText, textPath } from '../builder/text.ts'

describe('bundled-font text outlines', () => {
  it('renders Latin text as paths without relying on system fonts', () => {
    const svg = textPath('10:08', 0, 50, { size: 40, weight: 700, fill: '#fff' })
    expect(svg).toContain('<path')
    expect(svg).not.toContain('<text')
  })

  it('shapes Devanagari conjuncts and reph into fewer glyphs than code points', () => {
    const value = 'कार्तिक'
    const glyphCount = (textPath(value, 0, 50, { size: 40, fill: '#fff' }).match(/<path/g) ?? []).length
    expect(glyphCount).toBeGreaterThan(0)
    expect(glyphCount).toBeLessThan([...value].length)
  })

  it('anchors text by its measured advance', () => {
    const options = { size: 30, fill: '#fff', tabularNumbers: true }
    const width = measureText('88', options)
    expect(width).toBeGreaterThan(30)
    const end = textPath('88', 100, 40, { ...options, anchor: 'end' })
    expect(end).toContain(`translate(${(100 - width).toFixed(3)}`)
  })
})
