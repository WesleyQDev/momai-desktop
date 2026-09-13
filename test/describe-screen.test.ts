import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const provider = require('../uia/provider.ts') as {
  __internals: {
    pickDisplayShot: (shots: Array<{ display: number; name: string }>, screen: unknown) => { display: number; name: string } | null
  }
}

const { pickDisplayShot } = provider.__internals

const shots = [
  { display: 0, name: 'Tela 1' },
  { display: 1, name: 'Tela 2' },
]

describe('pickDisplayShot', () => {
  it('returns the requested display by index', () => {
    expect(pickDisplayShot(shots, 1)).toEqual({ display: 1, name: 'Tela 2' })
    expect(pickDisplayShot(shots, '0')).toEqual({ display: 0, name: 'Tela 1' })
  })

  it('returns null for anything unusable so the caller falls back to primary', () => {
    expect(pickDisplayShot(shots, undefined)).toBeNull()
    expect(pickDisplayShot(shots, null)).toBeNull()
    expect(pickDisplayShot(shots, '')).toBeNull()
    expect(pickDisplayShot(shots, -1)).toBeNull()
    expect(pickDisplayShot(shots, 7)).toBeNull()
    expect(pickDisplayShot(shots, 'abc')).toBeNull()
    expect(pickDisplayShot([], 0)).toBeNull()
  })
})
