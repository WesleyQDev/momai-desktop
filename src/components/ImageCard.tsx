/**
 * Chat card for `desktop_show_image`: every print is rendered as its OWN card
 * (full width, uncropped) instead of one cramped scrollable list, and clicking
 * one opens the full view. Registered as `momai-desktop-image`.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ShownImage {
  url: string
  label?: string
}

interface ImageCardData {
  title?: string
  images?: ShownImage[]
}

const ExpandIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
)

const CloseIcon = ({ className = '' }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

/** Full-area view of one print; closes on click, Esc or the close button. */
function FullView({ image, onClose }: { image: ShownImage; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.label || 'Imagem'}
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <img
        src={image.url}
        alt={image.label || ''}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 rounded-lg bg-card p-2 text-text shadow-xl transition-colors hover:bg-input"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>,
    document.body
  )
}

export default function ImageCard({ data }: { data?: ImageCardData }) {
  const images = (Array.isArray(data?.images) ? data!.images : []).filter(
    (image) => image && typeof image.url === 'string' && image.url.length > 0
  )
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (images.length === 0) return null

  const opened = openIndex === null ? null : images[openIndex] || null

  return (
    <div className="my-2 flex flex-col gap-2">
      {data?.title ? <p className="text-[12px] font-semibold text-text">{data.title}</p> : null}
      {images.map((image, index) => (
        <button
          key={`${image.url.slice(-32)}-${index}`}
          type="button"
          onClick={() => setOpenIndex(index)}
          className="group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border bg-card"
        >
          <img
            src={image.url}
            alt={image.label || ''}
            className="max-h-[70vh] w-full bg-input/30 object-contain"
          />
          <span className="absolute top-2 right-2 rounded-lg bg-card/85 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <ExpandIcon className="h-4 w-4 text-text-muted" />
          </span>
        </button>
      ))}
      {opened ? <FullView image={opened} onClose={() => setOpenIndex(null)} /> : null}
    </div>
  )
}
