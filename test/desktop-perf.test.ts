import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    extractFirstWebUrl: (text: unknown) => string | null
    buildFindMissInstruction: (query: unknown, truncated: unknown) => string
    getScanCacheTtlMs: () => number
    opaqueScreenWarning: () => string
    buildActTerminalInstruction: (input: {
      aborted: unknown
      outcomesLength: unknown
      stepsLength: unknown
      lines: unknown
      finalText: unknown
    }) => string
    classifyLaunchScreen: (
      query: unknown,
      appName: unknown,
      windowTitle: unknown
    ) => string
    isWebAddressSubmit: (text: unknown, submit: unknown) => boolean
    getNavigationSettleMs: () => number
    t: (key: unknown, a?: unknown, b?: unknown) => string
  }
}

const {
  extractFirstWebUrl,
  buildFindMissInstruction,
  getScanCacheTtlMs,
  opaqueScreenWarning,
  buildActTerminalInstruction,
  classifyLaunchScreen,
  isWebAddressSubmit,
  getNavigationSettleMs,
  t,
} = runtime.__internals

describe('extractFirstWebUrl', () => {
  it('returns the first web address from a mixed request', () => {
    expect(
      extractFirstWebUrl('open the browser and go to https://example.com/app/#/ then press enter')
    ).toBe('https://example.com/app/#/')
  })

  it('completes bare addresses with https', () => {
    expect(extractFirstWebUrl('go to example.com/path now')).toBe('https://example.com/path')
  })

  it('returns null when no web address is present', () => {
    expect(extractFirstWebUrl('open the calculator and compute 10*5')).toBe(null)
    expect(extractFirstWebUrl('')).toBe(null)
    expect(extractFirstWebUrl(null)).toBe(null)
  })
})

describe('buildFindMissInstruction', () => {
  it('asks for one fresh snapshot instead of another find loop', () => {
    const instruction = buildFindMissInstruction('Sign in', false)
    expect(instruction).toContain('Sign in')
    expect(instruction).toMatch(/snapshot/i)
    expect(instruction).not.toMatch(/desktop_find/i)
  })

  it('caps any final update to two short sentences', () => {
    expect(buildFindMissInstruction('Sign in', false)).toMatch(/2 short sentences/i)
    expect(buildFindMissInstruction('Sign in', true)).toMatch(/2 short sentences/i)
  })
})

describe('getScanCacheTtlMs', () => {
  it('keeps the program index cached long enough to avoid rescans', () => {
    expect(getScanCacheTtlMs()).toBeGreaterThanOrEqual(600000)
  })
})

describe('opaqueScreenWarning', () => {
  it('rules out another snapshot and asks for a brief help request', () => {
    const warning = opaqueScreenWarning()
    expect(warning).toMatch(/do not take another snapshot/i)
    expect(warning).toMatch(/ask the user for help/i)
    expect(warning).toMatch(/2 short sentences/i)
  })

  it('offers one Tab focus wake-up before giving up', () => {
    const warning = opaqueScreenWarning()
    expect(warning).toMatch(/desktop_press/)
    expect(warning).toMatch(/\{TAB\}/)
    expect(warning).toMatch(/fresh desktop_snapshot/i)
  })
})

describe('buildActTerminalInstruction', () => {
  it('caps a stopped task update to two short sentences', () => {
    const instruction = buildActTerminalInstruction({
      aborted: true,
      outcomesLength: 1,
      stepsLength: 3,
      lines: 'click "Sign in": FAILED (not found)',
      finalText: 'App: unknown',
    })
    expect(instruction).toMatch(/2 short sentences/i)
  })
})

describe('classifyLaunchScreen', () => {
  it('matches the requested program by app or title', () => {
    expect(classifyLaunchScreen('Edge', 'Microsoft Edge', 'New tab')).toBe('matched')
  })

  it('flags a wrong foreground window as mismatch', () => {
    expect(classifyLaunchScreen('Edge', 'OpenCode', 'OpenCode')).toBe('mismatch')
  })

  it('treats empty query or unknown app as mismatch', () => {
    expect(classifyLaunchScreen('', 'Microsoft Edge', 'New tab')).toBe('mismatch')
    expect(classifyLaunchScreen('Edge', '', '')).toBe('mismatch')
  })
})

describe('isWebAddressSubmit', () => {
  it('detects a submitted web address', () => {
    expect(isWebAddressSubmit('https://example.com/app/#/', true)).toBe(true)
    expect(isWebAddressSubmit('example.com/path', true)).toBe(true)
  })

  it('ignores plain text, missing submit, and non-addresses', () => {
    expect(isWebAddressSubmit('example.com/path', false)).toBe(false)
    expect(isWebAddressSubmit('hello world', true)).toBe(false)
    expect(isWebAddressSubmit('calc', true)).toBe(false)
    expect(isWebAddressSubmit('', true)).toBe(false)
  })
})

describe('getNavigationSettleMs', () => {
  it('waits long enough for the page to start loading', () => {
    expect(getNavigationSettleMs()).toBeGreaterThanOrEqual(2000)
  })
})

describe('t', () => {
  it('resolves the stopped label instead of crashing the tool', () => {
    expect(() => t('stopped')).not.toThrow()
    expect(t('stopped').length).toBeGreaterThan(0)
  })

  it('keeps formatting labels working', () => {
    expect(t('launched', 'Edge')).toContain('Edge')
  })

  it('falls back to the key name for unknown labels', () => {
    expect(() => t('no_such_label_xyz')).not.toThrow()
    expect(t('no_such_label_xyz')).toContain('no_such_label_xyz')
  })
})
