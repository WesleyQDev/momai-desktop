/**
 * Fields of one settings section. The page owns the section list and the
 * view chrome (back button, title), so the component renders only the fields
 * of the requested view plus the save action.
 */
import { useEffect, useState } from 'react'
import { readSettings, writeSettings } from '../services/desktop-api'
import { useI18n } from '../hooks/useI18n'

export type ControlsView = 'overview' | 'limits' | 'apps' | 'safety'

const FIELD_BASE =
  'px-3 py-2 rounded-lg bg-input border border-border text-xs font-mono text-text placeholder:text-text-muted focus:outline-none focus:border-accent/40'
const TEXT_FIELD = `w-full ${FIELD_BASE}`
const NUM_FIELD = `mdx-input-num ${FIELD_BASE}`

export default function DesktopControls({ view }: { view: ControlsView }) {
  const { t } = useI18n()
  const [allowlist, setAllowlist] = useState('')
  const [visuals, setVisuals] = useState(true)
  const [safeStop, setSafeStop] = useState(true)
  const [maxSteps, setMaxSteps] = useState('50')
  const [maxMinutes, setMaxMinutes] = useState('10')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    readSettings()
      .then((settings) => {
        if (cancelled || !settings) return
        setAllowlist((settings.allowedApps || []).join(', '))
        setVisuals(settings.recordVisuals !== false)
        setSafeStop(settings.safeStop !== false)
        setMaxSteps(String(settings.maxSteps || 50))
        setMaxMinutes(String(settings.maxRunMinutes ?? 10))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const allowedApps = allowlist
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
      const next = await writeSettings({
        allowedApps,
        recordVisuals: visuals,
        safeStop,
        maxSteps: Number(maxSteps) || 50,
        maxRunMinutes: maxMinutes === '' ? 0 : Number(maxMinutes) || 0,
      })
      if (next) {
        setAllowlist((next.allowedApps || []).join(', '))
        setVisuals(next.recordVisuals !== false)
        setSafeStop(next.safeStop !== false)
        setMaxSteps(String(next.maxSteps || 50))
        setMaxMinutes(String(next.maxRunMinutes ?? 10))
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch {
      /* keep form state */
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mdx-settings">
      {view === 'limits' ? (
        <>
          <label className="mdx-row">
            <span className="text-sm text-text">{t('controls.maxSteps')}</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxSteps}
              onChange={(e) => setMaxSteps(e.target.value)}
              className={NUM_FIELD}
            />
          </label>
          <label className="mdx-row">
            <span className="text-sm text-text">{t('controls.maxMinutes')}</span>
            <input
              type="number"
              min={0}
              max={120}
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(e.target.value)}
              className={NUM_FIELD}
            />
          </label>
          <p className="text-xs text-text-muted">{t('controls.limitsHint')}</p>
        </>
      ) : null}

      {view === 'apps' ? (
        <>
          <input
            type="text"
            aria-label={t('controls.group.apps')}
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            placeholder="notepad, chrome"
            className={TEXT_FIELD}
          />
          <p className="text-xs text-text-muted">{t('controls.allowlistHint')}</p>
        </>
      ) : null}

      {view === 'safety' ? (
        <>
          <label className="mdx-toggle">
            <span className="mdx-toggle-text">
              <span className="text-sm text-text">{t('controls.safeStop')}</span>
              <span className="text-xs text-text-muted">{t('controls.safeStopHint')}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="mdx-switch"
              checked={safeStop}
              onChange={(e) => setSafeStop(e.target.checked)}
            />
          </label>
          <label className="mdx-toggle">
            <span className="mdx-toggle-text">
              <span className="text-sm text-text">{t('controls.visuals')}</span>
              <span className="text-xs text-text-muted">{t('controls.visualsHint')}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="mdx-switch"
              checked={visuals}
              onChange={(e) => setVisuals(e.target.checked)}
            />
          </label>
        </>
      ) : null}

      <div className="mdx-actions">
        {saved ? <span className="text-xs text-text-muted">{t('controls.saved')}</span> : null}
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-input hover:bg-input/80 border border-border text-text disabled:opacity-40 transition-colors shrink-0"
        >
          {t('controls.save')}
        </button>
      </div>
    </div>
  )
}
