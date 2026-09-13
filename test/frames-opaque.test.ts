import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    computeFramesTruncation: (frameStepCount: unknown, slideCount: unknown) => boolean
    shouldFlagOpaqueScreen: (snapshot: unknown) => boolean
  }
}

const { computeFramesTruncation, shouldFlagOpaqueScreen } = runtime.__internals

describe('computeFramesTruncation', () => {
  it('flags replays that dropped frames past the cap', () => {
    expect(computeFramesTruncation(25, 20)).toBe(true)
    expect(computeFramesTruncation(6, 5)).toBe(true)
  })

  it('stays quiet when every frame step has its slide', () => {
    expect(computeFramesTruncation(20, 20)).toBe(false)
    expect(computeFramesTruncation(0, 0)).toBe(false)
    expect(computeFramesTruncation(3, 5)).toBe(false)
  })

  it('treats unusable counts as not truncated', () => {
    expect(computeFramesTruncation(undefined, 3)).toBe(false)
    expect(computeFramesTruncation(4, null)).toBe(false)
  })
})

describe('shouldFlagOpaqueScreen', () => {
  it('flags snapshots with only nameless containers', () => {
    expect(
      shouldFlagOpaqueScreen({ nodes: [{ ref: 1, control: 'Pane', name: '' }] })
    ).toBe(true)
  })

  it('does not flag actionable screens', () => {
    expect(
      shouldFlagOpaqueScreen({ nodes: [{ ref: 1, control: 'Button', name: 'Salvar' }] })
    ).toBe(false)
  })

  it('does not flag missing or empty snapshots', () => {
    expect(shouldFlagOpaqueScreen(null)).toBe(false)
    expect(shouldFlagOpaqueScreen({ nodes: [] })).toBe(false)
    expect(shouldFlagOpaqueScreen({})).toBe(false)
  })
})
