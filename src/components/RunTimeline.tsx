/**
 * Step-by-step timeline of one desktop run.
 */
import type { RunStep } from '../services/desktop-api'
import { useI18n } from '../hooks/useI18n'

function stepDot(kind: string): string {
  if (kind === 'action') return 'bg-accent/70'
  if (kind === 'error') return 'bg-card border border-border'
  if (kind === 'pending') return 'bg-card border border-border'
  return 'bg-border/40'
}

export default function RunTimeline({ steps }: { steps: RunStep[] }) {
  const { t } = useI18n()
  if (!steps || steps.length === 0) {
    return <p className="text-[12px] text-text-muted">{t('run.noRuns')}</p>
  }
  return (
    <div className="flex flex-col ml-1 relative">
      <div className="absolute left-[7px] top-4 bottom-4 w-[2px] bg-border/20 rounded-full" />
      {steps.map((step, idx) => (
        <div
          key={`${step.ts || idx}-${idx}`}
          className="flex items-start gap-3 mb-3 last:mb-0 relative z-10"
        >
          <div
            className={`mt-1 w-[16px] h-[16px] rounded-full flex-shrink-0 border border-border/30 ${stepDot(step.kind)}`}
          />
          <div className="flex flex-col min-w-0 pt-[1px]">
            <span className="text-[13px] text-text leading-snug">{step.label}</span>
            {step.ts ? (
              <span className="text-[10px] text-text-muted font-mono">
                {new Date(step.ts).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
