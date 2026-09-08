/**
 * MomAI Desktop — page: history (expandable replay + timeline) and
 * guardrail controls. Composition only; state lives in hooks.
 */
import { registerRenderer } from './registry-bridge'
import DesktopRunCard from './components/DesktopRunCard'
import RunHistory from './components/RunHistory'
import DesktopControls from './components/DesktopControls'
import { useDesktopRuns } from './hooks/useDesktopRun'
import { useI18n } from './hooks/useI18n'

registerRenderer('momai-desktop-run', DesktopRunCard)

export default function MomAIDesktopPage() {
  const { t } = useI18n()
  const { runs } = useDesktopRuns()

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text">MomAI Desktop</h2>
          <p className="text-[12px] text-text-muted">
            {runs.length === 0 ? t('run.noRuns') : t('run.history')}
          </p>
        </div>

        <div className="rounded-2xl bg-card border border-border p-4">
          <RunHistory runs={runs} />
        </div>

        <DesktopControls />
      </div>
    </div>
  )
}
