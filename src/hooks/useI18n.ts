/**
 * Minimal pt-BR/en-US strings for the MomAI Desktop UI.
 */
import { useCallback, useEffect, useState } from 'react'
import { getSDK } from 'momai:sdk'

const STRINGS: Record<string, Record<string, string>> = {
  'pt-BR': {
    'run.live': 'Sessão ao vivo',
    'run.history': 'Histórico',
    'history.filter.all': 'Todas',
    'history.filter.active': 'Ativas',
    'history.filter.done': 'Concluídas',
    'history.filter.error': 'Com erro',
    'run.noRuns': 'Nenhuma execução ainda. Peça no chat para automatizar algo no computador.',
    'run.steps': 'passos',
    'run.viewSteps': 'Ver passo a passo',
    'run.stop': 'Parar',
    'run.stopping': 'Parando...',
    'run.stopped': 'Parada',
    'run.active': 'Em execução',
    'run.done': 'Concluída',
    'run.error': 'Com erro',
    'run.status': 'Status',
    'run.objective': 'Objetivo',
    'run.timeline': 'Passos',
    'controls.title': 'Controles',
    'controls.maxSteps': 'Passos máximos por execução',
    'controls.maxMinutes': 'Minutos máximos (0 = sem limite)',
    'controls.limitsHint': 'A execução para sozinha ao bater em qualquer limite.',
    'controls.allowlist': 'Apps permitidos (vazio = todos)',
    'controls.allowlistHint': 'Só automatiza nos programas dessa lista. Vazio libera tudo. Use nomes de processo, ex.: WINWORD, chrome.',
    'controls.safeStop': 'Parar se a janela trocar sozinha',
    'controls.safeStopHint': 'Se outra janela roubar o foco no meio da automação, a execução para em vez de agir na janela errada.',
    'controls.visuals': 'Gravar replay visual',
    'controls.visualsHint': 'Salva um screenshot por passo para o replay. Fica só no seu computador.',
    'controls.save': 'Salvar',
    'controls.saved': 'Salvo',
    'card.openPage': 'Ver passo a passo',
    'card.openReplay': 'Ver replay',
    'replay.title': 'Replay',
    'replay.empty': 'Sem screenshots neste run. Ligue "Gravar replay visual" nos controles.',
    'replay.play': 'Reproduzir',
    'replay.pause': 'Pausar',
  },
  'en-US': {
    'run.live': 'Live session',
    'run.history': 'History',
    'history.filter.all': 'All',
    'history.filter.active': 'Active',
    'history.filter.done': 'Done',
    'history.filter.error': 'Errored',
    'run.noRuns': 'No runs yet. Ask in chat to automate something on the computer.',
    'run.steps': 'steps',
    'run.viewSteps': 'View step by step',
    'run.stop': 'Stop',
    'run.stopping': 'Stopping...',
    'run.stopped': 'Stopped',
    'run.active': 'Running',
    'run.done': 'Done',
    'run.error': 'Error',
    'run.status': 'Status',
    'run.objective': 'Goal',
    'run.timeline': 'Steps',
    'controls.title': 'Controls',
    'controls.maxSteps': 'Max steps per run',
    'controls.maxMinutes': 'Max minutes (0 = no limit)',
    'controls.limitsHint': 'The run stops itself when any limit is hit.',
    'controls.allowlist': 'Allowed apps (empty = all)',
    'controls.allowlistHint': 'Only automates in these listed programs. Empty allows all. Use process names, e.g.: WINWORD, chrome.',
    'controls.safeStop': 'Stop if the window switches by itself',
    'controls.safeStopHint': 'If another window steals focus mid-run, the run stops instead of acting on the wrong window.',
    'controls.visuals': 'Record visual replay',
    'controls.visualsHint': 'Saves one screenshot per step for the replay. Stays on your computer only.',
    'controls.save': 'Save',
    'controls.saved': 'Saved',
    'card.openPage': 'View step by step',
    'card.openReplay': 'View replay',
    'replay.title': 'Replay',
    'replay.empty': 'No screenshots in this run. Turn on "Record visual replay" in controls.',
    'replay.play': 'Play',
    'replay.pause': 'Pause',
  },
}

function detectLocale(): string {
  try {
    const sdkLocale = getSDK()?.i18n?.getLocale?.()
    if (sdkLocale && sdkLocale.toLowerCase().startsWith('en')) return 'en-US'
  } catch {
    /* ignore */
  }
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language : ''
    if (nav && nav.toLowerCase().startsWith('en')) return 'en-US'
  } catch {
    /* ignore */
  }
  return 'pt-BR'
}

export function useI18n() {
  const [locale, setLocale] = useState(detectLocale)
  useEffect(() => {
    try {
      return getSDK()?.i18n?.onLocaleChange?.((next: string) => {
        setLocale(next && next.toLowerCase().startsWith('en') ? 'en-US' : 'pt-BR')
      })
    } catch {
      return undefined
    }
  }, [])
  const t = useCallback(
    (key: string) => STRINGS[locale][key] || STRINGS['pt-BR'][key] || key,
    [locale]
  )
  return { t, locale }
}
