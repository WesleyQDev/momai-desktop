/**
 * One history row: summary always visible, replay + timeline on expand.
 */
import { useEffect, useState } from 'react'
import type { DesktopRunSummary } from '../services/desktop-api'
import { getFrames, type ReplayFrame } from '../services/desktop-api'
import { useDesktopRun } from '../hooks/useDesktopRun'
import { useI18n } from '../hooks/useI18n'
import RunReplay from './RunReplay'
import RunTimeline from './RunTimeline'

export default function HistoryRow({ run }: { run: DesktopRunSummary }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [frames, setFrames] = useState<ReplayFrame[]>([])
  const { run: detail, stopping, stop } = useDesktopRun(expanded ? run.id : null)

  useEffect(() => {
    let cancelled = false
    setFrames([])
    if (!expanded) return
    getFrames(run.id)
      .then((list) => {
        if (!cancelled) setFrames(Array.isArray(list) ? list : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expanded, run.id])

  const steps = detail ? detail.steps : []
  const status = detail ? detail.status : run.status

  return (
    <div className="rounded-lg border border-border/30 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-3 py-2 hover:bg-input/60"
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-text truncate flex-1">
            {run.objective || run.id}
          </span>
          <span className="text-[10px] text-text-muted shrink-0">{status}</span>
          <span className="text-[10px] text-text-muted shrink-0">
            {run.totalSteps} {t('run.steps')}
          </span>
        </div>
      </button>
      {expanded ? (
        <div className="px-3 pb-3 flex flex-col gap-3 border-t border-border/30 pt-3">
          <RunReplay frames={frames} />
          <RunTimeline steps={steps} />
          {status === 'active' ? (
            <button
              type="button"
              disabled={stopping}
              onClick={stop}
              className="self-start px-3 py-1.5 rounded-lg text-xs font-semibold border border-border/30 text-text-muted hover:text-text disabled:opacity-50"
            >
              {stopping ? t('run.stopping') : t('run.stop')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
