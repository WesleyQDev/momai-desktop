const INTERACTIVE_CONTROLS = new Set([
  'button',
  'checkbox',
  'radiobutton',
  'combobox',
  'edit',
  'list',
  'listitem',
  'menu',
  'menuitem',
  'menubar',
  'tab',
  'tabitem',
  'tree',
  'treeitem',
  'hyperlink',
  'splitbutton',
  'slider',
  'spinner',
  'thumb',
  'scrollbar',
  'toolbar',
  'window',
  'document',
  'pane',
])

const MAX_NODES_DEFAULT = 120
const MAX_DEPTH_DEFAULT = 8

function normalizeText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function hasValidRect(rect) {
  return (
    !!rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.w) &&
    Number.isFinite(rect.h) &&
    rect.w > 0 &&
    rect.h > 0
  )
}

function controlKey(raw) {
  return normalizeText(raw && raw.control ? raw.control : '').replace(/\s+/g, '')
}

function isNodeUseful(raw, maxDepth) {
  if (!raw || typeof raw !== 'object') return false
  if (raw.offscreen) return false
  if (raw.enabled === false) return false
  if (typeof raw.depth === 'number' && raw.depth > maxDepth) return false
  if (!hasValidRect(raw.rect)) return false
  const key = controlKey(raw)
  const name = String(raw.name || '').trim()
  if (INTERACTIVE_CONTROLS.has(key)) return true
  // Named nodes of any other type are still useful landmarks for the model.
  if (name.length > 0) return true
  return false
}

function scoreNode(node, queryNorm) {
  if (!queryNorm) return 0
  const nameNorm = normalizeText(node.name)
  if (!nameNorm) return 0
  if (nameNorm === queryNorm) return 1
  if (nameNorm.includes(queryNorm)) return 0.8
  const qWords = queryNorm.split(/\s+/).filter((w) => w.length > 1)
  if (qWords.length === 0) return 0
  let hits = 0
  for (const w of qWords) {
    if (nameNorm.includes(w)) hits++
  }
  if (hits === 0) return 0
  return 0.3 + (hits / qWords.length) * 0.4
}

/**
 * Filters raw UIA nodes, assigns stable numeric refs and caps the list so the
 * snapshot stays small enough for a text-only model prompt.
 */
function assignRefs(rawNodes, opts) {
  const maxNodes = opts && opts.maxNodes ? opts.maxNodes : MAX_NODES_DEFAULT
  const maxDepth = opts && opts.maxDepth ? opts.maxDepth : MAX_DEPTH_DEFAULT
  const list = Array.isArray(rawNodes) ? rawNodes : []
  const useful = []
  const seen = new Set()
  for (const raw of list) {
    if (!isNodeUseful(raw, maxDepth)) continue
    // Collapse exact duplicates (same role, name and rectangle) that some
    // frameworks expose once per visual layer.
    const rect = raw.rect
    const digest = `${controlKey(raw)}|${String(raw.name || '')}|${rect.x},${rect.y},${rect.w},${rect.h}`
    if (seen.has(digest)) continue
    seen.add(digest)
    useful.push(raw)
    if (useful.length >= maxNodes * 3) break
  }
  // Prefer shallow, named, interactive nodes when truncating.
  useful.sort((a, b) => {
    const da = typeof a.depth === 'number' ? a.depth : 99
    const db = typeof b.depth === 'number' ? b.depth : 99
    if (da !== db) return da - db
    const na = String(a.name || '').length > 0 ? 0 : 1
    const nb = String(b.name || '').length > 0 ? 0 : 1
    if (na !== nb) return na - nb
    const ka = INTERACTIVE_CONTROLS.has(controlKey(a)) ? 0 : 1
    const kb = INTERACTIVE_CONTROLS.has(controlKey(b)) ? 0 : 1
    return ka - kb
  })
  const truncated = useful.length > maxNodes
  const nodes = useful.slice(0, maxNodes).map((raw, idx) => ({
    ref: idx + 1,
    control: String(raw.control || ''),
    name: String(raw.name || ''),
    automationId: String(raw.automationId || ''),
    rect: {
      x: Math.round(raw.rect.x),
      y: Math.round(raw.rect.y),
      w: Math.round(raw.rect.w),
      h: Math.round(raw.rect.h),
    },
    enabled: raw.enabled !== false,
    depth: typeof raw.depth === 'number' ? raw.depth : 0,
    path: Array.isArray(raw.path) ? raw.path : [],
    patterns: raw.patterns && typeof raw.patterns === 'object' ? raw.patterns : {},
  }))
  return { nodes, truncated, totalSeen: list.length }
}

/**
 * Finds nodes by visible name, optionally restricted to a control role.
 */
function findNodes(nodes, query, role) {
  const list = Array.isArray(nodes) ? nodes : []
  const queryNorm = normalizeText(query)
  const roleNorm = normalizeText(role)
  const scored = []
  for (const node of list) {
    if (roleNorm && normalizeText(node.control).replace(/\s+/g, '') !== roleNorm.replace(/\s+/g, '')) continue
    const score = scoreNode(node, queryNorm)
    if (score > 0) scored.push({ node, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 10).map((s) => s.node)
}

function getNodeByRef(nodes, ref) {
  const list = Array.isArray(nodes) ? nodes : []
  const n = Number(ref)
  if (!Number.isFinite(n)) return null
  return list.find((node) => node.ref === n) || null
}

function formatNodeLine(node) {
  const label = node.name ? ` "${node.name}"` : ''
  const r = node.rect
  return `[${node.ref}] ${node.control}${label} (${r.x},${r.y} ${r.w}x${r.h})`
}

/**
 * Renders a snapshot as compact text lines for the model instruction.
 */
function formatSnapshotForLlm(snapshot, maxLines) {
  const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  const limit = maxLines && maxLines > 0 ? maxLines : 60
  const lines = nodes.slice(0, limit).map(formatNodeLine)
  if (nodes.length > limit) lines.push(`... +${nodes.length - limit} more (use desktop_find to search)`)
  return lines.join('\n')
}

/**
 * True when the tree exposes nothing actionable (only nameless containers
 * like Pane/Document): the screen is opaque to UI Automation (Electron
 * without accessibility, canvas, custom-drawn UI). Callers must switch
 * to the vision fallback instead of re-snapshotting in hope.
 */
function isTreeOpaque(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  if (list.length === 0) return true
  // Pure containers (even named) are not something the model can act on:
  // a bare viewport Document (Electron/Chromium shell) counts as opaque —
  // real windows always expose their chrome buttons alongside it.
  const containers = new Set(['pane', 'window', 'document'])
  return !list.some((node) => {
    if (!node || typeof node !== 'object') return false
    if (String(node.name || '').trim().length === 0) return false
    const key = controlKey(node)
    if (containers.has(key)) return false
    return INTERACTIVE_CONTROLS.has(key)
  })
}

module.exports = {
  INTERACTIVE_CONTROLS,
  normalizeText,
  assignRefs,
  findNodes,
  getNodeByRef,
  formatNodeLine,
  formatSnapshotForLlm,
  isTreeOpaque,
}
