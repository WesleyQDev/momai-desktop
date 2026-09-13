import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    pickSnapshotHwnd: (scope: unknown, explicitHwnd: unknown, boundHwnd: unknown) => number
    resolveStaleBinding: (appName: unknown, windows: unknown) => number
    isForegroundConsent: (value: unknown) => boolean
  }
}

const { pickSnapshotHwnd, resolveStaleBinding, isForegroundConsent } = runtime.__internals

describe('pickSnapshotHwnd', () => {
  it('reads the bound task window instead of the foreground by default', () => {
    expect(pickSnapshotHwnd('active', 0, 12345)).toBe(12345)
  })

  it('keeps an explicit apps scope above the binding', () => {
    expect(pickSnapshotHwnd('active', 111, 12345)).toBe(111)
  })

  it('falls back to the foreground without a binding', () => {
    expect(pickSnapshotHwnd('active', 0, 0)).toBe(0)
    expect(pickSnapshotHwnd('active', 0, null)).toBe(0)
  })

  it('ignores handles on a desktop-wide read', () => {
    expect(pickSnapshotHwnd('desktop', 111, 12345)).toBe(0)
  })

  it('normalizes unusable handles to foreground', () => {
    expect(pickSnapshotHwnd('active', -5, 'abc')).toBe(0)
  })
})

describe('resolveStaleBinding', () => {
  const windows = [
    { hwnd: 777, title: 'notes.txt - Notepad', app: 'notepad' },
    { hwnd: 888, title: 'Planilha - Excel', app: 'EXCEL' },
  ]

  it('re-finds the same app under a new handle', () => {
    expect(resolveStaleBinding('EXCEL', windows)).toBe(888)
    expect(resolveStaleBinding('excel', windows)).toBe(888)
  })

  it('returns foreground (0) when the app is gone or unknown', () => {
    expect(resolveStaleBinding('WinWord', windows)).toBe(0)
    expect(resolveStaleBinding('', windows)).toBe(0)
    expect(resolveStaleBinding(null, windows)).toBe(0)
    expect(resolveStaleBinding('EXCEL', [])).toBe(0)
  })
})

describe('isForegroundConsent', () => {
  it('accepts boolean true', () => {
    expect(isForegroundConsent(true)).toBe(true)
    expect(isForegroundConsent(false)).toBe(false)
  })

  it('tolerates stringified booleans from hosts', () => {
    expect(isForegroundConsent('True')).toBe(true)
    expect(isForegroundConsent('true')).toBe(true)
    expect(isForegroundConsent(' TRUE ')).toBe(true)
    expect(isForegroundConsent('false')).toBe(false)
    expect(isForegroundConsent('yes')).toBe(false)
  })

  it('rejects anything else', () => {
    expect(isForegroundConsent(undefined)).toBe(false)
    expect(isForegroundConsent(null)).toBe(false)
    expect(isForegroundConsent(0)).toBe(false)
    expect(isForegroundConsent(1)).toBe(true)
  })
})
