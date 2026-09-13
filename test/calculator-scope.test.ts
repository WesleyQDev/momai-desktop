import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    isCalculatorAppName: (app: unknown) => boolean
    stepsTargetCalculator: (steps: unknown, boundApp?: unknown) => boolean
    normalizeCalculatorSteps: (steps: unknown, opts?: { appName?: unknown; enabled?: unknown }) => Array<Record<string, unknown>>
  }
}

const { isCalculatorAppName, stepsTargetCalculator, normalizeCalculatorSteps } = runtime.__internals

describe('isCalculatorAppName', () => {
  it('matches calculator apps in Portuguese and English', () => {
    expect(isCalculatorAppName('Calculadora')).toBe(true)
    expect(isCalculatorAppName('Calculator')).toBe(true)
  })

  it('rejects other apps and empty values', () => {
    expect(isCalculatorAppName('Microsoft Excel')).toBe(false)
    expect(isCalculatorAppName('')).toBe(false)
    expect(isCalculatorAppName(null)).toBe(false)
  })
})

describe('stepsTargetCalculator', () => {
  it('enables when any launch step targets the calculator', () => {
    expect(stepsTargetCalculator([{ op: 'launch', query: 'calculadora' }], '')).toBe(true)
    expect(stepsTargetCalculator([{ op: 'launch', query: 'Calculator' }], 'Excel')).toBe(true)
  })

  it('disables when launches target other programs', () => {
    expect(stepsTargetCalculator([{ op: 'launch', query: 'Excel' }], 'Calculadora')).toBe(false)
  })

  it('falls back to the bound app only when no launch step exists', () => {
    expect(stepsTargetCalculator([{ op: 'press', key: '1' }], 'Calculadora')).toBe(true)
    expect(stepsTargetCalculator([{ op: 'press', key: '1' }], 'Excel')).toBe(false)
    expect(stepsTargetCalculator([{ op: 'press', key: '1' }], '')).toBe(false)
  })
})

describe('normalizeCalculatorSteps scoping', () => {
  it('keeps numeric typing targeted outside calculator tasks', () => {
    const out = normalizeCalculatorSteps([
      { op: 'launch', query: 'Excel' },
      { op: 'type', name: 'A1', role: 'Cell', text: '10' },
    ])
    expect(out[1]).toMatchObject({ op: 'type', text: '10' })
  })

  it('still converts digit typing for calculator continuations without launch', () => {
    const out = normalizeCalculatorSteps(
      [{ op: 'type', name: 'Display', text: '10' }],
      { appName: 'Calculadora' }
    )
    expect(out).toEqual([{ op: 'press', key: '10' }])
  })

  it('honors an explicit enabled flag over detection', () => {
    const off = normalizeCalculatorSteps(
      [{ op: 'launch', query: 'calculadora' }, { op: 'type', name: 'X', text: '10' }],
      { enabled: false }
    )
    expect(off[1]).toMatchObject({ op: 'type', text: '10' })
  })
  it('converts button clicks on calculator digits and operators into a merged press burst', () => {
    const out = normalizeCalculatorSteps([
      { op: 'launch', query: 'calculadora' },
      { op: 'click', name: 'Um' },
      { op: 'click', name: 'Zero' },
      { op: 'click', name: 'Multiplicar por' },
      { op: 'click', name: 'Cinco' },
      { op: 'click', name: 'Igual a' },
      { op: 'close' },
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ op: 'launch', query: 'calculadora' })
    expect(out[1]).toEqual({ op: 'press', key: '10*5=' })
    expect(out[2]).toEqual({ op: 'close' })
  })
})
