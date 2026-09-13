import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    formatSnapshotHeader: (input: {
      appName?: unknown
      windowTitle?: unknown
      snapshotId?: unknown
      shown?: unknown
      total?: unknown
      focusWarning?: unknown
    }) => string
  }
}

const { formatSnapshotHeader } = runtime.__internals

describe('formatSnapshotHeader', () => {
  it('carries app, window, snapshot id and element counts', () => {
    const header = formatSnapshotHeader({
      appName: 'Notepad',
      windowTitle: 'notes.txt',
      snapshotId: 'snap-1',
      shown: 60,
      total: 200,
    })
    expect(header).toContain('App: Notepad')
    expect(header).toContain('Window: notes.txt')
    expect(header).toContain('snapshotId: snap-1')
    expect(header).toContain('Elements: 60 shown of 200')
  })

  it('appends the focus warning when the foreground moved', () => {
    const header = formatSnapshotHeader({
      appName: 'Chrome',
      snapshotId: 'snap-2',
      shown: 3,
      total: 3,
      focusWarning: 'STOP: wrong window',
    })
    expect(header).toContain('STOP: wrong window')
  })

  it('degrades gracefully without app identity or counts', () => {
    const header = formatSnapshotHeader({ snapshotId: 'snap-3' })
    expect(header).toContain('App: unknown')
    expect(header).toContain('snapshotId: snap-3')
  })
})
