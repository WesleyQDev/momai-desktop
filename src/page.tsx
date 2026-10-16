/**
 * MomAI Desktop — page. Same shape as the MomAI Code page: hero with the
 * icon, a mono title and rotating tips, then the replay studio (only when a
 * run exists), the history, and one row per settings section. Each settings
 * row opens its own view with a back button, the section title and just its
 * fields. Composition only; state lives in hooks.
 */
import { Fragment, useEffect, useState } from 'react'
import { useExtensionVisibility } from 'momai:sdk'
import { registerRenderer } from './registry-bridge'
import DesktopRunCard from './components/DesktopRunCard'
import ImageCard from './components/ImageCard'
import ReplayCard from './components/ReplayCard'
import RunHistory from './components/RunHistory'
import DesktopControls, { type ControlsView } from './components/DesktopControls'
import { useDesktopRuns } from './hooks/useDesktopRun'
import { useI18n } from './hooks/useI18n'

registerRenderer('momai-desktop-run', DesktopRunCard)
registerRenderer('momai-desktop-image', ImageCard)

/** Rotating usage tips under the hero, same pattern as the MomAI Code page. */
const TIP_KEYS = [
  'tips.1',
  'tips.2',
  'tips.3',
  'tips.4',
  'tips.5',
  'tips.6',
  'tips.7',
  'tips.8',
] as const
const TIP_INTERVAL_MS = 7000

/** Fisher-Yates shuffle so the first tip and every following one is random. */
function shuffledTipKeys(): string[] {
  const keys: string[] = [...TIP_KEYS]
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
  }
  return keys
}

/** One settings section per row; each one opens its own view. */
const CONTROLS_SECTIONS: Array<{
  view: Exclude<ControlsView, 'overview'>
  titleKey: string
  descKey: string
  openKey: string
}> = [
  {
    view: 'limits',
    titleKey: 'controls.group.limits',
    descKey: 'controls.limits.desc',
    openKey: 'controls.limits.open',
  },
  {
    view: 'apps',
    titleKey: 'controls.group.apps',
    descKey: 'controls.apps.desc',
    openKey: 'controls.apps.open',
  },
  {
    view: 'safety',
    titleKey: 'controls.group.safety',
    descKey: 'controls.safety.desc',
    openKey: 'controls.safety.open',
  },
]

/* Page-local styling. The host Tailwind content scan does not cover extension
   sources, so everything the page builds on top of the shared utility classes
   lives here. Every color comes from the host theme tokens. */
const PAGE_CSS = `
.mdx-hero-icon svg {
  width: 36px;
  height: 36px;
  display: block;
}
/* Settings sections: two shared columns (text, button) so all three buttons
   get the same width in every language. Spacing matches the MomAI Code page
   (gap-10 between sections plus the extra half step). */
.mdx-sections {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 1rem;
  row-gap: 3rem;
  align-items: start;
}
/* Section buttons share one width so the rows line up, like the MomAI Code
   page: the grid column sizes to the longest label and every button fills it. */
.mdx-open {
  width: 100%;
}
/* Studio frame: window-like surface — title bar, screen, transport with a
   filmstrip of the captured steps. */
.mdx-frame {
  border: 1px solid rgb(var(--border) / 0.6);
  border-radius: 12px;
  background: rgb(var(--bg-card) / 0.4);
  overflow: hidden;
  min-width: 0;
}
.mdx-chrome {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  border-bottom: 1px solid rgb(var(--border) / 0.5);
}
.mdx-chrome-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.mdx-chrome-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}
.mdx-screen {
  background: rgb(var(--bg-input) / 0.35);
}
.mdx-screen-img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  max-height: 340px;
  object-fit: contain;
}
.mdx-caption {
  padding: 0.5rem 0.8rem;
  border-top: 1px solid rgb(var(--border) / 0.4);
}
.mdx-transport {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.8rem;
  border-top: 1px solid rgb(var(--border) / 0.5);
}
/* Filmstrip: thumbnails of the captured steps, current one highlighted. */
.mdx-strip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 1px;
}
.mdx-strip::-webkit-scrollbar {
  height: 0;
  display: none;
}
.mdx-thumb {
  flex-shrink: 0;
  width: 46px;
  height: 26px;
  padding: 0;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgb(var(--border) / 0.6);
  background: rgb(var(--bg-input) / 0.6);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.15s ease, box-shadow 0.15s ease;
}
.mdx-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mdx-thumb:hover {
  opacity: 0.9;
}
.mdx-thumb--current {
  opacity: 1;
  box-shadow: 0 0 0 1px rgb(var(--accent));
}
/* Settings views: one short row per field — label left, control right. */
.mdx-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.mdx-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-width: 0;
}
.mdx-input-num {
  width: 4.5rem;
  text-align: center;
  flex-shrink: 0;
}
.mdx-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  cursor: pointer;
  padding: 0.5rem 0.6rem;
  margin: 0 -0.6rem;
  border-radius: 10px;
  transition: background 0.15s ease;
}
.mdx-toggle:hover {
  background: rgb(var(--bg-input) / 0.45);
}
.mdx-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
/* Switch: native checkbox styled with theme tokens. */
.mdx-switch {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 36px;
  height: 20px;
  margin: 0;
  flex-shrink: 0;
  border-radius: 9999px;
  background: rgb(var(--bg-input));
  box-shadow: inset 0 0 0 1px rgb(var(--border) / 0.6);
  cursor: pointer;
  transition: background 0.15s ease;
}
.mdx-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  background: rgb(var(--text-muted));
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
  transition: transform 0.15s ease, background 0.15s ease;
}
.mdx-switch:checked {
  background: rgb(var(--accent) / 0.85);
  box-shadow: inset 0 0 0 1px rgb(var(--accent) / 0.55);
}
.mdx-switch:checked::after {
  transform: translateX(16px);
  background: rgb(var(--text-primary));
}
.mdx-switch:focus-visible {
  outline: 2px solid rgb(var(--accent));
  outline-offset: 2px;
}
.mdx-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  padding-top: 0.5rem;
}
.mdx-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0.6rem;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.mdx-chip--active {
  color: rgb(var(--text-primary));
  background: rgb(var(--accent) / 0.16);
  box-shadow: inset 0 0 0 1px rgb(var(--accent) / 0.45);
}
.mdx-chip--done,
.mdx-chip--stopped {
  color: rgb(var(--text-muted));
  background: rgb(var(--bg-input) / 0.7);
  box-shadow: inset 0 0 0 1px rgb(var(--border) / 0.4);
}
.mdx-chip--error {
  color: rgb(var(--error));
  background: rgb(var(--error) / 0.12);
  box-shadow: inset 0 0 0 1px rgb(var(--error) / 0.35);
}
.mdx-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgb(var(--accent));
  animation: mdx-pulse 1.8s ease-in-out infinite;
}
@keyframes mdx-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
[data-a11y-motion='reduced'] .mdx-live-dot { animation: none; }
[data-a11y-motion='reduced'] .mdx-switch,
[data-a11y-motion='reduced'] .mdx-switch::after,
[data-a11y-motion='reduced'] .mdx-toggle,
[data-a11y-motion='reduced'] .mdx-thumb { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .mdx-live-dot { animation: none; }
  .mdx-switch,
  .mdx-switch::after,
  .mdx-toggle,
  .mdx-thumb { transition: none; }
}
`

interface PageManifest {
  name?: string
  sidebar_icon?: string | null
}

interface PageProps {
  isActive?: boolean
  manifest?: PageManifest
}

/** The sidebar icon ships as an inline SVG in the manifest; only that shape
 *  is inlined, anything else falls back to the title without artwork. */
function inlineSvg(value: unknown): string {
  if (typeof value !== 'string') return ''
  const svg = value.trim()
  return svg.toLowerCase().startsWith('<svg') ? svg : ''
}

export default function MomAIDesktopPage(props?: PageProps) {
  const isPageActive = useExtensionVisibility(props?.isActive, 'momai-desktop')
  const { t } = useI18n()
  const { runs } = useDesktopRuns({ isActive: isPageActive })
  const [tipOrder] = useState<string[]>(shuffledTipKeys)
  const [tipIndex, setTipIndex] = useState(0)
  const [controlsView, setControlsView] = useState<ControlsView>('overview')
  const icon = inlineSvg(props?.manifest?.sidebar_icon)
  const name =
    typeof props?.manifest?.name === 'string' && props.manifest.name
      ? props.manifest.name
      : 'MomAI Desktop'
  const hasRuns = runs.length > 0

  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % tipOrder.length), TIP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [tipOrder])

  // Dedicated settings view: back button, section title, just its fields.
  if (controlsView !== 'overview') {
    const section = CONTROLS_SECTIONS.find((item) => item.view === controlsView)
    return (
      <div className="h-full overflow-y-auto bg-bg text-text p-6 md:p-8">
        <style>{PAGE_CSS}</style>
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4 border-b border-border/40 pb-6">
            <button
              type="button"
              onClick={() => setControlsView('overview')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-text bg-input hover:bg-input/80 border border-border transition-colors flex items-center gap-1.5"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              {t('controls.back')}
            </button>
          </div>

          <div>
            <h1 className="text-xl font-bold tracking-tight text-text">
              {section ? t(section.titleKey) : t('controls.title')}
            </h1>
            {section ? <p className="text-xs text-text-muted mt-1">{t(section.descKey)}</p> : null}
          </div>

          <DesktopControls view={controlsView} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-bg text-text p-6 md:p-8">
      <style>{PAGE_CSS}</style>
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Hero: identity + rotating tips (no static description). */}
        <header className="flex flex-col items-center text-center pb-2">
          {icon ? (
            <span
              className="mdx-hero-icon w-16 h-16 rounded-xl bg-card border border-border/60 flex items-center justify-center overflow-hidden select-none"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: icon }}
            />
          ) : null}
          <h1 className="mt-4 font-mono text-3xl font-bold tracking-tight text-text">
            {name}
            <span className="text-text-muted/60 select-none" aria-hidden="true">
              _
            </span>
          </h1>
          <p
            key={tipIndex}
            className="text-sm text-text-muted mt-3 max-w-xl leading-relaxed min-h-10 animate-slide-in-up"
          >
            {t(tipOrder[tipIndex])}
          </p>
        </header>

        {hasRuns ? <ReplayCard runs={runs} icon={icon} /> : null}

        {hasRuns ? (
          <section>
            <h3 className="text-sm font-semibold text-text">{t('run.history')}</h3>
            <div className="mt-3">
              <RunHistory runs={runs} />
            </div>
          </section>
        ) : null}

        <div className="mdx-sections">
          {CONTROLS_SECTIONS.map((item) => (
            <Fragment key={item.view}>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-text">{t(item.titleKey)}</h3>
                <p className="text-xs text-text-muted mt-1">{t(item.descKey)}</p>
              </div>
              <button
                type="button"
                onClick={() => setControlsView(item.view)}
                className="mdx-open px-4 py-2 rounded-lg text-xs font-semibold bg-input hover:bg-input/80 border border-border text-text transition-colors inline-flex items-center justify-center whitespace-nowrap"
              >
                {t(item.openKey)}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
