import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runs = require('../desktop/runs.ts') as {
  saveSettings: (momai: unknown, patch: Record<string, unknown>) => Promise<Record<string, unknown>>
}

const fakeMomai = { storage: { get: async () => null, set: async () => {} } }

describe('saveSettings boolean coercion', () => {
  it('accepts stringified booleans like hosts send', async () => {
    const out = await runs.saveSettings(fakeMomai, {
      recordVisuals: 'False',
      safeStop: 'True',
      backgroundOnly: 'True',
      askBeforeForeground: 'False',
    })
    expect(out.recordVisuals).toBe(false)
    expect(out.safeStop).toBe(true)
    expect(out.backgroundOnly).toBe(true)
    expect(out.askBeforeForeground).toBe(false)
  })

  it('keeps real booleans working', async () => {
    const out = await runs.saveSettings(fakeMomai, {
      recordVisuals: true,
      safeStop: false,
      backgroundOnly: false,
      askBeforeForeground: true,
    })
    expect(out.recordVisuals).toBe(true)
    expect(out.safeStop).toBe(false)
    expect(out.backgroundOnly).toBe(false)
    expect(out.askBeforeForeground).toBe(true)
  })
})
