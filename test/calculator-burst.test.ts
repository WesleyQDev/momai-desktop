import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    collapseCalculatorPressSteps: (steps: unknown) => Array<{ op: string; key?: string }>
  }
}

const { collapseCalculatorPressSteps } = runtime.__internals

describe('collapseCalculatorPressSteps', () => {
  it('merges consecutive calculator presses into one key burst', () => {
    const out = collapseCalculatorPressSteps([
      { op: 'launch', query: 'calculadora' },
      { op: 'press', key: '1' },
      { op: 'press', key: '0' },
      { op: 'press', key: '*' },
      { op: 'press', key: '5' },
      { op: 'press', key: '{ENTER}' },
      { op: 'close' },
    ])
    expect(out).toHaveLength(3)
    expect(out[1]).toEqual({ op: 'press', key: '10*5{ENTER}' })
  })

  it('keeps targeted presses and other ops untouched', () => {
    const out = collapseCalculatorPressSteps([
      { op: 'press', key: '1', name: 'Um' },
      { op: 'press', key: '2' },
      { op: 'click', name: 'Fechar' },
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ op: 'press', key: '1', name: 'Um' })
  })
})
