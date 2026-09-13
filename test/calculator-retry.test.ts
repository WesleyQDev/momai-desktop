import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    shouldRefocusWindow: (hwnd: unknown, err: unknown) => boolean
    normalizeCalculatorSteps: (steps: unknown) => Array<Record<string, unknown>>
  }
}

const { shouldRefocusWindow, normalizeCalculatorSteps } = runtime.__internals

describe('calculator retry without manual steps', () => {
  it('treats backgroundoccluded with or without underscore as stolen focus', () => {
    expect(shouldRefocusWindow('123', 'Element "X" could not be acted on (background_occluded: covered)')).toBe(true)
    expect(shouldRefocusWindow('123', 'Element "X" could not be acted on (backgroundoccluded: covered)')).toBe(true)
  })

  it('turns digit type steps addressed at the window into one key burst', () => {
    const out = normalizeCalculatorSteps([
      { op: 'launch', query: 'Calculadora' },
      { op: 'type', name: 'Calculadora', text: '10' },
      { op: 'type', name: 'Calculadora', text: '*' },
      { op: 'type', name: 'Calculadora', text: '4' },
      { op: 'press', key: '{ENTER}' },
      { op: 'close' },
    ])
    expect(out).toHaveLength(3)
    expect(out[1]).toEqual({ op: 'press', key: '10*4{ENTER}' })
  })
})
