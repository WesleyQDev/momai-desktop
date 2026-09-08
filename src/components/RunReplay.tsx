/**
 * GIF-style replay: one screenshot per tool call, each with its caption
 * (step label + app context) overlaid below the image.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReplayFrame } from '../services/desktop-api'
import { useI18n } from '../hooks/useI18n'

const IMAGE_MS = 1500

export default function RunReplay({ frames }: { frames: ReplayFrame[] }) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    setIndex(0)
    setPlaying(true)
  }, [frames])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % frames.length)
    }, IMAGE_MS)
    return () => clearTimeout(timer)
  }, [playing, index, frames.length])

  const go = useCallback(
    (delta: number) => {
      setPlaying(false)
      setIndex((i) => (i + delta + frames.length) % Math.max(frames.length, 1))
    },
    [frames.length]
  )

  if (!frames || frames.length === 0) {
    return <p className="text-[12px] text-text-muted">{t('replay.empty')}</p>
  }
  const current = frames[Math.min(index, frames.length - 1)]

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl overflow-hidden border border-border/30 bg-main">
        <img src={current.dataUrl} alt="" className="w-full aspect-video object-cover" />
        {(current.label || current.subtitle) && (
          <div className="px-3 py-2 bg-main">
            {current.label && (
              <p className="text-[13px] font-semibold text-text truncate">{current.label}</p>
            )}
            {current.subtitle && (
              <p className="text-[11px] text-text-muted truncate">{current.subtitle}</p>
            )}
          </div>
        )}
      </div>
      <p className="text-[12px] text-text-muted">
        {index + 1}/{frames.length}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          className="px-2.5 py-1 rounded-lg text-xs border border-border/30 text-text-muted hover:text-text"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="px-3 py-1 rounded-lg text-xs font-semibold bg-accent/90 text-white hover:bg-accent"
        >
          {playing ? t('replay.pause') : t('replay.play')}
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          className="px-2.5 py-1 rounded-lg text-xs border border-border/30 text-text-muted hover:text-text"
        >
          ›
        </button>
      </div>
    </div>
  )
}
