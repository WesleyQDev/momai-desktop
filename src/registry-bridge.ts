/**
 * Registers chat-card renderers through the host SDK when available,
 * falling back to the global renderer shim injected by the host loader.
 */
import { getSDK } from 'momai:sdk'

export function registerRenderer(type: string, component: unknown): void {
  try {
    getSDK().registry.registerRenderer(type, component)
    return
  } catch {
    /* fall through to the global shim */
  }
  try {
    const g = globalThis as unknown as {
      __skillRendererRegistry?: { registerRenderer: (t: string, c: unknown) => void }
    }
    g.__skillRendererRegistry?.registerRenderer(type, component)
  } catch {
    /* renderer registration is best effort */
  }
}

export function navigateTo(path: string): void {
  try {
    window.dispatchEvent(new CustomEvent('momai_navigate', { detail: { path } }))
  } catch {
    /* navigation is best effort */
  }
}
