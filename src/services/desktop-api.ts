/**
 * Client for the MomAI Desktop extension routes.
 * Routes are manifest-driven (POST /runs, /run, /stop, /settings) and served
 * by the extension worker; responses wrap the tool result envelope.
 */
import { getSDK } from 'momai:sdk'

const EXT_ID = 'momai-desktop'

export interface RunStep {
  ts: string
  kind: string
  label: string
}

export interface DesktopRunSummary {
  id: string
  objective: string
  status: string
  totalSteps: number
  updatedAt: string
}

export interface DesktopRunDetail extends DesktopRunSummary {
  steps: RunStep[]
  currentStep: string
  lastAction: string
  snapshotId: string | null
}

export interface DesktopSettings {
  allowedApps: string[]
  recordVisuals: boolean
  maxSteps: number
  maxRunMinutes: number
  safeStop: boolean
}

export interface ReplayFrame {
  kind: 'image'
  label: string
  subtitle: string
  ts: string
  dataUrl: string
}

function unwrapInstruction<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const instruction = record.instruction
  if (typeof instruction !== 'string') return null
  try {
    return JSON.parse(instruction) as T
  } catch {
    return null
  }
}

async function postRoute<T>(route: string, body?: Record<string, unknown>): Promise<T | null> {
  const sdk = getSDK()
  const res = await sdk.api.post(`/extensions/${EXT_ID}${route}`, body || {})
  if (!res || res.ok !== true) return null
  return unwrapInstruction<T>(res.data) || (res.data as T)
}

export async function listRuns(limit = 10): Promise<DesktopRunSummary[]> {
  const parsed = await postRoute<{ runs: DesktopRunSummary[] }>('/runs', { limit })
  return parsed && Array.isArray(parsed.runs) ? parsed.runs : []
}

export async function getRun(runId?: string): Promise<DesktopRunDetail | null> {
  const parsed = await postRoute<{
    runId: string
    objective: string
    status: string
    totalSteps: number
    updatedAt: string
    steps: RunStep[]
  }>('/run', runId ? { runId } : {})
  if (!parsed) return null
  const steps = Array.isArray(parsed.steps) ? parsed.steps : []
  const last = steps.length > 0 ? steps[steps.length - 1].label : ''
  return {
    id: parsed.runId,
    objective: parsed.objective || '',
    status: parsed.status,
    totalSteps: parsed.totalSteps || steps.length,
    updatedAt: parsed.updatedAt || '',
    steps,
    currentStep: last,
    lastAction: last,
    snapshotId: null,
  }
}

export async function stopRun(runId: string): Promise<boolean> {
  const parsed = await postRoute<{ status: string }>('/stop', { runId })
  return !!parsed
}

export async function getFrames(runId: string): Promise<ReplayFrame[]> {
  const sdk = getSDK()
  const res = await sdk.api.post(`/extensions/${EXT_ID}/frames`, { runId })
  if (!res || res.ok !== true) return []
  const payload = res.data as { frames?: ReplayFrame[] }
  return payload && Array.isArray(payload.frames) ? payload.frames : []
}

export async function readSettings(): Promise<DesktopSettings | null> {
  const parsed = await postRoute<{ settings: DesktopSettings }>('/settings', {})
  return parsed ? parsed.settings : null
}

export async function writeSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings | null> {
  const parsed = await postRoute<{ settings: DesktopSettings }>('/settings', patch)
  return parsed ? parsed.settings : null
}

export function subscribeToRunEvents(handler: (data: { runId?: string }) => void): () => void {
  try {
    const sdk = getSDK()
    const offStep = sdk.events.subscribe('desktop_run_step', handler)
    const offDone = sdk.events.subscribe('desktop_run_finished', handler)
    return () => {
      try {
        offStep()
      } catch {
        /* ignore */
      }
      try {
        offDone()
      } catch {
        /* ignore */
      }
    }
  } catch {
    return () => {}
  }
}
