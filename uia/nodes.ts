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

/* Calculator buttons expose localized names (Cinco/Five) and stable
   AutomationIds (num5Button/multiplyButton) instead of digits, so a query
   for "5" or "*" would otherwise miss. Resolving both sides to the same
   SendKeys-ready key keeps find/click working across locales. */
const CALCULATOR_DIGIT_WORDS = {
  zero: '0',
  um: '1',
  uma: '1',
  one: '1',
  dois: '2',
  duas: '2',
  two: '2',
  tres: '3',
  three: '3',
  quatro: '4',
  four: '4',
  cinco: '5',
  five: '5',
  seis: '6',
  six: '6',
  sete: '7',
  seven: '7',
  oito: '8',
  eight: '8',
  nove: '9',
  nine: '9',
}

const CALCULATOR_OPERATOR_KEYS = {
  'mais': '{+}',
  'adicionar': '{+}',
  'somar': '{+}',
  'plus': '{+}',
  'add': '{+}',
  'menos': '-',
  'subtrair': '-',
  'minus': '-',
  'subtract': '-',
  'vezes': '*',
  'multiplicar': '*',
  'multiplicar por': '*',
  'multiply': '*',
  'multiply by': '*',
  'times': '*',
  'dividir': '/',
  'dividido': '/',
  'divide': '/',
  'divided by': '/',
  'igual': '=',
  'igual a': '=',
  'equals': '=',
  'equal': '=',
  'virgula': ',',
  'comma': ',',
  'decimal': ',',
}

const SENDKEYS_ESCAPE_TOKEN = {
  '{': '{{}',
  '}': '{}}',
  '+': '{+}',
  '^': '{^}',
  '%': '{%}',
  '~': '{~}',
  '(': '{(}',
  ')': '{)}',
  '[': '{[}',
  ']': '{]}',
}

function escapeCalculatorChar(ch) {
  return SENDKEYS_ESCAPE_TOKEN[ch] || ch
}

/* Single SendKeys escape shared by every caller (goto addresses,
   calculator bursts): one table, one behavior, no drift. */
function escapeSendKeysChar(ch) {
  const key = String(ch || '')
  return SENDKEYS_ESCAPE_TOKEN[key] || key
}

function resolveCalculatorAutomationId(norm) {
  const compact = String(norm || '').replace(/\s+/g, '')
  const numMatch = compact.match(/^num([0-9])button$/)
  if (numMatch) return numMatch[1]
  if (compact === 'plusbutton' || compact === 'addbutton') return '{+}'
  if (compact === 'minusbutton' || compact === 'subtractbutton') return '-'
  if (compact === 'multiplybutton') return '*'
  if (compact === 'dividebutton') return '/'
  if (compact === 'equalsbutton' || compact === 'equalbutton') return '='
  if (compact === 'decimalseparatorbutton' || compact === 'decimalbutton') return ','
  return null
}

function resolveCalculatorKey(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return trimmed
  const norm = normalizeText(trimmed)
  if (!norm) return null
  if (CALCULATOR_DIGIT_WORDS[norm]) return CALCULATOR_DIGIT_WORDS[norm]
  if (CALCULATOR_OPERATOR_KEYS[norm]) return CALCULATOR_OPERATOR_KEYS[norm]
  const auto = resolveCalculatorAutomationId(norm)
  if (auto) return auto
  if (trimmed.length === 1) {
    const ch = trimmed
    if (/[0-9]/.test(ch)) return ch
    if (ch === '*' || ch === '/' || ch === '=' || ch === '-' || ch === '.' || ch === ',') return ch
    if (SENDKEYS_ESCAPE_TOKEN[ch]) return escapeCalculatorChar(ch)
    return null
  }
  return null
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
  const queryKey = resolveCalculatorKey(queryNorm)
  if (queryKey) {
    const nameKey = nameNorm ? resolveCalculatorKey(node.name) : null
    if (nameKey && nameKey === queryKey) return 1
    const autoId = node && node.automationId ? resolveCalculatorKey(node.automationId) : null
    if (autoId && autoId === queryKey) return 1
  }
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
  const n = normalizeRefInput(ref)
  if (!Number.isFinite(n)) return null
  return list.find((node) => node.ref === n) || null
}

/* Refs are displayed as [42] in snapshots, so models echo that back:
   accept brackets, whitespace and loose "ref 42" forms. Input without
   digits stays NaN and misses loudly downstream, as before. */
function normalizeRefInput(ref) {
  if (typeof ref === 'number') return ref
  const found = String(ref || '').match(/-?\d+/)
  return found ? Number(found[0]) : NaN
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
  resolveCalculatorKey,
  assignRefs,
  findNodes,
  getNodeByRef,
  formatNodeLine,
  formatSnapshotForLlm,
  isTreeOpaque,
  escapeSendKeysChar,
  normalizeRefInput,
}
