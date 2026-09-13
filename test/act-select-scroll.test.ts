import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    buildScrollKeys: (direction: unknown, amount: unknown) => string
    normalizeSelectScrollSteps: (steps: unknown) => Array<Record<string, unknown>>
  }
}

const { buildScrollKeys, normalizeSelectScrollSteps } = runtime.__internals

describe('buildScrollKeys', () => {
  it('maps directions to SendKeys navigation keys', () => {
    expect(buildScrollKeys('down', 1)).toBe('{PGDN}')
    expect(buildScrollKeys('up', 1)).toBe('{PGUP}')
    expect(buildScrollKeys('top', 5)).toBe('{HOME}')
    expect(buildScrollKeys('bottom', 5)).toBe('{END}')
  })

  it('repeats page keys with SendKeys repeat syntax and caps at 10', () => {
    expect(buildScrollKeys('down', 3)).toBe('{PGDN 3}')
    expect(buildScrollKeys('up', 99)).toBe('{PGUP 10}')
  })

  it('defaults to one page down on anything unusable', () => {
    expect(buildScrollKeys(undefined, undefined)).toBe('{PGDN}')
    expect(buildScrollKeys('sideways', -2)).toBe('{PGDN}')
  })
})

describe('normalizeSelectScrollSteps', () => {
  it('turns scroll into a targeted press step', () => {
    const out = normalizeSelectScrollSteps([
      { op: 'scroll', name: 'Lista', direction: 'down', amount: 2 },
    ])
    expect(out).toEqual([{ op: 'press', name: 'Lista', key: '{PGDN 2}' }])
  })

  it('expands select into open-dropdown plus pick-option clicks', () => {
    const out = normalizeSelectScrollSteps([
      { op: 'select', name: 'Idioma', role: 'ComboBox', option: 'Português' },
    ])
    expect(out).toEqual([
      { op: 'click', name: 'Idioma', role: 'ComboBox' },
      { op: 'click', name: 'Português' },
    ])
  })

  it('leaves malformed select steps alone so the loop skips them loudly', () => {
    const out = normalizeSelectScrollSteps([{ op: 'select', name: 'Idioma' }])
    expect(out).toEqual([{ op: 'select', name: 'Idioma' }])
  })

  it('passes every other step through untouched', () => {
    const steps = [
      { op: 'launch', query: 'Notepad' },
      { op: 'click', name: 'Salvar' },
      { op: 'wait', ms: 500 },
    ]
    expect(normalizeSelectScrollSteps(steps)).toEqual(steps)
  })
})
