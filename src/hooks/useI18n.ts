/**
 * MomAI Desktop UI strings for the six supported locales.
 * Unknown locales fall back to English; missing keys fall back en-US -> pt-BR.
 */
import { useCallback, useEffect, useState } from 'react'
import { getSDK } from 'momai:sdk'

const DEFAULT_LOCALE = 'en-US'

const STRINGS: Record<string, Record<string, string>> = {
  'pt-BR': {
    'run.live': 'Sessão ao vivo',
    'run.history': 'Histórico',
    'history.filter.all': 'Todas',
    'history.filter.active': 'Ativas',
    'history.filter.done': 'Concluídas',
    'history.filter.error': 'Com erro',
    'history.filter.empty': 'Nenhuma execução neste filtro',
    'run.noRuns': 'Nenhuma execução ainda. Peça no chat para automatizar algo no computador.',
    'run.noSteps': 'Nenhum passo registrado',
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
    'card.opaqueHint': 'A última tela não expôs botões nem campos (canvas ou app sem acessibilidade).',
    'replay.title': 'Replay',
    'replay.empty': 'Sem screenshots neste run. Ligue "Gravar replay visual" nos controles.',
    'replay.play': 'Reproduzir',
    'replay.pause': 'Pausar',
    'replay.truncated': 'replay parcial: nem todos os passos couberam nas imagens',
  },
  'en-US': {
    'run.live': 'Live session',
    'run.history': 'History',
    'history.filter.all': 'All',
    'history.filter.active': 'Active',
    'history.filter.done': 'Done',
    'history.filter.error': 'Errored',
    'history.filter.empty': 'No runs in this filter',
    'run.noRuns': 'No runs yet. Ask in chat to automate something on the computer.',
    'run.noSteps': 'No steps recorded',
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
    'card.opaqueHint': 'The last screen exposed no buttons or fields (canvas or app without accessibility).',
    'replay.title': 'Replay',
    'replay.empty': 'No screenshots in this run. Turn on "Record visual replay" in controls.',
    'replay.play': 'Play',
    'replay.pause': 'Pause',
    'replay.truncated': 'partial replay: not every step fit in the images',
  },
  es: {
    'run.live': 'Sesión en vivo',
    'run.history': 'Historial',
    'history.filter.all': 'Todas',
    'history.filter.active': 'Activas',
    'history.filter.done': 'Completadas',
    'history.filter.error': 'Con error',
    'history.filter.empty': 'Ninguna ejecución en este filtro',
    'run.noRuns': 'Aún no hay ejecuciones. Pídele al chat que automatice algo en la computadora.',
    'run.noSteps': 'Ningún paso registrado',
    'run.steps': 'pasos',
    'run.viewSteps': 'Ver paso a paso',
    'run.stop': 'Detener',
    'run.stopping': 'Deteniendo...',
    'run.stopped': 'Detenida',
    'run.active': 'En ejecución',
    'run.done': 'Completada',
    'run.error': 'Con error',
    'run.status': 'Estado',
    'run.objective': 'Objetivo',
    'run.timeline': 'Pasos',
    'controls.title': 'Controles',
    'controls.maxSteps': 'Pasos máximos por ejecución',
    'controls.maxMinutes': 'Minutos máximos (0 = sin límite)',
    'controls.limitsHint': 'La ejecución se detiene sola al alcanzar cualquier límite.',
    'controls.allowlist': 'Apps permitidas (vacío = todas)',
    'controls.allowlistHint': 'Solo automatiza esos programas. Vacío permite todo. Usa nombres de proceso, ej.: WINWORD, chrome.',
    'controls.safeStop': 'Detener si la ventana cambia sola',
    'controls.safeStopHint': 'Si otra ventana roba el foco durante la automatización, la ejecución se detiene en vez de actuar en la ventana equivocada.',
    'controls.visuals': 'Grabar replay visual',
    'controls.visualsHint': 'Guarda una captura por paso para el replay. Se queda solo en tu computadora.',
    'controls.save': 'Guardar',
    'controls.saved': 'Guardado',
    'card.openPage': 'Ver paso a paso',
    'card.openReplay': 'Ver replay',
    'card.opaqueHint': 'La última pantalla no expuso botones ni campos (canvas o app sin accesibilidad).',
    'replay.title': 'Replay',
    'replay.empty': 'Sin capturas en esta ejecución. Activa "Grabar replay visual" en los controles.',
    'replay.play': 'Reproducir',
    'replay.pause': 'Pausar',
    'replay.truncated': 'replay parcial: no todos los pasos caben en las imágenes',
  },
  fr: {
    'run.live': 'Session en direct',
    'run.history': 'Historique',
    'history.filter.all': 'Toutes',
    'history.filter.active': 'Actives',
    'history.filter.done': 'Terminées',
    'history.filter.error': 'En erreur',
    'history.filter.empty': 'Aucune exécution dans ce filtre',
    'run.noRuns': "Aucune exécution pour l'instant. Demandez au chat d'automatiser quelque chose sur l'ordinateur.",
    'run.noSteps': 'Aucune étape enregistrée',
    'run.steps': 'étapes',
    'run.viewSteps': 'Voir étape par étape',
    'run.stop': 'Arrêter',
    'run.stopping': 'Arrêt...',
    'run.stopped': 'Arrêtée',
    'run.active': 'En cours',
    'run.done': 'Terminée',
    'run.error': 'En erreur',
    'run.status': 'Statut',
    'run.objective': 'Objectif',
    'run.timeline': 'Étapes',
    'controls.title': 'Contrôles',
    'controls.maxSteps': 'Étapes max par exécution',
    'controls.maxMinutes': 'Minutes max (0 = sans limite)',
    'controls.limitsHint': "L'exécution s'arrête d'elle-même dès qu'une limite est atteinte.",
    'controls.allowlist': 'Applications autorisées (vide = toutes)',
    'controls.allowlistHint': 'Automatise uniquement ces programmes. Vide autorise tout. Utilisez les noms de processus, ex. : WINWORD, chrome.',
    'controls.safeStop': 'Arrêter si la fenêtre change seule',
    'controls.safeStopHint': "Si une autre fenêtre vole le focus pendant l'automatisation, l'exécution s'arrête au lieu d'agir sur la mauvaise fenêtre.",
    'controls.visuals': 'Enregistrer le replay visuel',
    'controls.visualsHint': "Enregistre une capture par étape pour le replay. Reste uniquement sur votre ordinateur.",
    'controls.save': 'Enregistrer',
    'controls.saved': 'Enregistré',
    'card.openPage': 'Voir étape par étape',
    'card.openReplay': 'Voir le replay',
    'card.opaqueHint': "Le dernier écran n'a exposé aucun bouton ni champ (canvas ou app sans accessibilité).",
    'replay.title': 'Replay',
    'replay.empty': "Aucune capture dans cette exécution. Activez « Enregistrer le replay visuel » dans les contrôles.",
    'replay.play': 'Lire',
    'replay.pause': 'Pause',
    'replay.truncated': 'replay partiel : toutes les étapes ne tiennent pas dans les images',
  },
  de: {
    'run.live': 'Live-Sitzung',
    'run.history': 'Verlauf',
    'history.filter.all': 'Alle',
    'history.filter.active': 'Aktiv',
    'history.filter.done': 'Abgeschlossen',
    'history.filter.error': 'Mit Fehler',
    'history.filter.empty': 'Keine Ausführung in diesem Filter',
    'run.noRuns': 'Noch keine Ausführungen. Bitte den Chat, etwas am Computer zu automatisieren.',
    'run.noSteps': 'Keine Schritte aufgezeichnet',
    'run.steps': 'Schritte',
    'run.viewSteps': 'Schritt für Schritt ansehen',
    'run.stop': 'Stoppen',
    'run.stopping': 'Wird gestoppt...',
    'run.stopped': 'Gestoppt',
    'run.active': 'Läuft',
    'run.done': 'Abgeschlossen',
    'run.error': 'Fehler',
    'run.status': 'Status',
    'run.objective': 'Ziel',
    'run.timeline': 'Schritte',
    'controls.title': 'Steuerung',
    'controls.maxSteps': 'Max. Schritte pro Ausführung',
    'controls.maxMinutes': 'Max. Minuten (0 = kein Limit)',
    'controls.limitsHint': 'Die Ausführung stoppt selbst, sobald ein Limit erreicht ist.',
    'controls.allowlist': 'Erlaubte Apps (leer = alle)',
    'controls.allowlistHint': 'Automatisiert nur diese Programme. Leer erlaubt alles. Prozessnamen verwenden, z. B. WINWORD, chrome.',
    'controls.safeStop': 'Stoppen, wenn das Fenster selbst wechselt',
    'controls.safeStopHint': 'Wenn ein anderes Fenster den Fokus stiehlt, stoppt die Ausführung, statt im falschen Fenster zu handeln.',
    'controls.visuals': 'Visuelles Replay aufzeichnen',
    'controls.visualsHint': 'Speichert einen Screenshot pro Schritt für das Replay. Bleibt nur auf Ihrem Computer.',
    'controls.save': 'Speichern',
    'controls.saved': 'Gespeichert',
    'card.openPage': 'Schritt für Schritt ansehen',
    'card.openReplay': 'Replay ansehen',
    'card.opaqueHint': 'Der letzte Bildschirm zeigte keine Schaltflächen oder Felder (Canvas oder App ohne Barrierefreiheit).',
    'replay.title': 'Replay',
    'replay.empty': 'Keine Screenshots in dieser Ausführung. „Visuelles Replay aufzeichnen" in den Steuerelementen aktivieren.',
    'replay.play': 'Abspielen',
    'replay.pause': 'Pausieren',
    'replay.truncated': 'Teil-Replay: nicht alle Schritte passen in die Bilder',
  },
  it: {
    'run.live': 'Sessione live',
    'run.history': 'Cronologia',
    'history.filter.all': 'Tutte',
    'history.filter.active': 'Attive',
    'history.filter.done': 'Completate',
    'history.filter.error': 'Con errore',
    'history.filter.empty': 'Nessuna esecuzione in questo filtro',
    'run.noRuns': 'Nessuna esecuzione ancora. Chiedi in chat di automatizzare qualcosa sul computer.',
    'run.noSteps': 'Nessun passaggio registrato',
    'run.steps': 'passaggi',
    'run.viewSteps': 'Vedi passo passo',
    'run.stop': 'Ferma',
    'run.stopping': 'Arresto...',
    'run.stopped': 'Fermata',
    'run.active': 'In esecuzione',
    'run.done': 'Completata',
    'run.error': 'Con errore',
    'run.status': 'Stato',
    'run.objective': 'Obiettivo',
    'run.timeline': 'Passaggi',
    'controls.title': 'Controlli',
    'controls.maxSteps': 'Passaggi massimi per esecuzione',
    'controls.maxMinutes': 'Minuti massimi (0 = senza limite)',
    'controls.limitsHint': "L'esecuzione si ferma da sola al raggiungimento di un limite.",
    'controls.allowlist': 'App consentite (vuoto = tutte)',
    'controls.allowlistHint': 'Automatizza solo questi programmi. Vuoto consente tutto. Usa i nomi dei processi, es.: WINWORD, chrome.',
    'controls.safeStop': 'Ferma se la finestra cambia da sola',
    'controls.safeStopHint': "Se un'altra finestra ruba il focus durante l'automazione, l'esecuzione si ferma invece di agire sulla finestra sbagliata.",
    'controls.visuals': 'Registra replay visivo',
    'controls.visualsHint': 'Salva uno screenshot per passaggio per il replay. Resta solo sul tuo computer.',
    'controls.save': 'Salva',
    'controls.saved': 'Salvato',
    'card.openPage': 'Vedi passo passo',
    'card.openReplay': 'Vedi replay',
    'card.opaqueHint': "L'ultima schermata non ha esposto pulsanti né campi (canvas o app senza accessibilità).",
    'replay.title': 'Replay',
    'replay.empty': 'Nessuno screenshot in questa esecuzione. Attiva "Registra replay visivo" nei controlli.',
    'replay.play': 'Riproduci',
    'replay.pause': 'Pausa',
    'replay.truncated': 'replay parziale: non tutti i passaggi rientrano nelle immagini',
  },
}

/* Locale ids that map 1:1; pt/en collapse to their regional variants and
   unknown languages fall back to English instead of Portuguese. */
const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
}

function resolveLocale(raw: unknown): string {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return DEFAULT_LOCALE
  return LOCALE_MAP[value.slice(0, 2)] || DEFAULT_LOCALE
}

function detectLocale(): string {
  try {
    const sdkLocale = getSDK()?.i18n?.getLocale?.()
    if (sdkLocale) return resolveLocale(sdkLocale)
  } catch {
    /* ignore */
  }
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language : ''
    if (nav) return resolveLocale(nav)
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE
}

export function useI18n() {
  const [locale, setLocale] = useState(detectLocale)
  useEffect(() => {
    try {
      return getSDK()?.i18n?.onLocaleChange?.((next: string) => {
        setLocale(resolveLocale(next))
      })
    } catch {
      return undefined
    }
  }, [])
  const t = useCallback(
    (key: string) =>
      STRINGS[locale]?.[key]
      || STRINGS[DEFAULT_LOCALE][key]
      || STRINGS['pt-BR'][key]
      || key,
    [locale]
  )
  return { t, locale }
}
