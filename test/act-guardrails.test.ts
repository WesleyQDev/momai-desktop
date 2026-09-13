import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    isInherentlyForegroundOp: (op: unknown) => boolean
    checkActAppAllowed: (settings: unknown, appName: unknown) => string | null
    buildForegroundRefusal: (op: unknown, label: unknown) => string
    shouldBlockForeground: (settings: unknown, consent: unknown) => boolean
    foregroundPayloadFlag: (settings: unknown, consent: unknown) => Record<string, unknown>
    isTrueFlag: (value: unknown) => boolean
    isFalseFlag: (value: unknown) => boolean
    shouldAutoRefocus: (input: unknown) => boolean
  }
}

const { isInherentlyForegroundOp, checkActAppAllowed, buildForegroundRefusal, shouldBlockForeground, foregroundPayloadFlag, isTrueFlag, isFalseFlag, shouldAutoRefocus } =
  runtime.__internals

describe('isInherentlyForegroundOp', () => {
  it('flags ops with no background alternative', () => {
    expect(isInherentlyForegroundOp('goto')).toBe(true)
    expect(isInherentlyForegroundOp('press')).toBe(true)
    expect(isInherentlyForegroundOp('winsearch')).toBe(true)
  })

  it('lets pattern-first ops attempt the background first', () => {
    for (const op of ['click', 'type', 'close', 'select', 'scroll', 'launch', 'wait']) {
      expect(isInherentlyForegroundOp(op)).toBe(false)
    }
  })
})

describe('checkActAppAllowed', () => {
  it('returns null when the app is allowed', () => {
    expect(checkActAppAllowed({ allowedApps: [] }, 'Anything')).toBeNull()
    expect(checkActAppAllowed({ allowedApps: ['chrome'] }, 'chrome')).toBeNull()
  })

  it('returns a refusal message when the app is not listed', () => {
    const msg = checkActAppAllowed({ allowedApps: ['notepad'] }, 'chrome')
    expect(typeof msg).toBe('string')
    expect(msg as string).toContain('chrome')
    expect(msg as string).toContain('allowed')
  })

  it('treats missing settings as allow-all (same as the snapshot gate)', () => {
    expect(checkActAppAllowed(null, 'chrome')).toBeNull()
  })
})

describe('buildForegroundRefusal', () => {
  it('tells the model how to proceed with consent', () => {
    const msg = buildForegroundRefusal('goto', 'https://example.com')
    expect(msg).toContain('allowForeground:true')
    expect(msg).toContain('goto')
  })
})

describe('shouldBlockForeground (contract recap)', () => {
  it('blocks by default and honors explicit per-step consent', () => {
    expect(shouldBlockForeground({ askBeforeForeground: true }, undefined)).toBe(true)
    expect(shouldBlockForeground({ askBeforeForeground: true }, true)).toBe(false)
    expect(shouldBlockForeground({ backgroundOnly: true }, true)).toBe(false)
    expect(shouldBlockForeground({ backgroundOnly: false, askBeforeForeground: false }, undefined)).toBe(false)
  })
})

describe('foregroundPayloadFlag', () => {
  it('tells the automation script to stay background-only when input is forbidden', () => {
    expect(foregroundPayloadFlag({ backgroundOnly: true }, undefined)).toEqual({ backgroundOnly: true })
    expect(foregroundPayloadFlag({ askBeforeForeground: true }, undefined)).toEqual({ backgroundOnly: true })
  })

  it('sends no flag when consent or open guardrails allow the foreground', () => {
    expect(foregroundPayloadFlag({ askBeforeForeground: true }, true)).toEqual({})
    expect(foregroundPayloadFlag({ backgroundOnly: false, askBeforeForeground: false }, undefined)).toEqual({})
  })
})

describe('isTrueFlag / isFalseFlag', () => {
  it('accepts booleans, case-insensitive strings and 1', () => {
    expect(isTrueFlag(true)).toBe(true)
    expect(isTrueFlag('True')).toBe(true)
    expect(isTrueFlag(' FALSE ')).toBe(false)
    expect(isTrueFlag(1)).toBe(true)
    expect(isTrueFlag(false)).toBe(false)
    expect(isTrueFlag('false')).toBe(false)
    expect(isTrueFlag(0)).toBe(false)
    expect(isTrueFlag(undefined)).toBe(false)
    expect(isTrueFlag('yes')).toBe(false)
  })

  it('detects explicit false flags', () => {
    expect(isFalseFlag(false)).toBe(true)
    expect(isFalseFlag('False')).toBe(true)
    expect(isFalseFlag(' FALSE ')).toBe(true)
    expect(isFalseFlag(true)).toBe(false)
    expect(isFalseFlag('true')).toBe(false)
    expect(isFalseFlag(undefined)).toBe(false)
    expect(isFalseFlag(0)).toBe(false)
  })
})

describe('shouldAutoRefocus', () => {
  const open = { backgroundOnly: false, askBeforeForeground: false }

  it('refocuses on focus-loss errors when the foreground is allowed', () => {
    expect(shouldAutoRefocus({
      settings: open,
      consent: true,
      hwnd: 123,
      error: "A janela ativa mudou para 'electron' (esperava 'EXCEL')",
    })).toBe(true)
  })

  it('accepts stringified consent like the host sends', () => {
    expect(shouldAutoRefocus({
      settings: { backgroundOnly: false, askBeforeForeground: true },
      consent: 'True',
      hwnd: 123,
      error: 'background_occluded: target not in foreground',
    })).toBe(true)
  })

  it('refuses without consent under strict guardrails', () => {
    expect(shouldAutoRefocus({
      settings: { backgroundOnly: true },
      consent: undefined,
      hwnd: 123,
      error: 'foreground stolen',
    })).toBe(false)
    expect(shouldAutoRefocus({
      settings: { backgroundOnly: false, askBeforeForeground: true },
      consent: undefined,
      hwnd: 123,
      error: 'foreground stolen',
    })).toBe(false)
  })

  it('refuses without a bound window or a focus-smell error', () => {
    expect(shouldAutoRefocus({ settings: open, consent: true, hwnd: 0, error: 'foreground stolen' })).toBe(false)
    expect(shouldAutoRefocus({ settings: open, consent: true, hwnd: 123, error: 'not found' })).toBe(false)
    expect(shouldAutoRefocus({ settings: open, consent: true, hwnd: 123, error: '' })).toBe(false)
  })
})
