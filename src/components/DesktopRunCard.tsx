/**
 * Final run card (shown once, when the task ends): the replay autoplayed
 * like a GIF — one captioned screenshot per tool call. No buttons;
 * clicking the image opens the page.
 */
import { useEffect, useState } from 'react'
import { navigateTo } from '../registry-bridge'
import { getFrames, type ReplayFrame } from '../services/desktop-api'
import { useI18n } from '../hooks/useI18n'

interface RunCardData {
  runId?: string
  status?: string
  objective?: string
  previewThumb?: string
}

const IMAGE_MS = 1500

function statusLabel(status: string, t: (k: string) => string): string {
  if (status === 'active') return t('run.active')
  if (status === 'done') return t('run.done')
  if (status === 'error') return t('run.error')
  if (status === 'stopped') return t('run.stopped')
  return status
}

export default function DesktopRunCard({ data }: { data?: RunCardData }) {
  const { t } = useI18n()
  const [slides, setSlides] = useState<ReplayFrame[]>([])
  const [index, setIndex] = useState(0)

  const runId = data?.runId
  const fallback = data?.previewThumb

  useEffect(() => {
    let cancelled = false
    setSlides([])
    setIndex(0)
    if (!runId) return
    getFrames(runId)
      .then((list) => {
        if (cancelled) return
        const usable = (list || []).filter(
          (f) => f && typeof f.dataUrl === 'string' && f.dataUrl.length > 0
        )
        if (usable.length > 0) {
          setSlides(usable)
        } else if (fallback) {
          setSlides([{ kind: 'image', label: '', subtitle: '', ts: '', dataUrl: fallback }])
        }
      })
      .catch(() => {
        if (!cancelled && fallback) {
          setSlides([{ kind: 'image', label: '', subtitle: '', ts: '', dataUrl: fallback }])
        }
      })
    return () => {
      cancelled = true
    }
  }, [runId, fallback])

  useEffect(() => {
    if (slides.length < 2) return
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % slides.length)
    }, IMAGE_MS)
    return () => clearTimeout(timer)
  }, [slides, index])

  if (!data || !runId) return null

  const current = slides.length > 0 ? slides[Math.min(index, slides.length - 1)] : null
  const status = String(data.status || 'done')

  return (
    <div className="my-2 rounded-2xl bg-card border border-border overflow-hidden">
      {current ? (
        <div onClick={() => navigateTo('/extensions/momai-desktop')} className="cursor-pointer">
          <img src={current.dataUrl} alt="" className="w-full aspect-video object-cover" />
          {current.label && (
            <p className="px-4 pt-2 text-[12px] font-semibold text-text truncate">
              {current.label}
            </p>
          )}
        </div>
      ) : null}
      <p className="px-4 py-2 text-[12px] text-text truncate">
        {data.objective || 'MomAI Desktop'}
        <span className="text-text-muted"> • {statusLabel(status, t)}</span>
      </p>
    </div>
  )
}
