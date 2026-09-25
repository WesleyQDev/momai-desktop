import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// runtime.ts is CJS (module.exports), loaded with native require like the host does.
const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    openedItemQuery: (value: unknown) => string
    buildOpenItemInstruction: (input: {
      message: unknown
      path: unknown
      screenText: unknown
    }) => string
    buildActionFailureInstruction: (input: {
      actionLabel: unknown
      detail: unknown
      screenText: unknown
    }) => string
  }
}

const { openedItemQuery, buildOpenItemInstruction, buildActionFailureInstruction } =
  runtime.__internals

describe('openedItemQuery', () => {
  it('uses the item name without the file extension', () => {
    expect(openedItemQuery('C:\\Users\\wesle\\Documents\\relatorio.txt')).toBe('relatorio')
    expect(openedItemQuery('foto.jpeg')).toBe('foto')
  })

  it('keeps folder names and plain names intact', () => {
    expect(openedItemQuery('C:\\Users\\wesle\\Downloads')).toBe('Downloads')
    expect(openedItemQuery('Calculadora')).toBe('Calculadora')
  })

  it('returns an empty string for empty input', () => {
    expect(openedItemQuery('')).toBe('')
    expect(openedItemQuery(null)).toBe('')
  })
})

describe('buildOpenItemInstruction', () => {
  const base = { message: '"relatorio" aberto com sucesso.', path: 'C:\\relatorio.txt' }

  it('carries the fresh screen so the next step needs no extra snapshot', () => {
    const out = buildOpenItemInstruction({ ...base, screenText: 'SNAPSHOT (id: s1)\n[1] Documento' })
    expect(out).toContain('NOVA TELA')
    expect(out).toContain('[1] Documento')
    expect(out).toContain('desktop_stop_run')
    expect(out).not.toContain('Chame desktop_snapshot')
  })

  it('falls back to the snapshot hint when no screen came back', () => {
    const out = buildOpenItemInstruction({ ...base, screenText: '' })
    expect(out).toContain('Chame desktop_snapshot')
    expect(out).not.toContain('NOVA TELA')
  })
})

describe('buildActionFailureInstruction', () => {
  it('hands the current screen back with the failure so the retry needs no extra read', () => {
    const out = buildActionFailureInstruction({
      actionLabel: 'clicado "Salvar"',
      detail: 'element not found',
      screenText: 'SNAPSHOT (id: s2)\n[3] Salvar como'
    })
    expect(out).toContain('clicado "Salvar"')
    expect(out).toContain('element not found')
    expect(out).toContain('NOVA TELA')
    expect(out).toContain('[3] Salvar como')
  })

  it('keeps the snapshot hint when the screen could not be read', () => {
    const out = buildActionFailureInstruction({
      actionLabel: 'clicado "Salvar"',
      detail: 'element not found',
      screenText: ''
    })
    expect(out).toContain('take a new desktop_snapshot')
    expect(out).not.toContain('NOVA TELA')
  })
})
