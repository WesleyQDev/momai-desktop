import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRequire } from 'node:module'

// runtime.ts is CJS loaded with native require, exactly like the host does.
const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    framesBaseDir: () => string | null
  }
}

describe('framesBaseDir (unified extension cache)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves replay frames under app-cache/extensions/<id>/cache', () => {
    vi.stubEnv('MOMAI_DATA_DIR', 'C:\\Users\\wesle\\AppData\\Roaming\\MomAI\\data')
    vi.stubEnv('MOMAI_EXTENSION_ID', 'momai-desktop')
    expect(runtime.__internals.framesBaseDir()).toBe(
      'C:\\Users\\wesle\\AppData\\Roaming\\MomAI\\app-cache\\extensions\\momai-desktop\\cache\\frames'
    )
  })

  it('returns null without a data dir (old behavior)', () => {
    vi.stubEnv('MOMAI_DATA_DIR', '')
    vi.stubEnv('MOMAI_NODE_CORE_DATA_DIR', '')
    expect(runtime.__internals.framesBaseDir()).toBeNull()
  })
})
