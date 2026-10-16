/**
 * Replay studio: the latest run inside a window-like frame — chrome bar with
 * the objective and status, the screen frames with their caption, and the
 * transport bar with the step filmstrip. Rendered only when a run exists.
 */
import { useEffect, useState } from 'react'
import { getFrames, type DesktopRunSummary, type ReplayFrame } from '../services/desktop-api'
import { useDesktopRun } from '../hooks/useDesktopRun'
import { useI18n } from '../hooks/useI18n'
import { runStatusLabel } from './runStatus'
import RunReplay from './RunReplay'

type ChipKind = 'active' | 'done' | 'stopped' | 'error'

function chipKind(status: string): ChipKind {
  if (status === 'active') return 'active'
  if (status === 'error') return 'error'
  if (status === 'stopped') return 'stopped'
  return 'done'
}

export default function ReplayCard({
  runs,
  icon,
}: {
  runs: DesktopRunSummary[]
  icon?: string
}) {
  const { t } = useI18n()
  const latest = runs.length > 0 ? runs[0] : null
  const latestId = latest ? latest.id : null
  const { run, stopping, stop } = useDesktopRun(latestId)
  const [frames, setFrames] = useState<ReplayFrame[]>([])
  const [truncated, setTruncated] = useState(false)
  const totalSteps = run ? run.totalSteps : 0

  // Reloads when the live run gains a step, so the screen follows the run
  // without a second frame poller.
  useEffect(() => {
    let cancelled = false
    if (!latestId) {
      setFrames([])
      setTruncated(false)
      return
    }
    getFrames(latestId)
      .then((result) => {
        if (cancelled) return
        setFrames(Array.isArray(result.frames) ? result.frames : [])
        setTruncated(result.truncated === true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [latestId, totalSteps])

  if (!latest) return null

  const status = run ? run.status : latest.status
  const kind = chipKind(status)
  const objective = (run && run.objective) || latest.objective || latest.id
  const steps = run ? run.totalSteps : latest.totalSteps

  return (
    <div className="mdx-frame">
      <div className="mdx-chrome">
        {icon ? (
          <span
            className="mdx-chrome-icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: icon }}
          />
        ) : null}
        <span className="text-xs text-text truncate flex-1">{objective}</span>
        <span className="text-xs text-text-muted flex-shrink-0">
          {steps} {t('run.steps')}
        </span>
        <span className={`mdx-chip mdx-chip--${kind}`}>
          {kind === 'active' ? <span className="mdx-live-dot" aria-hidden="true" /> : null}
          {runStatusLabel(status, t)}
        </span>
        {status === 'active' ? (
          <button
            type="button"
            disabled={stopping}
            onClick={stop}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border/40 text-text-muted hover:text-text hover:bg-input/60 disabled:opacity-50 flex-shrink-0"
          >
            {stopping ? t('run.stopping') : t('run.stop')}
          </button>
        ) : null}
      </div>
      {frames.length > 0 ? (
        <RunReplay frames={frames} truncated={truncated} player />
      ) : (
        <div className="mdx-screen flex items-center justify-center p-6 text-center">
          <p className="text-xs text-text-muted">{t('replay.empty')}</p>
        </div>
      )}
    </div>
  )
}
