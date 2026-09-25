import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// runtime.ts is CJS (module.exports), loaded with native require like the host does.
const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as { tools: Array<{ name: string }> }
const extensionDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// Per-step primitive flow the model must drive itself, without a batched op.
const REQUIRED_TOOLS = [
  'desktop_launch',
  'desktop_snapshot',
  'desktop_find',
  'desktop_click',
  'desktop_type',
  'desktop_press',
  'desktop_stop_run'
]

function readExtensionFile(name: string): string {
  return fs.readFileSync(path.join(extensionDir, name), 'utf8')
}

describe('exposed desktop tool surface', () => {
  it('hides desktop_act so the model works tool by tool', () => {
    const names = runtime.tools.map((tool) => tool.name)
    expect(names).not.toContain('desktop_act')
  })

  it('keeps the per-step primitives exposed', () => {
    const names = runtime.tools.map((tool) => tool.name)
    for (const tool of REQUIRED_TOOLS) {
      expect(names).toContain(tool)
    }
  })

  it('keeps desktop_act out of manifest.json and SKILL.md', () => {
    const manifest = JSON.parse(readExtensionFile('manifest.json')) as {
      tools?: Array<{ name: string }>
    }
    expect((manifest.tools || []).map((tool) => tool.name)).not.toContain('desktop_act')
    expect(readExtensionFile('SKILL.md')).not.toContain('desktop_act')
  })
})
