import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// ipc-storage.ts is CJS like worker.ts, loaded with native require.
const require = createRequire(import.meta.url)
const { createIpcDesktopStorage } = require('../ipc-storage.ts') as {
  createIpcDesktopStorage: (opts: {
    send: (msg: unknown) => void
    onResponse: (fn: (msg: { type?: string; requestId?: string; result?: { ok?: boolean; value?: unknown; error?: string; errorCode?: string } }) => void) => void
    storageDir: string
  }) => {
    storage: {
      get: (key: string) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<void>
    }
  }
}

describe('desktop worker storage uses host SQLite via IPC', () => {
  it('routes get/set through storage-request instead of shared JSON files', async () => {
    const sent: Array<{ type?: string; method?: string; args?: unknown[]; requestId?: string }> = []
    const holder: { current: ((msg: { type?: string; requestId?: string; result?: { ok?: boolean; value?: unknown; error?: string; errorCode?: string } }) => void) | null } = {
      current: null
    }
    const bridge = createIpcDesktopStorage({
      send: (msg: unknown) => {
        sent.push(msg as { type?: string; method?: string; args?: unknown[]; requestId?: string })
      },
      onResponse: (fn: (msg: { type?: string; requestId?: string; result?: { ok?: boolean; value?: unknown; error?: string; errorCode?: string } }) => void) => {
        holder.current = fn
      },
      storageDir: '/tmp/desktop-display-only'
    })

    const pendingGet = bridge.storage.get('desktop-settings')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'storage-request', method: 'storage.get' })
    expect(Array.isArray(sent[0].args)).toBe(true)
    expect(sent[0].args?.[0]).toBe('desktop-settings')

    holder.current?.({
      type: 'storage-response',
      requestId: sent[0].requestId,
      result: { ok: true, value: { backgroundOnly: true } }
    })
    await expect(pendingGet).resolves.toEqual({ backgroundOnly: true })

    sent.length = 0
    const pendingSet = bridge.storage.set('desktop-settings', { backgroundOnly: false })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'storage-request', method: 'storage.set' })

    holder.current?.({
      type: 'storage-response',
      requestId: sent[0].requestId,
      result: { ok: true, value: undefined }
    })
    await expect(pendingSet).resolves.toBeUndefined()
  })
})
