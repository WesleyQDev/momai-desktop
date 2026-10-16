import { describe, it, expect, afterEach, vi } from 'vitest'
import path from 'node:path'
import { createRequire } from 'node:module'

// runtime.ts is CJS loaded with native require, exactly like the host does.
const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    capturesBaseDir: () => string | null
    captureFileName: (now: Date, suffix: string, token?: string) => string
    selectCapturesToPrune: (
      entries: Array<{ name: string; mtimeMs: number }>,
      opts: { maxFiles: number; maxAgeMs: number; now: number }
    ) => string[]
    resolveCaptureScope: (scope: unknown, hasApp: boolean) => string
    resolveImagePath: (value: unknown, baseDir: string | null) => { ok: boolean; path?: string; error?: string }
    buildImageCardPayload: (
      title: unknown,
      images: Array<{ url: string; label?: string }>
    ) => { type: string; data: { title?: string; images: Array<{ url: string; label?: string }> } }
  }
}

const {
  capturesBaseDir,
  captureFileName,
  selectCapturesToPrune,
  resolveCaptureScope,
  resolveImagePath,
  buildImageCardPayload
} = runtime.__internals

describe('capturesBaseDir (mode-scoped extension storage)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers the storage dir the host handed to the worker', () => {
    vi.stubEnv('MOMAI_EXTENSION_STORAGE_DIR', 'D:\\mode\\data-symlink\\momai-desktop')
    vi.stubEnv('MOMAI_DATA_DIR', 'C:\\Users\\wesle\\AppData\\Roaming\\MomAI\\data')
    expect(capturesBaseDir()).toBe(path.join('D:\\mode\\data-symlink\\momai-desktop', 'captures'))
  })

  it('falls back to the data layout when no storage dir is set', () => {
    vi.stubEnv('MOMAI_EXTENSION_STORAGE_DIR', '')
    vi.stubEnv('MOMAI_DATA_DIR', 'C:\\Users\\wesle\\AppData\\Roaming\\MomAI\\data')
    vi.stubEnv('MOMAI_EXTENSION_ID', 'momai-desktop')
    expect(capturesBaseDir()).toBe(
      path.join('C:\\Users\\wesle\\AppData\\Roaming\\MomAI\\data', 'extensions', 'momai-desktop', 'captures')
    )
  })

  it('returns null without any data dir', () => {
    vi.stubEnv('MOMAI_EXTENSION_STORAGE_DIR', '')
    vi.stubEnv('MOMAI_DATA_DIR', '')
    vi.stubEnv('MOMAI_NODE_CORE_DATA_DIR', '')
    expect(capturesBaseDir()).toBeNull()
  })
})

describe('captureFileName', () => {
  it('builds a distinct, filesystem-safe JPEG name per target', () => {
    const now = new Date(2026, 9, 15, 18, 45, 1)
    expect(captureFileName(now, 'd2', 'ab12')).toBe('capture-20261015-184501-d2-ab12.jpg')
    expect(captureFileName(now, 'win', 'cd34')).toBe('capture-20261015-184501-win-cd34.jpg')
  })

  it('sanitizes the suffix and tolerates a missing token', () => {
    const now = new Date(2026, 0, 2, 3, 4, 5)
    expect(captureFileName(now, '..\\evil name!', '')).toBe('capture-20260102-030405-evilname.jpg')
    expect(captureFileName(now, '', undefined)).toBe('capture-20260102-030405-shot.jpg')
  })
})

describe('selectCapturesToPrune', () => {
  const now = 1_000_000
  const entries = [
    { name: 'old.jpg', mtimeMs: now - 10_000 },
    { name: 'fresh-1.jpg', mtimeMs: now - 1_000 },
    { name: 'fresh-2.jpg', mtimeMs: now - 500 }
  ]

  it('drops files beyond the age limit', () => {
    expect(selectCapturesToPrune(entries, { maxFiles: 10, maxAgeMs: 5_000, now })).toEqual(['old.jpg'])
  })

  it('keeps the newest files when the count limit is exceeded', () => {
    expect(selectCapturesToPrune(entries, { maxFiles: 1, maxAgeMs: 60_000, now })).toEqual([
      'fresh-1.jpg',
      'old.jpg'
    ])
  })

  it('keeps everything inside both limits', () => {
    expect(selectCapturesToPrune(entries, { maxFiles: 10, maxAgeMs: 60_000, now })).toEqual([])
    expect(selectCapturesToPrune([], { maxFiles: 10, maxAgeMs: 60_000, now })).toEqual([])
  })
})

describe('resolveCaptureScope', () => {
  it('accepts the canonical scopes and common synonyms', () => {
    expect(resolveCaptureScope('all', false)).toBe('all')
    expect(resolveCaptureScope('todos', false)).toBe('all')
    expect(resolveCaptureScope('window', false)).toBe('window')
    expect(resolveCaptureScope('janela', false)).toBe('window')
    expect(resolveCaptureScope('display', true)).toBe('display')
    expect(resolveCaptureScope('monitor', false)).toBe('display')
  })

  it('derives the scope from app and falls back to one display', () => {
    expect(resolveCaptureScope('', true)).toBe('window')
    expect(resolveCaptureScope(undefined, false)).toBe('display')
    expect(resolveCaptureScope('nonsense', false)).toBe('display')
    expect(resolveCaptureScope('nonsense', true)).toBe('window')
  })
})

describe('resolveImagePath', () => {
  const base = 'C:\\Users\\wesle\\AppData\\Roaming\\MomAI\\data\\extensions\\momai-desktop\\captures'

  it('keeps absolute paths as they are', () => {
    const absolute = 'C:\\Users\\wesle\\Pictures\\photo.png'
    const resolved = resolveImagePath(absolute, base)
    expect(resolved.ok).toBe(true)
    expect(resolved.path).toBe(absolute)
  })

  it('resolves a bare file name inside the captures folder', () => {
    const resolved = resolveImagePath('capture-20261015-184501-d1-ab12.jpg', base)
    expect(resolved.ok).toBe(true)
    expect(resolved.path).toBe(path.join(base, 'capture-20261015-184501-d1-ab12.jpg'))
  })

  it('never escapes the captures folder through relative segments', () => {
    const resolved = resolveImagePath('..\\..\\secret.jpg', base)
    expect(resolved.ok).toBe(true)
    expect(resolved.path).toBe(path.join(base, 'secret.jpg'))
  })

  it('refuses empty, non-image and base-less relative values', () => {
    expect(resolveImagePath('', base).ok).toBe(false)
    expect(resolveImagePath('notes.txt', base).ok).toBe(false)
    expect(resolveImagePath('photo.png', null).ok).toBe(false)
  })
})

describe('buildImageCardPayload (individual image cards)', () => {
  it('keeps one entry per image, in order', () => {
    const payload = buildImageCardPayload('', [
      { url: 'data:image/jpeg;base64,AAA', label: 'capture-a.jpg' },
      { url: 'data:image/jpeg;base64,BBB', label: 'capture-b.jpg' }
    ])
    expect(payload.type).toBe('momai-desktop-image')
    expect(payload.data.images).toEqual([
      { url: 'data:image/jpeg;base64,AAA', label: 'capture-a.jpg' },
      { url: 'data:image/jpeg;base64,BBB', label: 'capture-b.jpg' }
    ])
  })

  it('only carries a title when one was asked for', () => {
    expect(buildImageCardPayload('', [{ url: 'data:,x' }]).data.title).toBeUndefined()
    expect(buildImageCardPayload('  ', [{ url: 'data:,x' }]).data.title).toBeUndefined()
    expect(buildImageCardPayload(' Prints ', [{ url: 'data:,x' }]).data.title).toBe('Prints')
  })

  it('drops entries without a usable url', () => {
    const payload = buildImageCardPayload('', [
      { url: '' },
      { url: undefined } as unknown as { url: string },
      { url: 'data:,ok' }
    ])
    expect(payload.data.images).toHaveLength(1)
    expect(payload.data.images[0].url).toBe('data:,ok')
  })
})
