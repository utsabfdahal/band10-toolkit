import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, validateProject } from '../builder/validate.ts'

describe('legibility checks', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 0)
    expect(contrastRatio([0, 0, 0], [0, 0, 0])).toBe(1)
  })

  it('flags tiny digit sprites and passes large ones', async () => {
    const small = await validateProject(path.resolve('examples/backend-json'))
    expect(small.issues.some((entry) => entry.code === 'LEGIBILITY_SMALL_TEXT')).toBe(true)
    const large = await validateProject(path.resolve('examples/glass-lock'))
    expect(large.issues.some((entry) => entry.code.startsWith('LEGIBILITY'))).toBe(false)
  })
})
