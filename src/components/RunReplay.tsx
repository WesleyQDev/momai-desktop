/**
 * GIF-style replay: one screenshot per tool call, each with its caption
 * (step label + app context). `player` renders the studio layout used by the
 * page — screen + caption and a transport bar with the step filmstrip —
 * while the default keeps the rounded inline card used by history rows.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReplayFrame } from '../services/desktop-api'
import { useI18n } from '../hooks/useI18n'

const IMAGE_MS = 1500

export default function RunReplay({
  frames,
  truncated,
  player = false,
}: {
  frames: ReplayFrame[]
  truncated?: boolean
  player?: boolean
}) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const stripRef = useRef<HTMLDivElement | null>(null)

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

  // Keep the current thumbnail in view without touching any other scroller.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const current = strip.querySelector<HTMLElement>('.mdx-thumb--current')
    if (!current) return
    const target = current.offsetLeft - (strip.clientWidth - current.clientWidth) / 2
    strip.scrollTo({ left: Math.max(0, target) })
  }, [index])

  const go = useCallback(
    (delta: number) => {
      setPlaying(false)
      setIndex((i) => (i + delta + frames.length) % Math.max(frames.length, 1))
    },
    [frames.length]
  )

  const select = useCallback((next: number) => {
    setPlaying(false)
    setIndex(next)
  }, [])

  if (!frames || frames.length === 0) {
    return <p className="text-[12px] text-text-muted">{t('replay.empty')}</p>
  }
  const current = frames[Math.min(index, frames.length - 1)]
  const counter = `${index + 1}/${frames.length}${
    truncated === true ? ` • ${t('replay.truncated')}` : ''
  }`

  const caption = (current.label || current.subtitle) && (
    <div className={player ? 'mdx-caption' : 'px-3 py-2 border-t border-border/40'}>
      {current.label && (
        <p className="text-[12px] font-semibold text-text truncate">{current.label}</p>
      )}
      {current.subtitle && (
        <p className="text-[11px] text-text-muted truncate">{current.subtitle}</p>
      )}
    </div>
  )

  const transport = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        type="button"
        onClick={() => go(-1)}
        className="px-2.5 py-1 rounded-lg text-xs border border-border/40 text-text-muted hover:text-text hover:bg-input/60"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        className="px-3 py-1 rounded-lg text-xs font-semibold bg-accent/90 text-bg hover:bg-accent"
      >
        {playing ? t('replay.pause') : t('replay.play')}
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        className="px-2.5 py-1 rounded-lg text-xs border border-border/40 text-text-muted hover:text-text hover:bg-input/60"
      >
        ›
      </button>
    </div>
  )

  if (player) {
    return (
      <div className="flex flex-col">
        <div className="mdx-screen">
          <img src={current.dataUrl} alt="" className="mdx-screen-img" />
          {caption}
        </div>
        <div className="mdx-transport">
          {transport}
          {frames.length > 1 ? (
            <div className="mdx-strip" ref={stripRef}>
              {frames.map((frame, i) => (
                <button
                  key={`${frame.ts}-${i}`}
                  type="button"
                  onClick={() => select(i)}
                  aria-label={`${i + 1}/${frames.length}`}
                  aria-current={i === index}
                  className={`mdx-thumb${i === index ? ' mdx-thumb--current' : ''}`}
                >
                  <img src={frame.dataUrl} alt="" />
                </button>
              ))}
            </div>
          ) : (
            <span className="flex-1" />
          )}
          <p className="text-xs text-text-muted tabular-nums flex-shrink-0">{counter}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl overflow-hidden border border-border/40 bg-input/40">
        <img
          src={current.dataUrl}
          alt=""
          className="w-full block object-cover"
          style={{ aspectRatio: '16 / 9' }}
        />
        {caption}
      </div>
      <p className="text-[12px] text-text-muted">{counter}</p>
      {transport}
    </div>
  )
}
