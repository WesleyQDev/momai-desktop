/**
 * MomAI Desktop — side panel: compact status of the latest run.
 */
import { navigateTo, registerRenderer } from './registry-bridge'
import DesktopRunCard from './components/DesktopRunCard'
import { useDesktopRun, useDesktopRuns } from './hooks/useDesktopRun'
import { useI18n } from './hooks/useI18n'

registerRenderer('momai-desktop-run', DesktopRunCard)

export default function MomAIDesktopPanel() {
  const { t } = useI18n()
  const { runs } = useDesktopRuns()
  const latestId = runs.length > 0 ? runs[0].id : null
  const { run } = useDesktopRun(latestId)

  return (
    <div className="p-3 flex flex-col gap-2">
      {run ? (
        <DesktopRunCard
          data={{
            runId: run.id,
            status: run.status,
            objective: run.objective,
          }}
        />
      ) : (
        <p className="text-[12px] text-text-muted">{t('run.noRuns')}</p>
      )}
      <button
        type="button"
        onClick={() => navigateTo('/extensions/momai-desktop')}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent/90 text-white hover:bg-accent"
      >
        {t('card.openPage')}
      </button>
    </div>
  )
}
