/**
 * Guardrail controls: run limits, app allowlist, safe-stop on focus
 * change, visual replay. Each control carries a one-line explanation.
 */
import { useEffect, useState } from 'react'
import { readSettings, writeSettings } from '../services/desktop-api'
import { useI18n } from '../hooks/useI18n'

export default function DesktopControls() {
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
    <div className="rounded-2xl bg-card border border-border p-4 flex flex-col gap-3">
      <h3 className="text-[13px] font-semibold text-text">{t('controls.title')}</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[12px] text-text">
          {t('controls.maxSteps')}
          <input
            type="number"
            min={1}
            max={100}
            value={maxSteps}
            onChange={(e) => setMaxSteps(e.target.value)}
            className="px-3 py-2 rounded-lg bg-input/60 border border-border/30 text-text text-[12px] font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-text">
          {t('controls.maxMinutes')}
          <input
            type="number"
            min={0}
            max={120}
            value={maxMinutes}
            onChange={(e) => setMaxMinutes(e.target.value)}
            className="px-3 py-2 rounded-lg bg-input/60 border border-border/30 text-text text-[12px] font-mono"
          />
        </label>
      </div>
      <p className="text-[11px] text-text-muted -mt-1">{t('controls.limitsHint')}</p>
      <label className="flex flex-col gap-1.5 text-[12px] text-text">
        {t('controls.allowlist')}
        <input
          type="text"
          value={allowlist}
          onChange={(e) => setAllowlist(e.target.value)}
          placeholder="notepad, chrome"
          className="px-3 py-2 rounded-lg bg-input/60 border border-border/30 text-text text-[12px] font-mono"
        />
        <span className="text-[11px] text-text-muted">{t('controls.allowlistHint')}</span>
      </label>
      <label className="flex flex-col gap-1 cursor-pointer">
        <span className="flex items-center gap-2 text-[12px] text-text">
          <input
            type="checkbox"
            checked={safeStop}
            onChange={(e) => setSafeStop(e.target.checked)}
            className="accent-current"
          />
          {t('controls.safeStop')}
        </span>
        <span className="text-[11px] text-text-muted">{t('controls.safeStopHint')}</span>
      </label>
      <label className="flex flex-col gap-1 cursor-pointer">
        <span className="flex items-center gap-2 text-[12px] text-text">
          <input
            type="checkbox"
            checked={visuals}
            onChange={(e) => setVisuals(e.target.checked)}
            className="accent-current"
          />
          {t('controls.visuals')}
        </span>
        <span className="text-[11px] text-text-muted">{t('controls.visualsHint')}</span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent/90 text-white hover:bg-accent disabled:opacity-50"
        >
          {saving ? '...' : t('controls.save')}
        </button>
        {saved ? (
          <span className="text-[11px] text-text-muted">{t('controls.saved')}</span>
        ) : null}
      </div>
    </div>
  )
}
