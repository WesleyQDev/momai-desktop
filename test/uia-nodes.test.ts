import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// nodes.ts is CJS like runtime.ts, loaded with native require.
const require = createRequire(import.meta.url)
const nodes = require('../uia/nodes.ts') as {
  assignRefs: (raw: unknown[], opts?: { maxNodes?: number; maxDepth?: number }) => {
    nodes: Array<{
      ref: number
      control: string
      name: string
      rect: { x: number; y: number; w: number; h: number }
      path: unknown[]
    }>
    truncated: boolean
    totalSeen: number
  }
  findNodes: (nodes: Array<{ ref: number; control: string; name: string }>, query: string, role?: string) => Array<{ ref: number; control: string; name: string }>
  getNodeByRef: (nodes: Array<{ ref: number }>, ref: unknown) => { ref: number } | null
  formatSnapshotForLlm: (snapshot: { nodes: Array<{ ref: number; control: string; name: string; rect: { x: number; y: number; w: number; h: number } }> }, maxLines?: number) => string
  isTreeOpaque: (nodes: unknown) => boolean
  escapeSendKeysChar: (ch: unknown) => string
  normalizeRefInput: (ref: unknown) => number
}

function rawNode(overrides: Record<string, unknown> = {}) {
  return {
    control: 'Button',
    name: 'Salvar',
    automationId: '',
    rect: { x: 10, y: 20, w: 80, h: 24 },
    enabled: true,
    offscreen: false,
    depth: 2,
    path: [],
    patterns: { invoke: true },
    ...overrides,
  }
}

describe('assignRefs', () => {
  it('assigns sequential refs to useful nodes', () => {
    const { nodes: out } = nodes.assignRefs([rawNode(), rawNode({ name: 'Cancelar' })])
    expect(out).toHaveLength(2)
    expect(out[0].ref).toBe(1)
    expect(out[1].ref).toBe(2)
  })

  it('drops offscreen, disabled and rect-less nodes', () => {
    const { nodes: out } = nodes.assignRefs([
      rawNode({ offscreen: true }),
      rawNode({ enabled: false }),
      rawNode({ rect: null }),
      rawNode({ rect: { x: 0, y: 0, w: 0, h: 5 } }),
      rawNode(),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Salvar')
  })

  it('caps the list and reports truncation', () => {
    const many = Array.from({ length: 10 }, (_, i) => rawNode({ name: `Item ${i}` }))
    const res = nodes.assignRefs(many, { maxNodes: 4 })
    expect(res.nodes).toHaveLength(4)
    expect(res.truncated).toBe(true)
    expect(res.totalSeen).toBe(10)
  })

  it('collapses exact duplicates', () => {
    const { nodes: out } = nodes.assignRefs([
      rawNode(),
      rawNode(),
      rawNode({ name: 'Cancelar' }),
    ])
    expect(out.map((n) => n.name)).toEqual(['Salvar', 'Cancelar'])
  })

  it('keeps named non-interactive nodes as landmarks', () => {
    const { nodes: out } = nodes.assignRefs([rawNode({ control: 'Text', name: 'Relatorio mensal' })])
    expect(out).toHaveLength(1)
  })

  it('drops nameless non-interactive nodes', () => {
    const { nodes: out } = nodes.assignRefs([rawNode({ control: 'Separator', name: '' })])
    expect(out).toHaveLength(0)
  })
})

describe('findNodes', () => {
  const { nodes: list } = nodes.assignRefs([
    rawNode({ name: 'Salvar' }),
    rawNode({ name: 'Salvar como', control: 'MenuItem' }),
    rawNode({ name: 'Cancelar' }),
  ])

  it('finds by accent-insensitive substring', () => {
    const found = nodes.findNodes(list, 'salvar')
    expect(found.map((n) => n.name)).toContain('Salvar')
    expect(found.map((n) => n.name)).toContain('Salvar como')
  })

  it('filters by role', () => {
    const found = nodes.findNodes(list, 'salvar', 'MenuItem')
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('Salvar como')
  })

  it('returns empty when nothing matches', () => {
    expect(nodes.findNodes(list, 'imprimir')).toHaveLength(0)
  })
})

describe('getNodeByRef', () => {
  const { nodes: list } = nodes.assignRefs([rawNode()])

  it('resolves numeric and string refs', () => {
    expect(nodes.getNodeByRef(list, 1)?.ref).toBe(1)
    expect(nodes.getNodeByRef(list, '1')?.ref).toBe(1)
  })

  it('returns null for unknown refs', () => {
    expect(nodes.getNodeByRef(list, 99)).toBeNull()
    expect(nodes.getNodeByRef(list, 'abc')).toBeNull()
  })
})

describe('formatSnapshotForLlm', () => {
  it('renders one compact line per node', () => {
    const { nodes: list } = nodes.assignRefs([rawNode()])
    const text = nodes.formatSnapshotForLlm({ nodes: list })
    expect(text).toContain('[1]')
    expect(text).toContain('Salvar')
    expect(text).toContain('10,20')
  })
})

describe('isTreeOpaque', () => {
  it('flags empty trees', () => {
    expect(nodes.isTreeOpaque([])).toBe(true)
    expect(nodes.isTreeOpaque(null)).toBe(true)
  })

  it('flags trees with only nameless containers', () => {
    const { nodes: out } = nodes.assignRefs([
      rawNode({ control: 'Pane', name: '' }),
      rawNode({ control: 'Pane', name: 'Pane' }),
    ])
    expect(nodes.isTreeOpaque(out)).toBe(true)
  })

  it('flags a bare viewport Document as opaque', () => {
    const { nodes: out } = nodes.assignRefs([
      rawNode({ control: 'Pane', name: 'MomAI' }),
      rawNode({ control: 'Pane', name: '' }),
      rawNode({ control: 'Document', name: 'MomAI' }),
    ])
    expect(out.length).toBeGreaterThan(0)
    expect(nodes.isTreeOpaque(out)).toBe(true)
  })

  it('accepts trees with one named actionable element', () => {
    const { nodes: list } = nodes.assignRefs([rawNode({ name: 'Salvar' })])
    expect(nodes.isTreeOpaque(list)).toBe(false)
  })
})

describe('escapeSendKeysChar', () => {  it('escapes every SendKeys modifier in one place', () => {
    expect(nodes.escapeSendKeysChar('{')).toBe('{{}')
    expect(nodes.escapeSendKeysChar('}')).toBe('{}}')
    expect(nodes.escapeSendKeysChar('+')).toBe('{+}')
    expect(nodes.escapeSendKeysChar('^')).toBe('{^}')
    expect(nodes.escapeSendKeysChar('%')).toBe('{%}')
    expect(nodes.escapeSendKeysChar('~')).toBe('{~}')
    expect(nodes.escapeSendKeysChar('(')).toBe('{(}')
    expect(nodes.escapeSendKeysChar(')')).toBe('{)}')
    expect(nodes.escapeSendKeysChar('[')).toBe('{[}')
    expect(nodes.escapeSendKeysChar(']')).toBe('{]}')
  })

  it('passes ordinary characters through', () => {
    expect(nodes.escapeSendKeysChar('a')).toBe('a')
    expect(nodes.escapeSendKeysChar('5')).toBe('5')
    expect(nodes.escapeSendKeysChar(' ')).toBe(' ')
  })
})

describe('normalizeRefInput', () => {
  it('accepts the bracket format shown in snapshots', () => {
    expect(nodes.normalizeRefInput('[42]')).toBe(42)
    expect(nodes.normalizeRefInput(' [7] ')).toBe(7)
  })

  it('accepts plain numbers and numeric strings', () => {
    expect(nodes.normalizeRefInput(42)).toBe(42)
    expect(nodes.normalizeRefInput('42')).toBe(42)
  })

  it('accepts loose forms like "ref 42"', () => {
    expect(nodes.normalizeRefInput('ref 42')).toBe(42)
  })

  it('rejects input without digits', () => {
    expect(nodes.normalizeRefInput('abc')).toBeNaN()
    expect(nodes.normalizeRefInput('')).toBeNaN()
    expect(nodes.normalizeRefInput(null)).toBeNaN()
    expect(nodes.normalizeRefInput(undefined)).toBeNaN()
  })
})

describe('getNodeByRef', () => {
  it('finds nodes passed with brackets', () => {
    const { nodes: list } = nodes.assignRefs([rawNode({ name: 'Salvar' })])
    const ref = list[0].ref
    expect(nodes.getNodeByRef(list, `[${ref}]`)?.ref).toBe(ref)
    expect(nodes.getNodeByRef(list, ref)?.ref).toBe(ref)
  })

  it('misses unknown refs', () => {
    const { nodes: list } = nodes.assignRefs([rawNode({ name: 'Salvar' })])
    expect(nodes.getNodeByRef(list, 9999)).toBeNull()
    expect(nodes.getNodeByRef(list, 'abc')).toBeNull()
  })
})
