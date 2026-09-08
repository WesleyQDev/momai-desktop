import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// runs.ts is CJS like runtime.ts, loaded with native require.
const require = createRequire(import.meta.url)
const runs = require('../desktop/runs.ts') as {
  createRun: (objective?: string) => { id: string; status: string; steps: unknown[]; snapshotId: string | null }
  getRun: (id: string) => { id: string } | null
  latestActiveRun: () => { id: string } | null
  listRuns: (limit?: number) => Array<{ id: string; status: string }>
  appendStep: (runId: string, step: { kind: string; label: string; frame?: string }) => { steps: Array<{ kind: string; label: string; frame?: string }> } | null
  finishRun: (runId: string, status: string) => { status: string } | null
  putSnapshot: (snapshot: { nodes: unknown[] }) => string
  getSnapshot: (id: string) => { nodes: unknown[] } | null
  isAppAllowed: (settings: { allowedApps: string[] }, appName: string) => boolean
  buildRunCard: (run: { id: string; status: string; objective: string; steps: Array<{ ts: string; kind: string; label: string }>; snapshotId: string | null }) => {
    type: string
    data: { runId: string; status: string; totalSteps: number; steps: unknown[] }
  }
}

describe('run store', () => {
  it('creates runs with unique ids', () => {
    const a = runs.createRun('goal a')
    const b = runs.createRun('goal b')
    expect(a.id).not.toBe(b.id)
    expect(a.status).toBe('active')
    expect(runs.getRun(a.id)?.id).toBe(a.id)
  })

  it('appends steps and finishes', () => {
    const run = runs.createRun('goal')
    runs.appendStep(run.id, { kind: 'action', label: 'Clicked "Save"' })
    const finished = runs.finishRun(run.id, 'done')
    expect(finished?.status).toBe('done')
    expect(runs.latestActiveRun()?.id).not.toBe(run.id)
  })

  it('keeps the replay frame reference on steps', () => {
    const run = runs.createRun('goal')
    const updated = runs.appendStep(run.id, { kind: 'frame', label: 'Clicked "Save"', frame: `${run.id}/step-01.jpg` })
    const last = updated?.steps[updated.steps.length - 1] as { frame?: string }
    expect(last?.frame).toBe(`${run.id}/step-01.jpg`)
  })

  it('lists recent runs first', () => {
    const first = runs.createRun('first')
    const second = runs.createRun('second')
    const listed = runs.listRuns(10).map((r) => r.id)
    expect(listed.indexOf(second.id)).toBeLessThan(listed.indexOf(first.id))
  })
})

describe('snapshot cache', () => {
  it('round-trips a snapshot by id', () => {
    const id = runs.putSnapshot({ nodes: [] })
    expect(runs.getSnapshot(id)).not.toBeNull()
  })

  it('returns null for unknown or expired ids', () => {
    expect(runs.getSnapshot('snap-missing')).toBeNull()
    const id = runs.putSnapshot({ nodes: [] })
    expect(runs.getSnapshot(`${id}-stale`)).toBeNull()
  })
})

describe('allowlist', () => {
  it('allows everything when the list is empty', () => {
    expect(runs.isAppAllowed({ allowedApps: [] }, 'WINWORD')).toBe(true)
  })

  it('matches case-insensitively when restricted', () => {
    expect(runs.isAppAllowed({ allowedApps: ['winword'] }, 'WINWORD')).toBe(true)
    expect(runs.isAppAllowed({ allowedApps: ['winword'] }, 'chrome')).toBe(false)
  })
})

describe('buildRunCard', () => {
  it('returns a single momai-desktop-run card', () => {
    const run = runs.createRun('open word')
    runs.appendStep(run.id, { kind: 'snapshot', label: 'Read 60 elements' })
    const card = runs.buildRunCard({
      ...run,
      objective: 'open word',
      steps: [{ ts: new Date().toISOString(), kind: 'snapshot', label: 'Read 60 elements' }],
    })
    expect(card.type).toBe('momai-desktop-run')
    expect(card.data.runId).toBe(run.id)
    expect(card.data.totalSteps).toBe(1)
  })
})
