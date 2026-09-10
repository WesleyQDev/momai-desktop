import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../runtime.ts') as {
  __internals: {
    resolveProgramAlias: (query: unknown) => string
    parseStartAppsOutput: (stdout: unknown) => Array<{ name: string; appId: string }>
    buildStartAppsLaunchCommand: (appId: unknown) => { ok: boolean; command?: string; error?: string }
    findBestStartApp: (
      candidates: Array<{ name: string; appId: string }>,
      query: unknown
    ) => { name: string; appId: string } | null
    isShellAppsFolderPath: (value: unknown) => boolean
    requiresForegroundEscalation: (result: unknown) => boolean
    shouldBlockForeground: (
      settings: { backgroundOnly?: boolean; askBeforeForeground?: boolean },
      explicitConsent?: unknown
    ) => boolean
    buildForegroundConsentMessage: (appName: unknown, actionLabel: unknown) => string
  }
}
const runs = require('../desktop/runs.ts') as {
  defaultSettings: () => { backgroundOnly: boolean; askBeforeForeground: boolean }
}

const {
  resolveProgramAlias,
  parseStartAppsOutput,
  buildStartAppsLaunchCommand,
  findBestStartApp,
  isShellAppsFolderPath,
  requiresForegroundEscalation,
  shouldBlockForeground,
  buildForegroundConsentMessage,
} = runtime.__internals

describe('resolveProgramAlias', () => {
  it('maps calculadora and calc to calculator', () => {
    expect(resolveProgramAlias('calculadora')).toBe('calculator')
    expect(resolveProgramAlias('Calculadora')).toBe('calculator')
    expect(resolveProgramAlias('calc')).toBe('calculator')
  })

  it('maps bloco de notas to notepad', () => {
    expect(resolveProgramAlias('bloco de notas')).toBe('notepad')
  })

  it('keeps regular names and handles empty input', () => {
    expect(resolveProgramAlias('chrome')).toBe('chrome')
    expect(resolveProgramAlias('')).toBe('')
  })
})

describe('parseStartAppsOutput', () => {
  it('parses Name and AppID entries', () => {
    const stdout = JSON.stringify([
      { Name: 'Calculadora', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
      { Name: 'Google Chrome', AppID: 'Chrome' },
    ])
    const parsed = parseStartAppsOutput(stdout)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      name: 'Calculadora',
      appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
    })
  })

  it('returns empty array for empty or invalid output', () => {
    expect(parseStartAppsOutput('')).toEqual([])
    expect(parseStartAppsOutput('not json')).toEqual([])
  })
})

describe('buildStartAppsLaunchCommand', () => {
  it('builds a background launch without SendKeys or mouse', () => {
    const res = buildStartAppsLaunchCommand('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    expect(res.ok).toBe(true)
    expect(String(res.command)).toContain('shell:AppsFolder')
    expect(String(res.command)).toContain('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    expect(String(res.command)).not.toMatch(/SendKeys|mouse_event|winsearch/i)
  })

  it('quotes the launch path so cmd keeps one -Command argument', () => {
    const res = buildStartAppsLaunchCommand('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    expect(res.ok).toBe(true)
    // Nested double quotes would split -Command in cmd.exe ("Command failed").
    const inner = String(res.command).replace(/^Start-Process\s+/, '')
    expect(inner).not.toContain('"')
  })

  it('refuses empty app ids', () => {
    expect(buildStartAppsLaunchCommand('').ok).toBe(false)
  })
})

describe('findBestStartApp', () => {
  const candidates = [
    { name: 'Calculadora', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    { name: 'Google Chrome', appId: 'Chrome' },
  ]

  it('finds Calculadora by portuguese name and by alias calc', () => {
    expect(findBestStartApp(candidates, 'calculadora')?.appId).toContain('Calculator')
    expect(findBestStartApp(candidates, 'calc')?.appId).toContain('Calculator')
  })

  it('returns null when nothing matches', () => {
    expect(findBestStartApp(candidates, 'programa inexistente xyz')).toBeNull()
  })
})

describe('isShellAppsFolderPath', () => {
  it('detects store launch paths', () => {
    expect(isShellAppsFolderPath('shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')).toBe(true)
    expect(isShellAppsFolderPath('C:\\Windows\\System32\\calc.exe')).toBe(false)
  })
})

describe('foreground escalation guard', () => {
  it('requires escalation only for foreground delivery or unavailable background', () => {
    expect(requiresForegroundEscalation({ ok: true, delivery: 'background', method: 'invoke' })).toBe(false)
    expect(requiresForegroundEscalation({ ok: true, delivery: 'foreground', method: 'mouse' })).toBe(true)
    expect(requiresForegroundEscalation({ ok: false, error: 'background_unavailable for Chrome canvas' })).toBe(true)
  })

  it('blocks foreground when background-only or consent is missing', () => {
    expect(shouldBlockForeground({ backgroundOnly: true }, false)).toBe(true)
    expect(shouldBlockForeground({ backgroundOnly: true }, true)).toBe(false)
    expect(shouldBlockForeground({ backgroundOnly: false, askBeforeForeground: true }, false)).toBe(true)
    expect(shouldBlockForeground({ backgroundOnly: false, askBeforeForeground: false }, false)).toBe(false)
  })

  it('builds a consent message that names the app and promises restore', () => {
    const msg = buildForegroundConsentMessage('Calculadora', 'clicar em Salvar')
    expect(msg).toContain('Calculadora')
    expect(msg.toLowerCase()).toContain('segundo plano')
  })
})

describe('background settings defaults', () => {
  it('prefers background and asks before taking over', () => {
    expect(runs.defaultSettings().backgroundOnly).toBe(false)
    expect(runs.defaultSettings().askBeforeForeground).toBe(true)
  })
})
