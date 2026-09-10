import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// runtime.ts is CJS (module.exports), loaded with native require like the host does.
const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    isDesktopActActionOp: (op: unknown) => boolean
    keyboardFallbackKey: (name: unknown) => string | null
    closeButtonCandidates: () => Array<{ name: string; role: string }>
    normalizeGotoUrl: (raw: unknown) => { ok: boolean; url?: string; error?: string }
    escapeSendKeysText: (text: unknown) => string
    normalizeHwnd: (value: unknown) => number
    shouldRebindWindow: (
      boundApp: unknown,
      foundApp: unknown,
      boundHwnd: unknown,
      foundHwnd: unknown
    ) => boolean
    doesLaunchMatchApp: (
      query: unknown,
      appName: unknown,
      windowTitle: unknown
    ) => boolean
    buildLaunchOutcome: (input: {
      query: unknown
      where: unknown
      postApp: unknown
      postTitle: unknown
      unchanged: unknown
    }) => { ok: boolean; outcome: string }
    findLaunchWindow: (
      windows: unknown,
      query: unknown
    ) => { hwnd: number; title: string; app: string } | null
    resolveAppScope: (
      apps: unknown,
      windows: unknown
    ) => { hwnd: number; query: string; title: string; app: string } | null
    formatActMissError: (
      name: unknown,
      role: unknown,
      lastError: unknown
    ) => string
    shouldRefocusWindow: (boundHwnd: unknown, lastError: unknown) => boolean
    buildActFailHint: (input: {
      op: unknown
      effName: unknown
      stale: unknown
      bound: unknown
    }) => string
    actCallSignature: (objective: unknown, steps: unknown) => string
    shouldBlockActRepeat: (
      history: unknown,
      sig: unknown
    ) => { blocked: boolean; fails: number }
    buildActTerminalInstruction: (input: {
      aborted: unknown
      outcomesLength: unknown
      stepsLength: unknown
      lines: unknown
      finalText: unknown
    }) => string
  }
}

const {
  isDesktopActActionOp,
  keyboardFallbackKey,
  closeButtonCandidates,
  normalizeGotoUrl,
  escapeSendKeysText,
  normalizeHwnd,
  shouldRebindWindow,
  doesLaunchMatchApp,
  buildLaunchOutcome,
  findLaunchWindow,
  resolveAppScope,
  formatActMissError,
  shouldRefocusWindow,
  buildActFailHint,
  actCallSignature,
  shouldBlockActRepeat,
  buildActTerminalInstruction,
} = runtime.__internals

describe('isDesktopActActionOp', () => {
  it('counts launch, click, type, press, close and goto as action steps', () => {
    for (const op of ['launch', 'click', 'type', 'press', 'close', 'goto']) {
      expect(isDesktopActActionOp(op)).toBe(true)
    }
  })

  it('does not count wait or unknown ops as action steps', () => {
    expect(isDesktopActActionOp('wait')).toBe(false)
    expect(isDesktopActActionOp('unknown')).toBe(false)
    expect(isDesktopActActionOp('')).toBe(false)
  })
})

describe('keyboardFallbackKey', () => {
  it('maps single digit and operator labels straight to keys', () => {
    expect(keyboardFallbackKey('1')).toBe('1')
    expect(keyboardFallbackKey('0')).toBe('0')
    expect(keyboardFallbackKey('*')).toBe('*')
    expect(keyboardFallbackKey('=')).toBe('=')
  })

  it('maps common named keys to SendKeys tokens', () => {
    expect(keyboardFallbackKey('Enter')).toBe('{ENTER}')
  })

  it('returns null when there is no safe keyboard equivalent', () => {
    expect(keyboardFallbackKey('Salvar')).toBe(null)
    expect(keyboardFallbackKey('')).toBe(null)
  })
})

describe('closeButtonCandidates', () => {
  it('tries the window close button in English and Portuguese', () => {
    expect(closeButtonCandidates()).toEqual([
      { name: 'Close', role: 'Button' },
      { name: 'Fechar', role: 'Button' },
    ])
  })
})

describe('normalizeGotoUrl', () => {
  it('accepts full http(s) addresses', () => {
    expect(normalizeGotoUrl('https://example.com/a?b=1').ok).toBe(true)
    expect(normalizeGotoUrl('http://example.com/').ok).toBe(true)
  })

  it('completes bare addresses with https', () => {
    const res = normalizeGotoUrl('example.com/path')
    expect(res.ok).toBe(true)
    expect(res.url).toBe('https://example.com/path')
  })

  it('refuses non-web addresses', () => {
    expect(normalizeGotoUrl('javascript:alert(1)').ok).toBe(false)
    expect(normalizeGotoUrl('file:///C:/x').ok).toBe(false)
    expect(normalizeGotoUrl('').ok).toBe(false)
  })
})

describe('escapeSendKeysText', () => {
  it('escapes SendKeys modifier characters', () => {
    expect(escapeSendKeysText('a+b')).toBe('a{+}b')
    expect(escapeSendKeysText('100%')).toBe('100{%}')
    expect(escapeSendKeysText('{x}')).toBe('{{}x{}}')
  })

  it('leaves plain addresses untouched', () => {
    expect(escapeSendKeysText('https://example.com/a/b')).toBe(
      'https://example.com/a/b'
    )
  })
})

describe('normalizeHwnd', () => {
  it('keeps positive window handles as integers', () => {
    expect(normalizeHwnd(123)).toBe(123)
    expect(normalizeHwnd('456')).toBe(456)
    expect(normalizeHwnd(12.9)).toBe(12)
  })

  it('maps anything unusable to zero (unscoped)', () => {
    expect(normalizeHwnd(0)).toBe(0)
    expect(normalizeHwnd(-5)).toBe(0)
    expect(normalizeHwnd('')).toBe(0)
    expect(normalizeHwnd(null)).toBe(0)
    expect(normalizeHwnd(undefined)).toBe(0)
  })
})

describe('shouldRebindWindow', () => {
  it('rebinds when the same app shows a different window', () => {
    expect(shouldRebindWindow('mspaint', 'mspaint', 11, 22)).toBe(true)
    expect(shouldRebindWindow('MSPaint', 'mspaint', 11, 22)).toBe(true)
  })

  it('never rebinds across apps, same windows, or unknown apps', () => {
    expect(shouldRebindWindow('mspaint', 'notepad', 11, 22)).toBe(false)
    expect(shouldRebindWindow('mspaint', 'mspaint', 11, 11)).toBe(false)
    expect(shouldRebindWindow('', 'mspaint', 11, 22)).toBe(false)
    expect(shouldRebindWindow('mspaint', '', 11, 22)).toBe(false)
    expect(shouldRebindWindow('mspaint', 'mspaint', 11, 0)).toBe(false)
  })
})

describe('doesLaunchMatchApp', () => {
  it('matches by localized window title', () => {
    expect(doesLaunchMatchApp('Calculadora', 'CalculatorApp', 'Calculadora')).toBe(true)
    expect(
      doesLaunchMatchApp('bloco de notas', 'notepad', 'Sem título - Bloco de Notas')
    ).toBe(true)
  })

  it('matches by process name', () => {
    expect(doesLaunchMatchApp('Edge', 'msedge', 'Nova guia')).toBe(true)
    expect(doesLaunchMatchApp('Word', 'WINWORD', 'Documento1')).toBe(true)
  })

  it('rejects when the foreground is another app', () => {
    expect(doesLaunchMatchApp('Calculadora', 'electron', 'MomAI')).toBe(false)
    expect(doesLaunchMatchApp('', 'CalculatorApp', 'Calculadora')).toBe(false)
    expect(doesLaunchMatchApp('Calculadora', '', '')).toBe(false)
  })
})

describe('buildLaunchOutcome', () => {
  it('fails loudly when the program did not take the foreground', () => {
    const res = buildLaunchOutcome({
      query: 'calculadora',
      where: '"MomAI"',
      postApp: 'electron',
      postTitle: 'MomAI',
      unchanged: false,
    })
    expect(res.ok).toBe(false)
    expect(res.outcome).toContain('FAILED')
    expect(res.outcome).toContain('retry ONLY the launch step')
  })

  it('reports ok and binds when the program matches', () => {
    const res = buildLaunchOutcome({
      query: 'calculadora',
      where: '"Calculadora"',
      postApp: 'CalculatorApp',
      postTitle: 'Calculadora',
      unchanged: false,
    })
    expect(res.ok).toBe(true)
    expect(res.outcome).toContain('ok')
  })

  it('notes when the program was already open', () => {
    const res = buildLaunchOutcome({
      query: 'calculadora',
      where: '"Calculadora"',
      postApp: 'CalculatorApp',
      postTitle: 'Calculadora',
      unchanged: true,
    })
    expect(res.ok).toBe(true)
    expect(res.outcome).toContain('already open')
  })
})

describe('findLaunchWindow', () => {
  const windows = [
    { hwnd: 11, title: 'MomAI', app: 'electron' },
    { hwnd: 22, title: 'Calculadora', app: 'CalculatorApp' },
  ]

  it('finds the open window behind the foreground one', () => {
    expect(findLaunchWindow(windows, 'calculadora')).toEqual({
      hwnd: 22,
      title: 'Calculadora',
      app: 'CalculatorApp',
    })
  })

  it('returns null when nothing matches or there are no windows', () => {
    expect(findLaunchWindow(windows, 'excel')).toBeNull()
    expect(findLaunchWindow([], 'calculadora')).toBeNull()
    expect(findLaunchWindow(windows, '')).toBeNull()
  })
})

describe('resolveAppScope', () => {
  const windows = [
    { hwnd: 11, title: 'MomAI', app: 'electron' },
    { hwnd: 22, title: 'Calculadora', app: 'ApplicationFrameHost' },
  ]

  it('resolves an app filter to its window behind the foreground', () => {
    expect(resolveAppScope(['Calculadora'], windows)).toEqual({
      hwnd: 22,
      query: 'Calculadora',
      title: 'Calculadora',
      app: 'ApplicationFrameHost',
    })
  })

  it('accepts a plain string and returns null without a match', () => {
    expect(resolveAppScope('calculadora', windows)?.hwnd).toBe(22)
    expect(resolveAppScope(['excel'], windows)).toBeNull()
    expect(resolveAppScope(undefined, windows)).toBeNull()
    expect(resolveAppScope([], windows)).toBeNull()
  })
})

describe('formatActMissError', () => {
  it('keeps the last underlying error so stops explain themselves', () => {
    const msg = formatActMissError('Um', 'Button', "Elemento nao encontrado: 'Um'")
    expect(msg).toContain('"Um"')
    expect(msg).toContain("Elemento nao encontrado: 'Um'")
  })

  it('falls back to the role and stays clean without detail', () => {
    expect(formatActMissError('', 'Document', '')).toBe(
      'Element "Document" could not be acted on.'
    )
  })
})

describe('shouldRefocusWindow', () => {
  it('retries focus loss on the bound window only', () => {
    expect(
      shouldRefocusWindow(22, 'background_occluded: the target window is not in the foreground')
    ).toBe(true)
    expect(shouldRefocusWindow(22, "A janela ativa mudou para 'x'")).toBe(true)
  })

  it('never refocuses without a bound window, a plain miss, or a gone window', () => {
    expect(shouldRefocusWindow(0, 'background_occluded: nope')).toBe(false)
    expect(shouldRefocusWindow(22, "Elemento nao encontrado: 'Um'")).toBe(false)
    expect(shouldRefocusWindow(22, 'window_gone: the bound window no longer exists.')).toBe(false)
    expect(shouldRefocusWindow(22, '')).toBe(false)
  })
})

describe('buildActFailHint', () => {
  it('suggests launch first when nothing is bound', () => {
    const hint = buildActFailHint({ op: 'click', effName: 'Um', stale: false, bound: 0 })
    expect(hint).toContain('{op:"launch"')
  })

  it('suggests relaunch when the bound window is gone', () => {
    const hint = buildActFailHint({ op: 'click', effName: 'Um', stale: true, bound: 0 })
    expect(hint).toContain('relaunch')
    expect(hint).not.toContain('{op:"launch"')
  })

  it('suggests the keyboard fallback for digits without hiding the miss', () => {
    const hint = buildActFailHint({ op: 'click', effName: '1', stale: false, bound: 22 })
    expect(hint).toContain('{op:"press"')
    expect(hint).not.toContain('{op:"launch"')
  })
})

describe('actCallSignature', () => {
  const steps = [
    { op: 'launch', query: 'Excel' },
    { op: 'click', name: 'Livro em branco' },
  ]

  it('is stable for the same plan and changes with it', () => {
    expect(actCallSignature('plan', steps)).toBe(actCallSignature('plan', steps))
    expect(actCallSignature('plan', [...steps, { op: 'wait', ms: 1 }])).not.toBe(
      actCallSignature('plan', steps)
    )
    expect(actCallSignature('other', steps)).not.toBe(actCallSignature('plan', steps))
  })

  it('ignores long text bodies beyond a prefix', () => {
    const a = [{ op: 'type', text: `x`.repeat(200) }]
    const b = [{ op: 'type', text: `x`.repeat(200) + 'different tail' }]
    expect(actCallSignature('plan', a)).toBe(actCallSignature('plan', b))
  })
})

describe('shouldBlockActRepeat', () => {
  it('blocks the third identical failed attempt', () => {
    const history = [
      { sig: 's', ok: false },
      { sig: 's', ok: false },
    ]
    expect(shouldBlockActRepeat(history, 's')).toEqual({ blocked: true, fails: 2 })
  })

  it('allows first retries, successes, and different plans', () => {
    expect(shouldBlockActRepeat([], 's')).toEqual({ blocked: false, fails: 0 })
    expect(shouldBlockActRepeat([{ sig: 's', ok: false }], 's')).toEqual({
      blocked: false,
      fails: 1,
    })
    expect(
      shouldBlockActRepeat(
        [
          { sig: 's', ok: false },
          { sig: 's', ok: true },
        ],
        's'
      )
    ).toEqual({ blocked: false, fails: 0 })
    expect(
      shouldBlockActRepeat(
        [
          { sig: 'other', ok: false },
          { sig: 'other', ok: false },
        ],
        's'
      )
    ).toEqual({ blocked: false, fails: 0 })
  })
})

describe('buildActTerminalInstruction', () => {
  it('tells a stopped task to adjust and retry, never manual steps', () => {
    const msg = buildActTerminalInstruction({
      aborted: true,
      outcomesLength: 2,
      stepsLength: 5,
      lines: 'x',
      finalText: 'y',
    })
    expect(msg).toContain('TASK STOPPED')
    expect(msg).toContain('desktop_act de novo')
    expect(msg).toContain('Nao explique passo manual')
  })

  it('tells a done task to verify the objective and continue, not summarize', () => {
    const msg = buildActTerminalInstruction({
      aborted: false,
      outcomesLength: 5,
      stepsLength: 5,
      lines: 'x',
      finalText: 'y',
    })
    expect(msg).toContain('TASK DONE')
    expect(msg).toContain('OBJETIVO')
    expect(msg).toContain('desktop_act de novo')
    expect(msg).toContain('nunca despeje')
  })
})
