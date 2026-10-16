import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const provider = require('../uia/provider.ts') as {
  __internals: {
    resolveDisplayEntry: (
      displays: Array<{ id: string; name: string }>,
      screen: unknown
    ) => { index: number; entry: { id: string; name: string }; fallback: boolean } | null
    pickDisplayIndexByPoint: (
      displays: Array<{ left: number; top: number; right: number; bottom: number }>,
      point: { x: number; y: number }
    ) => number
  }
}

const { resolveDisplayEntry, pickDisplayIndexByPoint } = provider.__internals

const displays = [
  { id: '\\\\.\\DISPLAY1', name: '\\\\.\\DISPLAY1' },
  { id: '\\\\.\\DISPLAY2', name: '\\\\.\\DISPLAY2' }
]

describe('resolveDisplayEntry', () => {
  it('returns the requested display by index', () => {
    expect(resolveDisplayEntry(displays, 1)).toEqual({
      index: 1,
      entry: displays[1],
      fallback: false
    })
    expect(resolveDisplayEntry(displays, '0')).toEqual({
      index: 0,
      entry: displays[0],
      fallback: false
    })
  })

  it('falls back to the first display when the index is omitted', () => {
    for (const empty of [undefined, null, '']) {
      expect(resolveDisplayEntry(displays, empty as unknown)).toEqual({
        index: 0,
        entry: displays[0],
        fallback: true
      })
    }
  })

  it('returns null for an out-of-range index so the caller can refuse it', () => {
    expect(resolveDisplayEntry(displays, -1)).toBeNull()
    expect(resolveDisplayEntry(displays, 7)).toBeNull()
    expect(resolveDisplayEntry(displays, 'abc')).toBeNull()
    expect(resolveDisplayEntry([], 0)).toBeNull()
  })
})

describe('pickDisplayIndexByPoint (screen in use)', () => {
  // Real layout measured on a two-monitor Windows setup: secondary to the left.
  const layout = [
    { left: 0, top: 0, right: 1920, bottom: 1080 },
    { left: -1920, top: 1, right: 0, bottom: 1081 }
  ]

  it('finds the display containing the foreground window center', () => {
    expect(pickDisplayIndexByPoint(layout, { x: 960, y: 540 })).toBe(0)
    expect(pickDisplayIndexByPoint(layout, { x: -960, y: 540 })).toBe(1)
  })

  it('handles edges and misses like the provider tolerates', () => {
    expect(pickDisplayIndexByPoint(layout, { x: 0, y: 0 })).toBe(0)
    expect(pickDisplayIndexByPoint(layout, { x: 1920, y: 0 })).toBe(-1)
    expect(pickDisplayIndexByPoint(layout, { x: 5000, y: 5000 })).toBe(-1)
    expect(pickDisplayIndexByPoint([], { x: 0, y: 0 })).toBe(-1)
    expect(pickDisplayIndexByPoint(layout, { x: NaN, y: 10 })).toBe(-1)
  })

  it('ignores displays without usable bounds', () => {
    const partial = [{ id: 'a' }, { left: 0, top: 0, right: 100, bottom: 100 }]
    expect(pickDisplayIndexByPoint(partial as any, { x: 50, y: 50 })).toBe(1)
  })
})
