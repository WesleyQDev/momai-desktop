/**
 * Translates a run status for user-facing labels. Unknown statuses pass
 * through unchanged so a future backend status still renders.
 */
export function runStatusLabel(status: string, t: (key: string) => string): string {
  if (status === 'active') return t('run.active')
  if (status === 'done') return t('run.done')
  if (status === 'error') return t('run.error')
  if (status === 'stopped') return t('run.stopped')
  return status
}
