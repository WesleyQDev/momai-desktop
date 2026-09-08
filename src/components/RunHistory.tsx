/**
 * Run history: status filter chips + expandable rows (replay + timeline).
 */
import { useMemo, useState } from 'react'
import type { DesktopRunSummary } from '../services/desktop-api'
import { useI18n } from '../hooks/useI18n'
import HistoryRow from './HistoryRow'

type Filter = 'all' | 'active' | 'done' | 'error'

const FILTERS: Filter[] = ['all', 'active', 'done', 'error']

export default function RunHistory({ runs }: { runs: DesktopRunSummary[] }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<Filter>('all')

  const visible = useMemo(() => {
    if (filter === 'all') return runs
    return runs.filter((r) => r.status === filter)
  }, [runs, filter])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
              filter === f
                ? 'bg-accent/15 border-accent/40 text-text'
                : 'border-border/30 text-text-muted hover:text-text'
            }`}
          >
            {t(`history.filter.${f}`)}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-[12px] text-text-muted">{t('run.noRuns')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visible.map((run) => (
            <HistoryRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}
