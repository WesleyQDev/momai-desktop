import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    keyboardFallbackKey: (name: unknown) => string | null
    resolveRecordFrames: (settings: unknown, params: unknown) => boolean
    autoPressFallbackKey: (op: unknown, name: unknown) => string | null
  }
}
const nodes = require('../uia/nodes.ts') as {
  findNodes: (
    nodes: Array<{ ref: number; control: string; name: string; automationId?: string }>,
    query: string,
    role?: string
  ) => Array<{ ref: number; control: string; name: string }>
  assignRefs: (raw: unknown[]) => { nodes: Array<{ ref: number; control: string; name: string; automationId: string }> }
}

const { keyboardFallbackKey } = runtime.__internals

describe('calculator fast path without record', () => {
  it('maps localized digit names to press keys', () => {
    expect(keyboardFallbackKey('Cinco')).toBe('5')
    expect(keyboardFallbackKey('Five')).toBe('5')
  })

  it('maps localized operator names to press keys', () => {
    expect(keyboardFallbackKey('Multiplicar por')).toBe('*')
    expect(keyboardFallbackKey('Multiply by')).toBe('*')
  })

  it('escapes SendKeys modifier characters', () => {
    expect(keyboardFallbackKey('+')).toBe('{+}')
  })

  it('finds calculator buttons by digit alias', () => {
    const { nodes: list } = nodes.assignRefs([
      {
        control: 'Button',
        name: 'Cinco',
        automationId: 'num5Button',
        rect: { x: 10, y: 20, w: 80, h: 24 },
        enabled: true,
        offscreen: false,
        depth: 2,
        path: [],
        patterns: {},
      },
    ])
    expect(nodes.findNodes(list, '5')).toHaveLength(1)
  })

  it('resolves per-call record opt-out without changing defaults', () => {
    expect(runtime.__internals.resolveRecordFrames({ recordVisuals: true }, { record: false })).toBe(false)
    expect(runtime.__internals.resolveRecordFrames({ recordVisuals: true }, {})).toBe(true)
  })

  it('offers automatic press fallback for digit clicks', () => {
    expect(runtime.__internals.autoPressFallbackKey('click', '5')).toBe('5')
    expect(runtime.__internals.autoPressFallbackKey('click', 'Salvar')).toBeNull()
    expect(runtime.__internals.autoPressFallbackKey('type', '5')).toBeNull()
  })
})
