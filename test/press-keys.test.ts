import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    normalizePressKey: (key: unknown) => string
  }
}

const { normalizePressKey } = runtime.__internals

describe('normalizePressKey', () => {
  it('maps natural key names to SendKeys tokens', () => {
    expect(normalizePressKey('Tab')).toBe('{TAB}')
    expect(normalizePressKey('tab')).toBe('{TAB}')
    expect(normalizePressKey('Enter')).toBe('{ENTER}')
    expect(normalizePressKey('Esc')).toBe('{ESC}')
    expect(normalizePressKey('Escape')).toBe('{ESC}')
    expect(normalizePressKey('Up')).toBe('{UP}')
    expect(normalizePressKey('Down')).toBe('{DOWN}')
    expect(normalizePressKey('Left')).toBe('{LEFT}')
    expect(normalizePressKey('Right')).toBe('{RIGHT}')
    expect(normalizePressKey('Home')).toBe('{HOME}')
    expect(normalizePressKey('End')).toBe('{END}')
    expect(normalizePressKey('Delete')).toBe('{DELETE}')
    expect(normalizePressKey('Backspace')).toBe('{BACKSPACE}')
    expect(normalizePressKey('F5')).toBe('{F5}')
    expect(normalizePressKey('F12')).toBe('{F12}')
  })

  it('translates modifier combos', () => {
    expect(normalizePressKey('Ctrl+Home')).toBe('^{HOME}')
    expect(normalizePressKey('Ctrl+C')).toBe('^C')
    expect(normalizePressKey('Control+c')).toBe('^c')
    expect(normalizePressKey('Alt+F4')).toBe('%{F4}')
    expect(normalizePressKey('Shift+Tab')).toBe('+{TAB}')
    expect(normalizePressKey('Ctrl+Shift+T')).toBe('+^T')
  })

  it('passes SendKeys-shaped input through untouched', () => {
    expect(normalizePressKey('{TAB}')).toBe('{TAB}')
    expect(normalizePressKey('{ENTER}')).toBe('{ENTER}')
    expect(normalizePressKey('{PGDN 3}')).toBe('{PGDN 3}')
    expect(normalizePressKey('%{F4}')).toBe('%{F4}')
    expect(normalizePressKey('^c')).toBe('^c')
    expect(normalizePressKey('10*5{ENTER}')).toBe('10*5{ENTER}')
  })

  it('keeps literal text and edge cases as-is', () => {
    expect(normalizePressKey('hello')).toBe('hello')
    expect(normalizePressKey('10')).toBe('10')
    expect(normalizePressKey('')).toBe('')
    expect(normalizePressKey('a')).toBe('a')
  })
})
