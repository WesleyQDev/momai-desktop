const SNAPSHOT_TTL_MS = 90_000
const MAX_RUNS = 30
const MAX_STEPS_PER_RUN = 100

const snapshots = new Map()
const runs = new Map()
let snapshotSeq = 0
let runSeq = 0
let settingsCache = null

function nowIso() {
  return new Date().toISOString()
}

function newSnapshotId() {
  snapshotSeq += 1
  return `snap-${Date.now().toString(36)}-${snapshotSeq}`
}

function newRunId() {
  runSeq += 1
  return `run-${Date.now().toString(36)}-${runSeq}`
}

/* ── Snapshots ─────────────────────────────── */

function putSnapshot(snapshot) {
  const id = newSnapshotId()
  snapshots.set(id, { snapshot, storedAt: Date.now() })
  // Bound cache size.
  if (snapshots.size > 20) {
    const oldest = snapshots.keys().next()
    if (!oldest.done) snapshots.delete(oldest.value)
  }
  return id
}

function getSnapshot(id) {
  if (!id) return null
  const entry = snapshots.get(id)
  if (!entry) return null
  if (Date.now() - entry.storedAt > SNAPSHOT_TTL_MS) {
    snapshots.delete(id)
    return null
  }
  return entry.snapshot
}

function latestSnapshot() {
  let best = null
  for (const [id, entry] of snapshots) {
    if (Date.now() - entry.storedAt > SNAPSHOT_TTL_MS) {
      snapshots.delete(id)
      continue
    }
    if (!best || entry.storedAt > best.storedAt) best = { id, ...entry }
  }
  return best
}

/* ── Runs ──────────────────────────────────── */

function createRun(objective) {
  const id = newRunId()
  const run = {
    id,
    objective: String(objective || '').slice(0, 200),
    status: 'active',
    steps: [],
    snapshotId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  runs.set(id, run)
  if (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next()
    if (!oldest.done) runs.delete(oldest.value)
  }
  return run
}

function getRun(id) {
  if (!id) return null
  return runs.get(id) || null
}

function latestActiveRun() {
  let best = null
  for (const run of runs.values()) {
    if (run.status !== 'active') continue
    if (!best || run.updatedAt > best.updatedAt) best = run
  }
  return best
}

function listRuns(limit) {
  const all = Array.from(runs.values()).sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1
  )
  const n = limit && limit > 0 ? Math.min(limit, MAX_RUNS) : 10
  return all.slice(0, n).map((run) => ({
    id: run.id,
    objective: run.objective,
    status: run.status,
    totalSteps: run.steps.length,
    updatedAt: run.updatedAt,
  }))
}

function appendStep(runId, step) {
  const run = runs.get(runId)
  if (!run) return null
  const entry: { ts: string; kind: string; label: string; detail: unknown; frame?: string; context?: string } = {
    ts: nowIso(),
    kind: String((step && step.kind) || 'info'),
    label: String((step && step.label) || '').slice(0, 300),
    detail: step && step.detail !== undefined ? step.detail : undefined,
  }
  if (step && typeof step.frame === 'string' && step.frame) entry.frame = step.frame
  if (step && typeof step.context === 'string' && step.context) entry.context = step.context.slice(0, 160)
  run.steps.push(entry)
  if (run.steps.length > MAX_STEPS_PER_RUN) {
    run.steps = run.steps.slice(run.steps.length - MAX_STEPS_PER_RUN)
  }
  run.updatedAt = nowIso()
  return run
}

function finishRun(runId, status) {
  const run = runs.get(runId)
  if (!run) return null
  run.status = status === 'error' ? 'error' : status === 'stopped' ? 'stopped' : 'done'
  run.updatedAt = nowIso()
  return run
}

/* ── Settings (allowlist, limits, replay, safe-stop) ───── */

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function defaultSettings() {
  return { allowedApps: [], recordVisuals: true, maxSteps: 50, maxRunMinutes: 10, safeStop: true }
}

async function loadSettings(momai) {
  if (settingsCache) return settingsCache
  settingsCache = defaultSettings()
  try {
    const stored = await momai.storage.get('desktop-settings')
    if (stored && typeof stored === 'object') {
      settingsCache = {
        allowedApps: Array.isArray(stored.allowedApps) ? stored.allowedApps : [],
        recordVisuals: stored.recordVisuals !== undefined ? stored.recordVisuals === true : true,
        maxSteps: clampInt(stored.maxSteps, 50, 1, 100),
        maxRunMinutes: clampInt(stored.maxRunMinutes, 10, 0, 120),
        safeStop: stored.safeStop !== undefined ? stored.safeStop === true : true,
      }
    }
  } catch {
    /* storage unavailable: keep in-memory defaults */
  }
  return settingsCache
}

async function saveSettings(momai, patch) {
  const current = await loadSettings(momai)
  settingsCache = {
    allowedApps: Array.isArray(patch.allowedApps) ? patch.allowedApps : current.allowedApps,
    recordVisuals: patch.recordVisuals !== undefined ? patch.recordVisuals === true : current.recordVisuals,
    maxSteps: patch.maxSteps !== undefined ? clampInt(patch.maxSteps, current.maxSteps, 1, 100) : current.maxSteps,
    maxRunMinutes: patch.maxRunMinutes !== undefined ? clampInt(patch.maxRunMinutes, current.maxRunMinutes, 0, 120) : current.maxRunMinutes,
    safeStop: patch.safeStop !== undefined ? patch.safeStop === true : current.safeStop,
  }
  try {
    await momai.storage.set('desktop-settings', settingsCache)
  } catch {
    /* best effort */
  }
  return settingsCache
}

function isAppAllowed(settings, appName) {
  if (!settings || !Array.isArray(settings.allowedApps) || settings.allowedApps.length === 0) return true
  const norm = String(appName || '').toLowerCase()
  return settings.allowedApps.some((a) => String(a || '').toLowerCase() === norm)
}

async function emitRunEvent(momai, eventType, data) {
  try {
    if (momai && typeof momai.sendEvent === 'function') {
      await momai.sendEvent(eventType, data)
    }
  } catch {
    /* events are best effort */
  }
}

/* ── Chat card ─────────────────────────────── */

function buildRunCard(run) {
  const steps = Array.isArray(run.steps) ? run.steps.slice(-6) : []
  const last = steps.length > 0 ? steps[steps.length - 1] : null
  return {
    type: 'momai-desktop-run',
    data: {
      extension: 'momai-desktop',
      runId: run.id,
      status: run.status,
      objective: run.objective,
      currentStep: last ? last.label : '',
      lastAction: last ? last.label : '',
      totalSteps: run.steps.length,
      steps: steps.map((s) => ({ ts: s.ts, kind: s.kind, label: s.label })),
      snapshotId: run.snapshotId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
  }
}

module.exports = {
  SNAPSHOT_TTL_MS,
  putSnapshot,
  getSnapshot,
  latestSnapshot,
  createRun,
  getRun,
  latestActiveRun,
  listRuns,
  appendStep,
  finishRun,
  defaultSettings,
  loadSettings,
  saveSettings,
  isAppAllowed,
  emitRunEvent,
  buildRunCard,
}
