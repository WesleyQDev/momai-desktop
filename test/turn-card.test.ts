import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// runtime.ts is CJS (module.exports), loaded with native require like the host does.
const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  tools: Array<{ name: string }>
  execute: (payload: {
    toolName: string
    args?: Record<string, unknown>
    content?: string
    momai?: unknown
  }) => Promise<any>
}
const runs = require('../desktop/runs.ts') as {
  createRun: (objective?: string) => { id: string; status: string }
  appendStep: (runId: string, step: { kind: string; label: string }) => unknown
  finishRun: (runId: string, status: string) => unknown
}

// Minimal host bridge: debugLog only touches it when DEBUG/MOMAI_DEBUG is set.
const momai = { log: () => {} }

describe('desktop_turn_card', () => {
  it('stays out of the model-facing tool surface', () => {
    expect(runtime.tools.map((tool) => tool.name)).not.toContain('desktop_turn_card')
  })

  it('returns the latest run card for the host to attach at turn end', async () => {
    const run = runs.createRun('open word')
    runs.appendStep(run.id, { kind: 'snapshot', label: 'Read 60 elements' })
    runs.finishRun(run.id, 'done')

    const result = await runtime.execute({
      toolName: 'desktop_turn_card',
      args: {},
      content: '',
      momai,
    })

    expect(result.structuredResponse?.type).toBe('momai-desktop-run')
    expect(result.structuredResponse?.data?.runId).toBe(run.id)
  })

  it('prefers the active run over an older finished one', async () => {
    const finished = runs.createRun('old task')
    runs.finishRun(finished.id, 'done')
    const active = runs.createRun('current task')

    const result = await runtime.execute({
      toolName: 'desktop_turn_card',
      args: {},
      content: '',
      momai,
    })

    expect(result.structuredResponse?.data?.runId).toBe(active.id)
  })
})
