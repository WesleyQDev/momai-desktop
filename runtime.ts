const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')
const uiaNodes = require('./uia/nodes.ts')
const uiaProvider = require('./uia/provider.ts')
const desktopRuns = require('./desktop/runs.ts')

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Scan Cache
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const SCAN_CACHE = { items: null, vocab: null, timestamp: 0 }
const CACHE_TTL_MS = 60_000

function getEnv(key) {
  return String(process.env[key] || '').trim()
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Accent Normalization
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function normalizeAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Windows Indexing (PowerToys/Raycast style)
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function scanWindowsStartMenu() {
  const dirs = [
    path.join(getEnv('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(getEnv('PROGRAMDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ]
  const items = []
  const seen = new Set()

  for (const base of dirs) {
    if (!fs.existsSync(base)) continue
    try {
      walkDir(base, items, seen, 'Programa', 2)
    } catch {
      /* skip inaccessible */
    }
  }
  return items
}

function scanDesktop() {
  const items = []
  const seen = new Set()
  const dirs = [
    path.join(getEnv('USERPROFILE'), 'Desktop'),
    path.join(getEnv('PUBLIC'), 'Desktop'),
  ].filter(Boolean)

  for (const desktop of dirs) {
    if (!fs.existsSync(desktop)) continue
    try {
      walkDir(desktop, items, seen, 'Atalho', 2)
    } catch {
      /* skip */
    }
  }
  return items
}

function scanProgramFiles() {
  const dirs = [
    getEnv('LOCALAPPDATA') ? path.join(getEnv('LOCALAPPDATA'), 'Programs') : null,
    getEnv('PROGRAMFILES'),
    getEnv('PROGRAMFILES(X86)'),
  ].filter(Boolean)

  const items = []
  const seen = new Set()

  for (const base of dirs) {
    if (!fs.existsSync(base)) continue
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dirPath = path.join(base, entry.name)
        try {
          const subEntries = fs.readdirSync(dirPath, { withFileTypes: true })
          for (const sub of subEntries) {
            if (sub.name.endsWith('.exe') || sub.name.endsWith('.lnk')) {
              const fullPath = path.join(dirPath, sub.name)
              if (seen.has(fullPath)) continue
              seen.add(fullPath)
              const displayName = sub.name.replace(/\.(exe|lnk)$/i, '')
              items.push({
                name: displayName,
                path: fullPath,
                type: sub.name.endsWith('.lnk') ? 'Atalho' : 'Programa',
                category: inferCategory(displayName, dirPath),
              })
            }
          }
        } catch {
          /* skip inaccessible subdir */
        }
      }
    } catch {
      /* skip */
    }
  }
  return items
}

function scanAppDataPrograms() {
  const localAppData = getEnv('LOCALAPPDATA')
  if (!localAppData) return []

  const items = []
  const seen = new Set()
  const base = path.join(localAppData)

  try {
    const entries = fs.readdirSync(base, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const dirPath = path.join(base, entry.name)
      try {
        const subEntries = fs.readdirSync(dirPath, { withFileTypes: true })
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue
          const exePath = path.join(dirPath, sub.name, `${sub.name}.exe`)
          if (seen.has(exePath)) continue
          if (fs.existsSync(exePath)) {
            seen.add(exePath)
            items.push({
              name: sub.name,
              path: exePath,
              type: 'Programa',
              category: inferCategory(sub.name, dirPath),
            })
          }
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  return items
}

function scanPathExecutables() {
  const pathEnv = getEnv('PATH')
  if (!pathEnv) return []

  const items = []
  const seen = new Set()
  const dirs = pathEnv.split(';').filter(Boolean)

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && /\.(exe|bat|cmd|ps1)$/i.test(entry.name)) {
          const name = entry.name.replace(/\.(exe|bat|cmd|ps1)$/i, '')
          const key = `path:${name}`
          if (seen.has(key)) continue
          seen.add(key)
          items.push({
            name,
            path: path.join(dir, entry.name),
            type: 'CLI',
            category: inferCategory(name, dir),
          })
        }
      }
    } catch {
      /* skip */
    }
  }
  return items
}

function scanCommonFolders() {
  const userDir = getEnv('USERPROFILE')
  if (!userDir) return []

  const items = []
  const seen = new Set()
  const common = [
    'Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos',
    'OneDrive', 'OneDrive - Personal',
  ]

  for (const folder of common) {
    const fullPath = path.join(userDir, folder)
    if (fs.existsSync(fullPath) && !seen.has(fullPath)) {
      seen.add(fullPath)
      items.push({
        name: folder,
        path: fullPath,
        type: 'Pasta',
        category: 'Sistema',
      })
    }
  }
  return items
}

function scanUserSubfolders() {
  const userDir = getEnv('USERPROFILE')
  if (!userDir) return []

  const items = []
  const seen = new Set()
  walkUserFolder(userDir, items, seen, 'Sistema', 2)
  return items
}

function scanUserDocuments() {
  const docsDir = path.join(getEnv('USERPROFILE'), 'Documents')
  if (!fs.existsSync(docsDir)) return []

  const items = []
  const seen = new Set()
  walkUserFolder(docsDir, items, seen, 'Documentos', 3)
  return items
}

function scanUserDownloads() {
  const dlDir = path.join(getEnv('USERPROFILE'), 'Downloads')
  if (!fs.existsSync(dlDir)) return []

  const items = []
  const seen = new Set()
  walkUserFolder(dlDir, items, seen, 'Downloads', 3)
  return items
}

function scanUserDesktopFiles() {
  const deskDir = path.join(getEnv('USERPROFILE'), 'Desktop')
  if (!fs.existsSync(deskDir)) return []

  const items = []
  const seen = new Set()
  walkUserFolder(deskDir, items, seen, 'Desktop', 3)
  return items
}

function walkDir(dirPath, items, seen, defaultType, maxDepth) {
  if (maxDepth <= 0) return

  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (seen.has(fullPath)) continue

    if (entry.isDirectory()) {
      seen.add(fullPath)
      if (!entry.name.startsWith('.')) {
        walkDir(fullPath, items, seen, defaultType, maxDepth - 1)
      }
      continue
    }

    if (entry.name.endsWith('.exe') || entry.name.endsWith('.lnk') || entry.name.endsWith('.bat') || entry.name.endsWith('.cmd')) {
      seen.add(fullPath)
      const displayName = entry.name.replace(/\.(exe|lnk|bat|cmd)$/i, '')
      items.push({
        name: displayName,
        path: fullPath,
        type: entry.name.endsWith('.lnk') ? 'Atalho' : 'Programa',
        category: inferCategory(displayName, dirPath),
      })
    }
  }
}

const DOC_FILE_RE = /\.(docx?|xlsx?|pptx?|pdf|txt|md|csv|json|xml|jpg|jpeg|png|gif|mp4|mkv|mp3|wav|zip|rar|7z)$/i

function walkUserFolder(dirPath, items, seen, category, maxDepth) {
  if (maxDepth <= 0) return

  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (seen.has(fullPath)) continue

    if (entry.isDirectory()) {
      seen.add(fullPath)
      if (entry.name.startsWith('.') || entry.name === 'AppData') continue
      items.push({
        name: entry.name,
        path: fullPath,
        type: 'Pasta',
        category,
      })
      walkUserFolder(fullPath, items, seen, category, maxDepth - 1)
    } else if (DOC_FILE_RE.test(entry.name)) {
      seen.add(fullPath)
      const displayName = entry.name.replace(/\.[^.]+$/, '')
      items.push({
        name: displayName,
        path: fullPath,
        type: 'Arquivo',
        category,
      })
    }
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Category Inference
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function inferCategory(name, dirPath) {
  const lower = String(name || '').toLowerCase()
  const dirLower = String(dirPath || '').toLowerCase()

  if (lower.includes('chrome') || lower.includes('firefox') || lower.includes('edge') || lower.includes('brave') || lower.includes('opera') || lower.includes('browser')) return 'Navegador'
  if (lower.includes('code') || lower.includes('studio') || lower.includes('ide') || lower.includes('vscode') || lower.includes('visual studio') || lower.includes('notepad') || lower.includes('sublime') || lower.includes('webstorm') || lower.includes('cursor')) return 'Desenvolvimento'
  if (lower.includes('word') || lower.includes('excel') || lower.includes('powerpoint') || lower.includes('outlook') || lower.includes('office') || lower.includes('onenote') || lower.includes('access')) return 'Escritorio'
  if (lower.includes('spotify') || lower.includes('music') || lower.includes('media') || lower.includes('vlc') || lower.includes('player') || lower.includes('video')) return 'Midia'
  if (lower.includes('discord') || lower.includes('slack') || lower.includes('teams') || lower.includes('zoom') || lower.includes('whatsapp') || lower.includes('telegram') || lower.includes('signal')) return 'Comunicacao'
  if (dirLower.includes('accessories') || dirLower.includes('acessÃ³rios') || dirLower.includes('ferramentas')) return 'Ferramentas'
  if (dirLower.includes('games') || dirLower.includes('jogos') || dirLower.includes('game') || lower.includes('steam') || lower.includes('epic') || lower.includes('unity') || lower.includes('unreal')) return 'Jogos'
  if (dirLower.includes('adobe') || lower.includes('photoshop') || lower.includes('illustrator') || lower.includes('premiere') || lower.includes('after effects') || lower.includes('design') || lower.includes('figma')) return 'Design'
  if (dirLower.includes('system32') || dirLower.includes('system') || dirLower.includes('windows') || lower.includes('calc') || lower.includes('cmd') || lower.includes('powershell') || lower.includes('terminal') || lower.includes('control')) return 'Sistema'
  if (lower.includes('explorer') || lower.includes('file manager') || lower.includes('files')) return 'Arquivos'
  if (dirLower.includes('documents') || dirLower.includes('documentos')) return 'Documentos'
  if (dirLower.includes('downloads')) return 'Downloads'
  if (dirLower.includes('desktop')) return 'Desktop'

  return 'Outros'
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Build Full Index
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function buildFullIndex() {
  const startMenu = scanWindowsStartMenu()
  const desktop = scanDesktop()
  const programFiles = scanProgramFiles()
  const appData = scanAppDataPrograms()
  const pathExes = scanPathExecutables()
  const commonFolders = scanCommonFolders()
  const userSubfolders = scanUserSubfolders()
  const userDocs = scanUserDocuments()
  const userDownloads = scanUserDownloads()
  const userDesktopFiles = scanUserDesktopFiles()

  const all = [
    ...userSubfolders,
    ...commonFolders,
    ...userDocs,
    ...userDownloads,
    ...userDesktopFiles,
    ...startMenu,
    ...desktop,
    ...programFiles,
    ...appData,
    ...pathExes,
  ]

  const seen = new Set()
  return all.filter((item) => {
    const key = `${item.name}|${item.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildVocabulary(items) {
  const vocab = new Set()
  for (const item of items) {
    const words = normalizeAccents(item.name).split(/[\s_-]+/).filter((w) => w.length >= 2)
    for (const w of words) vocab.add(w)
  }
  return vocab
}

function filterQueryWords(qWords, vocab) {
  return qWords.filter((w) => {
    if (w.length < 2) return false
    if (vocab.has(w)) return true
    // Allow prefixes: if query word "chrom" matches vocabulary word "chrome"
    for (const v of vocab) {
      if (v.startsWith(w) || w.startsWith(v)) return true
    }
    return false
  })
}

function getOrRefreshIndex() {
  const now = Date.now()
  if (SCAN_CACHE.items && now - SCAN_CACHE.timestamp < CACHE_TTL_MS) {
    return SCAN_CACHE.items
  }
  SCAN_CACHE.items = buildFullIndex()
  SCAN_CACHE.vocab = buildVocabulary(SCAN_CACHE.items)
  SCAN_CACHE.timestamp = now
  return SCAN_CACHE.items
}

function getVocabulary() {
  getOrRefreshIndex()
  return SCAN_CACHE.vocab || new Set()
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Scoring Algorithm (semantic fuzzy search)
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function isFolderQuery(query) {
  const q = normalizeAccents(query)
  return /pasta|folder|diret[oÃ³]rio|diret|dir\b|abrir pasta|abrir folder/i.test(q)
}

function isFileQuery(query) {
  const q = normalizeAccents(query)
  return /arquivo|file|documento|doc|pdf|planilha|imagem|foto|photo|video/i.test(q)
}

function isExplicitOpenQuery(query) {
  const q = String(query || '').toLowerCase().trim()
  return /^(abra|abrir|executar|iniciar|run|launch|open|start)\b/i.test(q)
}

function scoreItem(item, query) {
  const q = normalizeAccents(query).trim()
  if (!q) return 0

  const vocab = getVocabulary()
  const nameNorm = normalizeAccents(item.name)
  const catNorm = normalizeAccents(item.category || '')
  const pathNorm = normalizeAccents(item.path || '')
  const isFolder = item.type === 'Pasta'
  const isFile = item.type === 'Arquivo'
  const folderQuery = isFolderQuery(query)
  const fileQuery = isFileQuery(query)

  let score = 0

  /* â”€â”€ Folder queries: heavily prioritize folders â”€â”€ */
  if (folderQuery) {
    if (isFolder) {
      score = scoreNameMatch(nameNorm, q, vocab)
      score = Math.min(score + 0.15, 1.0)
    } else {
      score = scoreNameMatch(nameNorm, q, vocab) * 0.2
    }
  }
  /* â”€â”€ File queries: prioritize files â”€â”€ */
  else if (fileQuery) {
    if (isFile) {
      score = scoreNameMatch(nameNorm, q, vocab)
      score = Math.min(score + 0.15, 1.0)
    } else {
      score = scoreNameMatch(nameNorm, q, vocab) * 0.3
    }
  }
  /* â”€â”€ Normal query â”€â”€ */
  else {
    score = scoreNameMatch(nameNorm, q, vocab)

    /* Category bonus */
    if (catNorm.includes(q)) score += 0.1

    /* Path bonus */
    if (pathNorm.includes(q)) score += 0.05
  }

  return Math.min(score, 1.0)
}

function scoreNameMatch(nameNorm, q, vocab) {
  /* Build clean query by removing words not found in the index vocabulary */
  const rawQWords = q.split(/\s+/).filter(Boolean)
  const qWords = vocab && vocab.size > 0 ? filterQueryWords(rawQWords, vocab) : rawQWords
  const effectiveQWords = qWords.length > 0 ? qWords : rawQWords
  const cleanQ = effectiveQWords.join(' ')

  /* Exact match (clean or raw) */
  if (nameNorm === q || nameNorm === cleanQ) return 1.0

  /* Prefix match (clean first, then raw) */
  if (nameNorm.startsWith(cleanQ)) return 0.9 + (cleanQ.length / nameNorm.length) * 0.05
  if (nameNorm.startsWith(q)) return 0.9 + (q.length / nameNorm.length) * 0.05

  /* Contains match (clean first, then raw) */
  if (nameNorm.includes(cleanQ)) return 0.7 + (cleanQ.length / nameNorm.length) * 0.15
  if (nameNorm.includes(q)) return 0.7 + (q.length / nameNorm.length) * 0.15

  /* Word-by-word fuzzy */
  const nameWords = nameNorm.split(/[\s_-]+/)
  let matchCount = 0
  for (const qw of effectiveQWords) {
    if (nameWords.some((nw) => nw.startsWith(qw) || nw.includes(qw))) {
      matchCount++
    }
  }
  if (matchCount > 0) {
    return 0.3 + (matchCount / Math.max(effectiveQWords.length, 1)) * 0.4
  }

  /* Character-level fuzzy for short queries */
  const testQ = cleanQ || q
  if (testQ.length >= 2 && testQ.length <= 10) {
    let charMatches = 0
    for (const ch of testQ) {
      if (nameNorm.includes(ch)) charMatches++
    }
    if (charMatches >= testQ.length * 0.6) {
      return 0.15 + (charMatches / testQ.length) * 0.25
    }
  }

  return 0
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Open Item
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const openedInSession = new Set()

function openItem(itemPath) {
  return new Promise<any>((resolve) => {
    const normalized = path.resolve(String(itemPath || '').trim())
    if (!normalized) return resolve({ ok: false, error: 'Caminho vazio' })
    if (!fs.existsSync(normalized)) return resolve({ ok: false, error: 'Caminho nao encontrado no disco' })

    const cmd = process.platform === 'win32'
      ? `start "" "${normalized}"`
      : `open "${normalized}"`

    let settled = false
    let timer = null
    const done = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let child = null
    try {
      child = exec(cmd, (err) => {
        if (err) return done({ ok: false, error: err.message })
        openedInSession.add(normalized)
        return done({ ok: true, path: normalized })
      })
    } catch (err) {
      return done({ ok: false, error: err.message })
    }

    /* The OS launch is fire-and-forget (start detaches the GUI app), so a
       slow single-instance handoff must never leave this tool hanging: cap
       the wait and report success once the request was accepted. */
    timer = setTimeout(() => {
      try {
        if (child) child.kill()
      } catch {
        /* shell already gone */
      }
      openedInSession.add(normalized)
      done({ ok: true, path: normalized })
    }, 15000)
  })
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Desktop (computer use via Windows accessibility tree)
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const DESKTOP_NOT_SUPPORTED_MSG =
  'Computer use needs Windows: the element analysis must come from the ' +
  'Windows accessibility tree (UI Automation), which is not available on this system.'

/* UI language for user-visible labels (replay titles, timeline): from the
   OS locale, Portuguese or English. Code and technical errors stay English. */
function workerLocale() {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || ''
    return loc.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US'
  } catch {
    return 'pt-BR'
  }
}
const LOCALE = workerLocale()
const STR = {
  'pt-BR': {
    launched: (x) => `Abri "${x}"`,
    clicked: (x) => `Cliquei em "${x}"`,
    typed: (x) => `Digitei em "${x}"`,
    pressed: (x) => `Teclei em "${x}"`,
    read: (n, w) => `Li ${n} elementos em "${w}"`,
    searched: (x) => `Busquei "${x}"`,
    relocated: (x) => `Tela mudou, achou "${x}" de novo e tentando`,
    focusChanged: (a, b) => `Foco mudou de "${a}" para "${b}"`,
  },
  'en-US': {
    launched: (x) => `Opened "${x}"`,
    clicked: (x) => `Clicked "${x}"`,
    typed: (x) => `Typed into "${x}"`,
    pressed: (x) => `Pressed key on "${x}"`,
    read: (n, w) => `Read ${n} elements in "${w}"`,
    stopped: 'Run stopped by user',
    searched: (x) => `Searched "${x}"`,
    relocated: (x) => `Screen changed, relocated "${x}" and retrying`,
    focusChanged: (a, b) => `Focus changed from "${a}" to "${b}"`,
  },
}
function t(key, a?, b?) {
  const dict = STR[LOCALE] || STR['pt-BR']
  const fn = dict[key] || STR['pt-BR'][key]
  return fn(a, b)
}
function stepContext(appName, windowTitle) {
  const app = String(appName || '').trim()
  const win = String(windowTitle || '').trim()
  if (app && win && win !== app) return `${app} â€¢ ${win}`
  return app || win || ''
}

function resolveDesktopSnapshot(snapshotId) {
  if (snapshotId) {
    const snap = desktopRuns.getSnapshot(String(snapshotId))
    if (snap) return { snapshot: snap, snapshotId: String(snapshotId), expired: false }
    return { snapshot: null, snapshotId: null, expired: true }
  }
  const latest = desktopRuns.latestSnapshot()
  if (latest) return { snapshot: latest.snapshot, snapshotId: latest.id, expired: false }
  return { snapshot: null, snapshotId: null, expired: false }
}

function desktopSnapshotExpiredMsg() {
  return 'Snapshot expired or not found. Take a new desktop_snapshot first, then use the new refs.'
}

/* Opaque screen: the tree exposes zero actionable elements (Electron
   without accessibility, canvas, custom-drawn UI). Tells the model the
   exact next call instead of letting it re-snapshot in hope. */
function opaqueScreenWarning() {
  return '\nTELA OPACA: a arvore nao expoe botoes ou campos (so containers genericos). Nao tire outro snapshot â€” nao vai mudar. Se a pergunta do usuario for sobre o que aparece na tela, use desktop_describe. Elementos de apps opacos (canvas, jogos, frames web sem acessibilidade) nao sao clicaveis pela arvore.'
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* Reads the screen right after an action so the model can keep going
   without remembering to snapshot: returns fresh-screen text or ''. */
async function followupScreen(run, scope, maxLines) {
  try {
    const fresh = await uiaProvider.dumpTree(scope === 'desktop' ? 'desktop' : 'active')
    if (!fresh || fresh.ok !== true || !Array.isArray(fresh.nodes) || fresh.nodes.length === 0) {
      return { text: '', snapshotId: null, nodes: [] }
    }
    const reassigned = uiaNodes.assignRefs(fresh.nodes, { maxNodes: 120, maxDepth: 8 })
    const snapshot = {
      nodes: reassigned.nodes,
      truncated: reassigned.truncated || fresh.truncated === true,
      totalSeen: reassigned.totalSeen,
      appName: String(fresh.appName || ''),
      windowTitle: String(fresh.windowTitle || ''),
      scope: scope === 'desktop' ? 'desktop' : 'active',
    }
    const freshId = desktopRuns.putSnapshot(snapshot)
    run.snapshotId = freshId
    if (snapshot.appName) run.snapshotApp = snapshot.appName
    if (snapshot.windowTitle) run.snapshotTitle = snapshot.windowTitle
    const header = [
      `App: ${snapshot.appName || 'unknown'}`,
      `Window: ${snapshot.windowTitle || 'unknown'}`,
      `snapshotId: ${freshId} (refs expire in ~90s)`,
    ].join('\n')
    const list = uiaNodes.formatSnapshotForLlm(snapshot, maxLines && maxLines > 0 ? maxLines : 40)
    const tail = snapshot.truncated ? '\n(List truncated: use desktop_find to search.)' : ''
    const opaque = uiaNodes.isTreeOpaque(snapshot.nodes) ? opaqueScreenWarning() : ''
    return { text: `${header}\n${list}${tail}${opaque}`, snapshotId: freshId, nodes: snapshot.nodes }
  } catch {
    return { text: '', snapshotId: null, nodes: [] }
  }
}

/* First editable target (text field, else document body): named explicitly
   so the model has zero planning left for the type step. */
/* Builds a cached snapshot from a tree returned inside an action result
   (merged find+act call): no extra dump process needed. */
function ingestReturnedTree(run, res, scope, maxLines) {
  if (!res || !Array.isArray(res.nodes) || res.nodes.length === 0) return null
  const assigned = uiaNodes.assignRefs(res.nodes, { maxNodes: 120, maxDepth: 8 })
  const snapshot = {
    nodes: assigned.nodes,
    truncated: assigned.truncated || res.truncated === true,
    totalSeen: assigned.totalSeen,
    appName: String(res.appName || ''),
    windowTitle: String(res.windowTitle || ''),
    scope: scope === 'desktop' ? 'desktop' : 'active',
  }
  const id = desktopRuns.putSnapshot(snapshot)
  run.snapshotId = id
    if (snapshot.appName) run.snapshotApp = snapshot.appName
    if (snapshot.windowTitle) run.snapshotTitle = snapshot.windowTitle
  const header = [
    `App: ${snapshot.appName || 'unknown'}`,
    `Window: ${snapshot.windowTitle || 'unknown'}`,
    `snapshotId: ${id} (refs expire in ~90s)`,
  ].join('\n')
  const list = uiaNodes.formatSnapshotForLlm(snapshot, maxLines && maxLines > 0 ? maxLines : 40)
  const tail = snapshot.truncated ? '\n(List truncated: use desktop_find to search.)' : ''
  const opaque = uiaNodes.isTreeOpaque(snapshot.nodes) ? opaqueScreenWarning() : ''
  return { snapshot, snapshotId: id, nodes: snapshot.nodes, text: `${header}\n${list}${tail}${opaque}` }
}

function bestTypeTarget(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  const norm = (s) => uiaNodes.normalizeText(s).replace(/\s+/g, '')
  return list.find((n) => norm(n.control) === 'edit')
    || list.find((n) => norm(n.control) === 'document')
    || null
}

/* â”€â”€ Replay frames: one screenshot per action step â”€â”€ */

const MAX_FRAMES_PER_RUN = 20
const MAX_KEPT_RUNS_WITH_FRAMES = 10
const MAX_THUMB_BYTES = 350 * 1024

function framesBaseDir() {
  const dataDir = process.env.MOMAI_DATA_DIR || process.env.MOMAI_NODE_CORE_DATA_DIR || null
  const extId = process.env.MOMAI_EXTENSION_ID || 'momai-desktop'
  if (!dataDir) return null
  return path.join(dataDir, 'extensions', extId, 'frames')
}

function safeRunDir(runId) {
  const safe = String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  return safe || null
}

function pruneRunFrames() {
  try {
    const base = framesBaseDir()
    if (!base || !fs.existsSync(base)) return
    const dirs = fs.readdirSync(base)
      .map((name) => {
        const full = path.join(base, name)
        let mtime = 0
        let isDir = false
        try {
          const st = fs.statSync(full)
          isDir = st.isDirectory()
          mtime = st.mtimeMs
        } catch {
          /* ignore */
        }
        return { name, full, mtime, isDir }
      })
      .filter((d) => d.isDir)
      .sort((a, b) => b.mtime - a.mtime)
    for (const old of dirs.slice(MAX_KEPT_RUNS_WITH_FRAMES)) {
      fs.rmSync(old.full, { recursive: true, force: true })
    }
  } catch {
    /* best effort */
  }
}

async function captureRunFrame(run, label, context?) {
  try {
    const base = framesBaseDir()
    const safe = run && safeRunDir(run.id)
    if (!base || !safe || !uiaProvider.isSupported()) return null
    const dir = path.join(base, safe)
    let existing = 0
    try {
      existing = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length
    } catch {
      existing = 0
    }
    if (existing >= MAX_FRAMES_PER_RUN) return null
    await fs.promises.mkdir(dir, { recursive: true })
    pruneRunFrames()
    const file = `step-${String(existing + 1).padStart(2, '0')}.jpg`
    const res = await uiaProvider.captureScreenshot(path.join(dir, file))
    if (res && res.ok === true) {
      const rel = `${safe}/${file}`
      desktopRuns.appendStep(run.id, { kind: 'frame', label: String(label || '').slice(0, 300), frame: rel, context: context || undefined })
      return rel
    }
    return null
  } catch {
    return null
  }
}

function readFrameDataUrl(rel) {
  try {
    const base = framesBaseDir()
    if (!base || !rel) return null
    const full = path.resolve(base, String(rel))
    const resolvedBase = path.resolve(base)
    if (!full.startsWith(resolvedBase + path.sep)) return null
    const st = fs.statSync(full)
    if (!st.isFile() || st.size > MAX_THUMB_BYTES) return null
    return `data:image/jpeg;base64,${fs.readFileSync(full).toString('base64')}`
  } catch {
    return null
  }
}

function listRunFrames(runId) {
  try {
    const base = framesBaseDir()
    const safe = safeRunDir(runId)
    if (!base || !safe) return []
    const dir = path.join(base, safe)
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort()
      .map((f) => `${safe}/${f}`)
  } catch {
    return []
  }
}

async function attachPreview(card, run) {
  try {
    const steps = Array.isArray(run.steps) ? run.steps : []
    let lastFrame = null
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i] && steps[i].frame) {
        lastFrame = steps[i].frame
        break
      }
    }
    const frames = listRunFrames(run.id)
    card.data.frameCount = frames.length
    card.data.previewThumb = lastFrame ? readFrameDataUrl(lastFrame) : null
    if (!card.data.previewThumb) delete card.data.previewThumb
  } catch {
    /* preview is best effort */
  }
  return card
}

async function handleDesktopTool({ toolName, args, content, momai }) {
  const params = args && typeof args === 'object' ? args : {}

  /* â”€â”€ desktop_list_runs / desktop_get_run / desktop_stop_run / desktop_settings â”€â”€ */
  if (toolName === 'desktop_list_runs') {
    const limit = Number(params.limit) > 0 ? Number(params.limit) : 10
    const items = desktopRuns.listRuns(limit)
    return {
      tool: toolName,
      instruction: JSON.stringify({ runs: items, total: items.length }),
    }
  }

  if (toolName === 'desktop_get_run') {
    const run = params.runId
      ? desktopRuns.getRun(String(params.runId))
      : desktopRuns.latestActiveRun()
    if (!run) {
      return { tool: toolName, instruction: 'Desktop run not found. Start with desktop_snapshot.' }
    }
    const summary = run.steps.length === 0
      ? 'No steps yet.'
      : run.steps.slice(-8).map((s) => `- ${s.label}`).join('\n')
    const card = desktopRuns.buildRunCard(run)
    await attachPreview(card, run)
    return {
      tool: toolName,
      structuredResponse: card,
      instruction: JSON.stringify({
        runId: run.id,
        objective: run.objective,
        status: run.status,
        totalSteps: run.steps.length,
        updatedAt: run.updatedAt,
        steps: run.steps.slice(-30),
        summary,
      }),
    }
  }

  if (toolName === 'desktop_get_frames') {
    const run = params.runId
      ? desktopRuns.getRun(String(params.runId))
      : desktopRuns.latestActiveRun()
    if (!run) {
      return { tool: toolName, instruction: JSON.stringify({ frames: [] }), frames: [] }
    }
    const rels = listRunFrames(run.id).slice(0, MAX_FRAMES_PER_RUN)
    const steps = Array.isArray(run.steps) ? run.steps : []
    const frameSteps = steps.filter((s) => s && s.frame)
    const byFile = {}
    for (const rel of rels) {
      const dataUrl = readFrameDataUrl(rel)
      if (dataUrl) byFile[rel.split('/').pop()] = dataUrl
    }
    /* One slide per screenshot, each carrying its own caption (step label
       + app context) â€” no separate title images. */
    const slides = []
    const stepFiles = rels
      .map((r) => r.split('/').pop())
      .filter((f) => /^step-\d+\.jpg$/.test(f))
      .sort()
    for (const file of stepFiles) {
      if (!byFile[file]) continue
      const step = frameSteps.find((s) => String(s.frame || '').endsWith(`/${file}`))
      slides.push({
        kind: 'image',
        label: step && step.label ? step.label : '',
        subtitle: step && step.context ? step.context : '',
        ts: (step && step.ts) || run.updatedAt,
        dataUrl: byFile[file],
      })
    }
    /* Note: slides ride in a top-level field (page reads it straight from
       the route response); the LLM only ever sees the small summary. */
    return {
      tool: toolName,
      instruction: JSON.stringify({ runId: run.id, total: slides.length }),
      frames: slides,
    }
  }

  if (toolName === 'desktop_settings') {
    const hasPatch = params.allowedApps !== undefined
      || params.recordVisuals !== undefined
      || params.maxSteps !== undefined
      || params.maxRunMinutes !== undefined
      || params.safeStop !== undefined
    const settings = hasPatch
      ? await desktopRuns.saveSettings(momai, params)
      : await desktopRuns.loadSettings(momai)
    return {
      tool: toolName,
      instruction: JSON.stringify({ settings }),
    }
  }

  if (toolName === 'desktop_stop_run') {
    const run = params.runId
      ? desktopRuns.getRun(String(params.runId))
      : desktopRuns.latestActiveRun()
    if (!run) {
      return { tool: toolName, instruction: 'No active desktop run to stop.' }
    }
    desktopRuns.finishRun(run.id, 'stopped')
    desktopRuns.appendStep(run.id, { kind: 'info', label: t('stopped') })
    await desktopRuns.emitRunEvent(momai, 'desktop_run_finished', { runId: run.id, status: 'stopped' })
    const stopCard = desktopRuns.buildRunCard(run)
    await attachPreview(stopCard, run)
    return {
      tool: toolName,
      structuredResponse: stopCard,
      instruction: JSON.stringify({ runId: run.id, status: 'stopped' }),
    }
  }

  /* â”€â”€ desktop_launch: focus-free program opener via Windows Search â”€â”€ */
  if (toolName === 'desktop_launch') {
    const query = String(params.query || content || '').trim()
    if (!query) {
      return { tool: toolName, instruction: 'Tell me the program name to launch (query).' }
    }
    if (!uiaProvider.isSupported()) {
      return { tool: toolName, instruction: DESKTOP_NOT_SUPPORTED_MSG }
    }
    const objective = `Abrir ${query.slice(0, 120)}`
    let run = desktopRuns.latestActiveRun()
    const runFresh = run && Date.now() - Date.parse(run.updatedAt) < 10 * 60 * 1000
    if (!runFresh) run = desktopRuns.createRun(objective)
    const priorApp = runFresh ? String(run.snapshotApp || '') : ''
    let result
    try {
      result = await uiaProvider.invokeAction({ action: 'winsearch', text: query })
    } catch (err) {
      result = { ok: false, error: err.message }
    }
    if (result && result.ok === true) {
      const launchStepLabel = `${t('launched', query)} via Windows Search`
      desktopRuns.appendStep(run.id, { kind: 'action', label: launchStepLabel })
      await desktopRuns.emitRunEvent(momai, 'desktop_run_step', { runId: run.id, kind: 'action', label: launchStepLabel })
      const launchSettings = await desktopRuns.loadSettings(momai)
      /* Tree first (sets the current app/window), then the frame with the
         right context â€” a wrong subtitle is worse than +0.4s. */
      const screen = await followupScreen(run, 'active', 18)
      if (launchSettings.recordVisuals !== false) {
        await captureRunFrame(run, launchStepLabel, stepContext(run.snapshotApp, run.snapshotTitle))
      }
      const postApp = String(run.snapshotApp || '')
      const unchanged = priorApp && postApp && priorApp.toLowerCase() === postApp.toLowerCase()
      const verifyNote = unchanged
        ? ` ATENCAO: a janela ativa continua "${postApp}" â€” o app pode estar abrindo devagar ou a busca errou o alvo; confirme o app certo com outro snapshot antes de clicar/digitar.`
        : ''
      const instruction = screen.text
        ? `Launched "${query}".\nTELA ATUAL (use SOMENTE estas refs):\n${screen.text}${verifyNote}\nPROXIMO PASSO OBRIGATORIO: continue a tarefa com desktop_find, desktop_click ou desktop_type usando as refs ACIMA, escrevendo 1 linha de progresso junto. Se App nao for o programa pedido ainda (app abrindo), aguarde e chame desktop_snapshot de novo. Nao escreva a resposta final antes de concluir.`
        : JSON.stringify({ ok: true, action: `Launched "${query}"`, runId: run.id, next: 'Chame desktop_snapshot para ver a janela e continuar a tarefa.' })
      /* No card here: shown only when the task ends. */
      return {
        tool: toolName,
        instruction,
      }
    }
    const detail = result && result.error ? result.error : 'unknown error'
    desktopRuns.appendStep(run.id, { kind: 'error', label: `Launch "${query}" failed: ${detail}` })
    return {
      tool: toolName,
      instruction: `Could not launch "${query}" via Windows Search: ${detail}.`,
    }
  }

  /* â”€â”€ desktop_describe: look at the screen and detail it â”€â”€ */
  if (toolName === 'desktop_describe') {
    if (!uiaProvider.isSupported()) {
      return { tool: toolName, instruction: DESKTOP_NOT_SUPPORTED_MSG }
    }
    const question = String(params.question || content || '').trim()
    const res = await uiaProvider.describeScreen(question)
    if (res.ok) {
      return {
        tool: toolName,
        instruction: `Screen (${res.display}):\n${res.text}`,
      }
    }
    if (res.unavailable) {
      return {
        tool: toolName,
        instruction: 'No vision-capable model is active right now, so I cannot see screenshots. The accessibility tree (desktop_snapshot) still works for normal programs.',
      }
    }
    return { tool: toolName, instruction: `Could not describe the screen: ${res.error}` }
  }

  /* â”€â”€ desktop_screenshot: show the screen to the USER â”€â”€ */
  if (toolName === 'desktop_screenshot') {
    if (!uiaProvider.isSupported()) {
      return { tool: toolName, instruction: DESKTOP_NOT_SUPPORTED_MSG }
    }
    const only = params.screen !== undefined && params.screen !== null && params.screen !== ''
      ? Number(params.screen)
      : null
    let shots = []
    if (only !== null && Number.isFinite(only)) {
      const displays = await uiaProvider.listDisplays()
      const picked = displays[only] || displays[0]
      const all = await uiaProvider.captureAllScreens()
      shots = all.filter((s) => !picked || s.name === picked.name || s.display === only)
      if (shots.length === 0) shots = all.slice(0, 1)
    } else {
      shots = await uiaProvider.captureAllScreens()
    }
    if (shots.length === 0) {
      return { tool: toolName, instruction: 'Could not capture any screen.' }
    }
    return {
      tool: toolName,
      structuredResponse: {
        type: 'generic-extension',
        data: {
          extension: 'momai-desktop',
          header: {
            icon: '',
            title: shots.length === 1 ? 'Screenshot' : `${shots.length} screenshots`,
            subtitle: shots.map((s) => s.name).join(' â€¢ '),
          },
          sections: shots.map((s, i) => ({
            title: s.name,
            items: [{ id: `screen-${i}`, type: 'Imagem', label: s.name, image_url: s.dataUrl }],
          })),
          footer: { text: 'MomAI Desktop' },
        },
      },
      instruction: JSON.stringify({
        ok: true,
        message: `Showing ${shots.length} screenshot(s) to the user: ${shots.map((s) => s.name).join(', ')}.`,
      }),
    }
  }

  /* â”€â”€ Everything below needs Windows UI Automation â”€â”€ */
  if (!uiaProvider.isSupported()) {
    return { tool: toolName, instruction: DESKTOP_NOT_SUPPORTED_MSG }
  }

  /* â”€â”€ desktop_act: whole multi-step task in ONE call â”€â”€
     The model derails when a task needs 5+ round-trips (it stops mid-way
     and explains instead of acting). This op runs the full sequence
     server-side with settle waits and retries: launch â†’ click names â†’
     type, resolving every name against a fresh snapshot. */
  if (toolName === 'desktop_act') {
    /* Small models often send the array as a JSON string: accept both. */
    let steps = params.steps
    if (typeof steps === 'string') {
      try {
        steps = JSON.parse(steps)
      } catch {
        steps = []
      }
    }
    if (steps && typeof steps === 'object' && !Array.isArray(steps)) steps = [steps]
    if (!Array.isArray(steps)) steps = []
    if (steps.length === 0 || steps.length > 100) {
      return { tool: toolName, instruction: 'Give me steps: [{op:"launch"|"click"|"type"|"press"|"wait", ...}]. Max 100 steps.' }
    }
    if (!uiaProvider.isSupported()) {
      return { tool: toolName, instruction: DESKTOP_NOT_SUPPORTED_MSG }
    }
    const objective = String(params.objective || content || 'Desktop task').slice(0, 200)
    let run = desktopRuns.latestActiveRun()
    const runFresh = run && Date.now() - Date.parse(run.updatedAt) < 10 * 60 * 1000
    if (!runFresh) run = desktopRuns.createRun(objective)
    else if (!run.objective) run.objective = objective
    const actSettings = await desktopRuns.loadSettings(momai)
    const recordFrames = actSettings.recordVisuals !== false

    async function actSnapshot(scope) {
      let best = null
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleepMs(800)
        try {
          const dump = await uiaProvider.dumpTree(scope === 'desktop' ? 'desktop' : 'active')
          if (dump && dump.ok === true && Array.isArray(dump.nodes) && dump.nodes.length >= 3) {
            const assigned = uiaNodes.assignRefs(dump.nodes, { maxNodes: 120, maxDepth: 8 })
            const snapshot = {
              nodes: assigned.nodes,
              truncated: assigned.truncated || dump.truncated === true,
              totalSeen: assigned.totalSeen,
              appName: String(dump.appName || ''),
              windowTitle: String(dump.windowTitle || ''),
              scope: scope === 'desktop' ? 'desktop' : 'active',
            }
            const id = desktopRuns.putSnapshot(snapshot)
            run.snapshotId = id
            if (snapshot.appName) run.snapshotApp = snapshot.appName
            if (snapshot.windowTitle) run.snapshotTitle = snapshot.windowTitle
            const result = { snapshot, id }
            /* Prefer snapshots carrying app identity (cold-start dumps can
               come back anonymous): keep trying while attempts remain. */
            if (scope !== 'active' || snapshot.appName) return result
            best = best || result
          }
        } catch {
          /* retry */
        }
      }
      return best
    }

    async function actInvoke(payload) {
      try {
        return await uiaProvider.invokeAction(payload)
      } catch (err) {
        return { ok: false, error: err.message }
      }
    }

    /* Resolves a name against fresh trees, one merged find+act process
       per try: 1. name + role, 2. name only (role can mismatch across
       locales). Never quits after 1 miss. */
    async function actOnName(op, name, role, extra) {
      const invokeOpts = extra && typeof extra === 'object' ? { ...extra } : {}
      async function attemptMerged(round) {
        try {
          return await uiaProvider.actOnTree({
            findName: round.name,
            findRole: round.role,
            action: op,
            ...invokeOpts,
          })
        } catch (err) {
          return { ok: false, error: err.message }
        }
      }
      const rounds = []
      if (name) {
        rounds.push({ name, role })
        if (role) rounds.push({ name, role: undefined })
      } else if (role) {
        rounds.push({ name: '', role })
      }
      for (const round of rounds) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await attemptMerged(round)
          if (res && res.ok === true) {
            const ingested = ingestReturnedTree(run, res, 'active', 0)
            return {
              ok: true,
              label: res.name || name || role,
              snapshotId: ingested ? ingested.snapshotId : null,
            }
          }
          await sleepMs(700)
        }
      }
      return { ok: false, error: `Element "${name || role}" could not be acted on.` }
    }

    const outcomes = []
    let aborted = false
    /* DONE is only reported when every step really executed: anything
       skipped (or failed) makes the task INCOMPLETE, never DONE. */
    const markSkipped = (msg) => {
      outcomes.push(msg)
      aborted = true
    }
    const maxActions = actSettings.maxSteps > 0 ? actSettings.maxSteps : 50
    const maxRunMs = actSettings.maxRunMinutes > 0 ? actSettings.maxRunMinutes * 60000 : 0
    const runStartedAt = Date.parse(run.createdAt) || Date.now()
    let actionCount = 0
    /* Page-configured limits: cap action steps and total run time so a
       runaway task stops itself instead of burning rounds forever. */
    const checkLimits = () => {
      if (actionCount >= maxActions) {
        outcomes.push(`limite de passos atingido (${maxActions}) â€” pare aqui`)
        desktopRuns.appendStep(run.id, { kind: 'error', label: `Limite de passos (${maxActions})` })
        aborted = true
        return false
      }
      if (maxRunMs > 0 && Date.now() - runStartedAt > maxRunMs) {
        desktopRuns.finishRun(run.id, 'stopped')
        desktopRuns.appendStep(run.id, { kind: 'error', label: `Limite de tempo (${actSettings.maxRunMinutes} min)` })
        outcomes.push(`limite de tempo atingido (${actSettings.maxRunMinutes} min) â€” run encerrada`)
        aborted = true
        return false
      }
      return true
    }
    for (let i = 0; i < steps.length && !aborted; i++) {
      const step = steps[i] && typeof steps[i] === 'object' ? steps[i] : {}
      const op = String(step.op || '')
      if (op === 'launch' || op === 'click' || op === 'type' || op === 'press') {
        if (!checkLimits()) break
        actionCount++
      }
      if (op === 'launch') {
        const query = String(step.query || '').trim()
        if (!query) {
          markSkipped('launch: skipped (empty query)')
          continue
        }
        const res = await actInvoke({ action: 'winsearch', text: query })
        if (res && res.ok === true) {
          const priorApp = String(run.snapshotApp || '')
          await sleepMs(2000)
          /* Cold starts leave a nameless transition window behind: poll
             until the new app owns the foreground (or attempts run out),
             so verification, subtitles and next steps see the real app. */
          let taken = null
          for (let waitRound = 0; waitRound < 5 && !aborted; waitRound++) {
            if (waitRound > 0) await sleepMs(1500)
            taken = await actSnapshot('active')
            if (taken && taken.snapshot.appName) break
          }
          const where = taken ? `"${taken.snapshot.windowTitle || taken.snapshot.appName}"` : 'unknown window'
          /* Launch verification: sent keystrokes are not proof. When the
             foreground app did not change at all, say so explicitly
             instead of a blind "ok" â€” otherwise a mistyped query ends up
             automating the wrong window. */
          const postApp = taken ? String(taken.snapshot.appName || '') : ''
          const unchanged = priorApp && postApp
            && priorApp.toLowerCase() === postApp.toLowerCase()
          const launchLabel = `${t('launched', query)} â†’ ${where}`
          desktopRuns.appendStep(run.id, { kind: 'action', label: launchLabel })
          if (recordFrames) await captureRunFrame(run, launchLabel, stepContext(taken ? taken.snapshot.appName : '', taken ? taken.snapshot.windowTitle : ''))
          outcomes.push(unchanged
            ? `launch "${query}": sent but foreground is still "${postApp}" â€” the app may be opening slowly or the query missed; snapshot again and confirm the right app before clicking`
            : `launch "${query}": ok (${where})`)
        } else {
          const detail = res && res.error ? res.error : 'unknown error'
          desktopRuns.appendStep(run.id, { kind: 'error', label: `Launch "${query}" failed: ${detail}` })
          outcomes.push(`launch "${query}": FAILED (${detail})`)
          aborted = true
        }
      } else if (op === 'click' || op === 'type' || op === 'press') {
        if (op === 'type' && !String(step.text || '')) {
          markSkipped('type: skipped (empty text)')
          continue
        }
        if (op === 'press' && !String(step.key || '')) {
          markSkipped('press: skipped (empty key)')
          continue
        }
        const name = String(step.name || '').trim()
        /* No-name targeting: typing obviously goes to the first editable
           area (field, else document body); pressing a key anchors focus
           on the first element. Clicking stays strict â€” a blind click can
           hit anything, so a nameless click fails loudly instead. */
        let effName = name
        let effRole = step.role
        let autoTarget = ''
        if (!effName && !effRole) {
          if (op === 'click') {
            outcomes.push('click: FAILED (needs "name" â€” blind clicks are refused)')
            desktopRuns.appendStep(run.id, { kind: 'error', label: 'click failed: no "name" given' })
            aborted = true
            continue
          }
          const taken = await actSnapshot('active')
          const nodes = taken ? taken.snapshot.nodes : []
          const norm = (s) => uiaNodes.normalizeText(s).replace(/\s+/g, '')
          const picked = nodes.find((n) => norm(n.control) === 'edit')
            || nodes.find((n) => norm(n.control) === 'document')
            || nodes.find((n) => String(n.name || '').trim() !== '')
          if (!picked) {
            outcomes.push(`${op}: FAILED (no target on screen)`)
            desktopRuns.appendStep(run.id, { kind: 'error', label: `${op} failed: empty screen` })
            aborted = true
            continue
          }
          effName = String(picked.name || '')
          effRole = String(picked.control || '')
          autoTarget = ` (auto-target "${effName || effRole}")`
        }
        const action = op === 'click' ? 'click' : op === 'type' ? 'setvalue' : 'press'
        const extra: Record<string, unknown> = op === 'click'
          ? {}
          : op === 'type'
            ? { text: String(step.text || ''), submit: step.submit === true }
            : { key: String(step.key || '') }
        const res = await actOnName(action, effName, effRole, extra)
        if (res.ok) {
          await sleepMs(600)
          const stepLabel = op === 'click' ? t('clicked', res.label) : op === 'type' ? t('typed', res.label) : t('pressed', res.label)
          desktopRuns.appendStep(run.id, { kind: 'action', label: stepLabel })
          if (recordFrames) await captureRunFrame(run, stepLabel, stepContext(run.snapshotApp, run.snapshotTitle))
          outcomes.push(`${op} "${effName || effRole}"${autoTarget}: ok ("${res.label}")`)
        } else {
          desktopRuns.appendStep(run.id, { kind: 'error', label: `${op} "${effName}" failed: ${res.error}` })
          outcomes.push(`${op} "${effName}": FAILED (${res.error})`)
          aborted = true
        }
      } else if (op === 'wait') {
        const ms = Math.min(Math.max(Number(step.ms) || 1000, 200), 10000)
        await sleepMs(ms)
        outcomes.push(`wait ${ms}ms: ok`)
      } else {
        markSkipped(`unknown op "${op}": skipped`)
      }
    }

    const finalScreen = await followupScreen(run, 'active', 40)
    await desktopRuns.emitRunEvent(momai, 'desktop_run_step', { runId: run.id, kind: 'action', label: `Task ${aborted ? 'stopped' : 'done'}: ${objective}` })
    const lines = outcomes.map((o, i) => `${i + 1}. ${o}`).join('\n')
    const finalText = finalScreen.text
    const instruction = aborted
      ? `TASK STOPPED at step ${outcomes.length} of ${steps.length}:\n${lines}\nCURRENT SCREEN:\n${finalText}\nDecida: ajuste e chame desktop_act de novo, ou avise o usuario. Nao explique passo manual.`
      : `TASK DONE (${outcomes.length}/${steps.length}):\n${lines}\nCURRENT SCREEN:\n${finalText}\nResponda ao usuario com o resumo do que foi feito.`
    /* The single run card: shown only when the whole task ends. */
    const card = desktopRuns.buildRunCard(run)
    await attachPreview(card, run)
    return {
      tool: toolName,
      structuredResponse: card,
      instruction,
    }
  }

  /* â”€â”€ desktop_snapshot â”€â”€ */
  if (toolName === 'desktop_snapshot') {
    const scope = params.scope === 'desktop' ? 'desktop' : 'active'
    let dump = null
    let lastError = ''
    // A freshly opened program may need a moment before its tree appears.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleepMs(800)
      try {
        dump = await uiaProvider.dumpTree(scope)
      } catch (err) {
        lastError = err.message
        dump = null
      }
      if (dump && dump.ok === true && Array.isArray(dump.nodes) && dump.nodes.length >= 3) break
      if (dump && dump.ok === true) lastError = ''
    }
    if (!dump || dump.ok !== true) {
      const detail = (dump && dump.error ? dump.error : lastError) || 'unknown error'
      return { tool: toolName, instruction: `Could not read the accessibility tree: ${detail}` }
    }
    const settings = await desktopRuns.loadSettings(momai)
    if (!desktopRuns.isAppAllowed(settings, dump.appName)) {
      return {
        tool: toolName,
        instruction: `App "${dump.appName || 'unknown'}" is not in the allowed list. Ask the user to allow it on the MomAI Desktop page.`,
      }
    }
    const assigned = uiaNodes.assignRefs(dump.nodes, { maxNodes: 120, maxDepth: 8 })
    const snapshot = {
      nodes: assigned.nodes,
      truncated: assigned.truncated || dump.truncated === true,
      totalSeen: assigned.totalSeen,
      appName: String(dump.appName || ''),
      windowTitle: String(dump.windowTitle || ''),
      scope,
    }
    const snapshotId = desktopRuns.putSnapshot(snapshot)
    const objective = String(params.objective || content || '').slice(0, 200)
    let run = desktopRuns.latestActiveRun()
    const runFresh = run && Date.now() - Date.parse(run.updatedAt) < 10 * 60 * 1000
    if (!runFresh) run = desktopRuns.createRun(objective)
    else if (objective && !run.objective) run.objective = objective
    run.snapshotId = snapshotId
    /* Continuity guard: acting on app X and then seeing app Y means focus
       moved (user alt-tabbed, popup stole it). Never act blindly then. */
    const lastStep = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null
    const lastWasAction = !!lastStep && (lastStep.kind === 'action' || lastStep.kind === 'error')
    const prevApp = run.snapshotApp
    if (snapshot.appName) run.snapshotApp = snapshot.appName
    if (snapshot.windowTitle) run.snapshotTitle = snapshot.windowTitle
    let focusWarning = ''
    if (lastWasAction && prevApp && snapshot.appName
      && String(prevApp).toLowerCase() !== String(snapshot.appName).toLowerCase()) {
      focusWarning = `\nATENCAO: a janela ativa mudou de "${prevApp}" para "${snapshot.appName}" depois da ultima acao. Se "${snapshot.appName}" nao for o app da tarefa, PARE e avise o usuario em vez de clicar/digitar.`
      desktopRuns.appendStep(run.id, { kind: 'error', label: t('focusChanged', prevApp, snapshot.appName) })
      /* Safe-stop: with the guard on, an unexpected app switch ends the
         run instead of risking actions on the wrong window. */
      const guardSettings = await desktopRuns.loadSettings(momai)
      if (guardSettings.safeStop !== false) {
        desktopRuns.finishRun(run.id, 'stopped')
        desktopRuns.appendStep(run.id, { kind: 'info', label: t('stopped') })
        const stopCard = desktopRuns.buildRunCard(run)
        await attachPreview(stopCard, run)
        return {
          tool: toolName,
          structuredResponse: stopCard,
          instruction: `Execucao interrompida por seguranca: a janela ativa mudou para "${snapshot.appName}". Confirme o app certo com o usuario e comece de novo.`,
        }
      }
    }
    desktopRuns.appendStep(run.id, {
      kind: 'snapshot',
      label: t('read', snapshot.nodes.length, snapshot.windowTitle || snapshot.appName || 'screen'),
    })
    await desktopRuns.emitRunEvent(momai, 'desktop_run_step', {
      runId: run.id,
      kind: 'snapshot',
      snapshotId,
    })
    /* Every desktop tool call leaves a replay frame. */
    if (settings.recordVisuals !== false) {
      await captureRunFrame(
        run,
        t('read', snapshot.nodes.length, snapshot.windowTitle || snapshot.appName || 'screen'),
        stepContext(snapshot.appName, snapshot.windowTitle)
      )
    }
    const header = [
      `App: ${snapshot.appName || 'unknown'}`,
      `Window: ${snapshot.windowTitle || 'unknown'}`,
      `snapshotId: ${snapshotId} (refs expire in ~90s)`,
    ].join('\n') + focusWarning
    const list = uiaNodes.formatSnapshotForLlm(snapshot, 60)
    const tail = snapshot.truncated ? '\n(List truncated: use desktop_find to search.)' : ''
    const opaque = uiaNodes.isTreeOpaque(snapshot.nodes) ? opaqueScreenWarning() : ''
    /* No card here: the single run card is shown only when the task ends
       (desktop_act done/stopped, desktop_stop_run, desktop_get_run). */
    return {
      tool: toolName,
      instruction: `${header}\n${list}${tail}${opaque}`,
    }
  }

  /* â”€â”€ desktop_find â”€â”€ */
  if (toolName === 'desktop_find') {
    const query = String(params.query || '').trim()
    if (!query) {
      return { tool: toolName, instruction: 'Tell me the element name to find (query).' }
    }
    const resolved = resolveDesktopSnapshot(params.snapshotId)
    if (resolved.expired) {
      return { tool: toolName, instruction: desktopSnapshotExpiredMsg() }
    }
    if (!resolved.snapshot) {
      return { tool: toolName, instruction: 'Take a desktop_snapshot first.' }
    }
    const matches = uiaNodes.findNodes(resolved.snapshot.nodes, query, params.role)
    if (matches.length === 0) {
      return { tool: toolName, instruction: `No element matching "${query}" in this snapshot.` }
    }
    const lines = matches.map((n) => uiaNodes.formatNodeLine(n))
    /* Finds also join the timeline + replay like every desktop tool call. */
    let findRun = desktopRuns.latestActiveRun()
    if (!findRun) findRun = desktopRuns.createRun(String(content || ''))
    const findLabel = t('searched', query)
    desktopRuns.appendStep(findRun.id, { kind: 'find', label: findLabel })
    const findSettings = await desktopRuns.loadSettings(momai)
    if (findSettings.recordVisuals !== false) {
      await captureRunFrame(
        findRun,
        findLabel,
        stepContext(resolved.snapshot.appName, resolved.snapshot.windowTitle)
      )
    }
    return {
      tool: toolName,
      instruction: `Matches for "${query}" (snapshotId: ${resolved.snapshotId}):\n${lines.join('\n')}\nUse a ref com desktop_click ou desktop_type ainda NESTA rodada, com o mesmo snapshotId, escrevendo 1 linha de progresso junto.`,
    }
  }

  /* â”€â”€ desktop_click / desktop_type / desktop_press â”€â”€ */
  if (toolName === 'desktop_click' || toolName === 'desktop_type' || toolName === 'desktop_press') {
    const resolved = resolveDesktopSnapshot(params.snapshotId)
    if (resolved.expired) {
      return { tool: toolName, instruction: desktopSnapshotExpiredMsg() }
    }
    if (!resolved.snapshot) {
      return { tool: toolName, instruction: 'Take a desktop_snapshot first.' }
    }
    const node = uiaNodes.getNodeByRef(resolved.snapshot.nodes, params.ref)
    if (!node) {
      return {
        tool: toolName,
        instruction: `Element ref "${params.ref}" is not in this snapshot. Take a new desktop_snapshot.`,
      }
    }
    const settings = await desktopRuns.loadSettings(momai)
    if (!desktopRuns.isAppAllowed(settings, resolved.snapshot.appName)) {
      return {
        tool: toolName,
        instruction: `App "${resolved.snapshot.appName || 'unknown'}" is not in the allowed list.`,
      }
    }
    const actionLabel = toolName === 'desktop_click'
      ? t('clicked', node.name || node.control)
      : toolName === 'desktop_type'
        ? t('typed', node.name || node.control)
        : t('pressed', node.name || node.control)
    let payload
    if (toolName === 'desktop_click') {
      payload = { path: node.path, rect: node.rect, name: node.name, app: resolved.snapshot.appName, action: 'click' }
    } else if (toolName === 'desktop_type') {
      const text = String(params.text || '')
      if (!text) {
        return { tool: toolName, instruction: 'Tell me the text to type (text).' }
      }
      payload = { path: node.path, rect: node.rect, name: node.name, app: resolved.snapshot.appName, action: 'setvalue', text, submit: params.submit === true }
    } else {
      const key = String(params.key || '')
      if (!key) {
        return { tool: toolName, instruction: 'Tell me the key to press (key, e.g. {ENTER}).' }
      }
      payload = { path: node.path, rect: node.rect, name: node.name, app: resolved.snapshot.appName, action: 'press', key }
    }
    async function attemptAction(target) {
      try {
        return await uiaProvider.invokeAction({ returnTree: true, ...(target || {}) })
      } catch (err) {
        return { ok: false, error: err.message }
      }
    }
    let result = await attemptAction(payload)
    let run = desktopRuns.latestActiveRun()
    if (!run) run = desktopRuns.createRun(String(content || ''))
    // Dynamic windows rebuild their tree between snapshot and action. On a
    // "not found", refresh once and retry by element name automatically.
    if ((!result || result.ok !== true)
      && /nao encontrado/i.test(String((result && result.error) || ''))) {
      try {
        const fresh = await uiaProvider.dumpTree(resolved.snapshot.scope === 'desktop' ? 'desktop' : 'active')
        if (fresh && fresh.ok === true) {
          const reassigned = uiaNodes.assignRefs(fresh.nodes, { maxNodes: 120, maxDepth: 8 })
          const freshSnapshot = {
            nodes: reassigned.nodes,
            truncated: reassigned.truncated || fresh.truncated === true,
            totalSeen: reassigned.totalSeen,
            appName: String(fresh.appName || ''),
            windowTitle: String(fresh.windowTitle || ''),
            scope: resolved.snapshot.scope,
          }
          const freshId = desktopRuns.putSnapshot(freshSnapshot)
          run.snapshotId = freshId
          const again = uiaNodes.findNodes(freshSnapshot.nodes, node.name, node.control)
          if (again.length > 0) {
            desktopRuns.appendStep(run.id, {
              kind: 'info',
              label: t('relocated', node.name || node.control),
            })
            payload = { ...payload, path: again[0].path, rect: again[0].rect, name: again[0].name, app: freshSnapshot.appName }
            result = await attemptAction(payload)
          }
        }
      } catch {
        /* keep the original failure below */
      }
    }
    if (result && result.ok === true) {
      /* Fresh tree rides back inside the action result (same session):
         only dump again when the action took a fallback path without one. */
      const followup = ingestReturnedTree(run, result, resolved.snapshot.scope, 18)
        || await followupScreen(run, resolved.snapshot.scope, 18)
      desktopRuns.appendStep(run.id, { kind: 'action', label: `${actionLabel} â€” done` })
      await desktopRuns.emitRunEvent(momai, 'desktop_run_step', { runId: run.id, kind: 'action', label: actionLabel })
      if (settings.recordVisuals !== false) {
        await captureRunFrame(run, actionLabel, stepContext(resolved.snapshot.appName, resolved.snapshot.windowTitle))
      }
      const target = bestTypeTarget(followup.nodes)
      const typeHint = target && toolName !== 'desktop_type'
        ? `\nPara DIGITAR, o campo certo e a ref ${target.ref} ("${target.name || target.control}"): chame desktop_type {ref: ${target.ref}, snapshotId: "${followup.snapshotId}", text: "<texto da tarefa>"}.`
        : ''
      const nextStep = followup.text
        ? `${actionLabel} done.\nNOVA TELA (as refs antigas morreram, use SOMENTE estas):\n${followup.text}${typeHint}\nPROXIMO PASSO OBRIGATORIO: continue a tarefa AGORA com a chamada acima, escrevendo 1 linha de progresso junto (rodadas mudas cortam suas tools). Quando a tarefa estiver CONCLUIDA (nada mais a fazer), chame desktop_stop_run para encerrar e mostrar o card final. Nao escreva a resposta final antes de concluir.`
        : JSON.stringify({
          ok: true,
          action: actionLabel,
          runId: run.id,
          next: 'A tela mudou e as refs antigas morreram: chame desktop_snapshot AGORA e use as novas refs para o proximo passo (ex.: desktop_type para digitar). Quando concluir a tarefa, chame desktop_stop_run para encerrar e mostrar o card final. Nao responda ao usuario antes de concluir.',
        })
      return {
        tool: toolName,
        structuredResponse: await attachPreview(desktopRuns.buildRunCard(run), run),
        instruction: nextStep,
      }
    }
    const detail = result && result.error ? result.error : 'unknown error'
    desktopRuns.appendStep(run.id, { kind: 'error', label: `${actionLabel} — failed: ${detail}` })
    /* Failures stay text-only; the card comes with the next success or stop. */
    return {
      tool: toolName,
      instruction: `${actionLabel} failed: ${detail}. The window may have changed â€” take a new desktop_snapshot and retry.`,
    }
  }

  return { tool: toolName, instruction: `Unknown desktop tool: ${toolName}` }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Search Terms
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function extractSearchTerms(raw) {
  const q = String(raw || '').trim()
  const removePatterns = [
    /^(abra|abrir|abra o|abra a|abre|abre o|abre a)\s+/i,
    /^(abrir o|abrir a|abrir)\s+/i,
    /^(executar|iniciar|run|launch|start|open)\s+/i,
    /^(busque|buscar|busca o|busca a|busca)\s+/i,
    /^(encontre|encontrar|encontra o|encontra a)\s+/i,
    /^(procure|procurar|procura o|procura a)\s+/i,
    /^(localize|localizar|localiza o|localiza a)\s+/i,
    /^(mostre|mostrar|mostra o|mostra a)\s+/i,
    /(?<!\w)(o|a|os|as|de|da|do|dos|das|em|no|na|nos|nas|um|uma|para|por|pelo|pela)\b\s*/gi,
    /\b(pasta|folder|diretorio|diretorio|arquivo|file|programa|aplicativo|app)\b\s*/gi,
    /\b(me|mim|eu|por favor|pfv|pf)\b\s*/gi,
    /[\s,;:!?]+/g,
  ]
  let cleaned = q
  for (const pattern of removePatterns) {
    cleaned = cleaned.replace(pattern, ' ').trim()
  }
  return cleaned || q
}

async function debugLog(msg, momai) {
  try {
    if (momai?.log) momai.log(msg)
    else console.log(`[launcher] ${msg}`)
  } catch {}
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Module Exports
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

module.exports = {
  tools: [
    {
      name: 'search_local_items',
      description: 'Busca pastas, arquivos, programas e aplicativos no computador local por nome. Uma busca basta: nao repita com parafrases, decida pelo score. Depois de escolher o caminho, chame open_local_item e continue com desktop_snapshot. Nao pare para perguntar quando a tarefa tem proximos passos (clicar, digitar, automatizar). Retorna caminhos absolutos com score de confianca.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Nome ou termo do item a buscar (pasta, arquivo ou programa)' },
        },
      },
    },
    {
      name: 'open_local_item',
      description: 'Abre pasta, arquivo ou programa pelo caminho absoluto. Use APENAS com caminho absoluto retornado pelo search_local_items. Nunca trava: responde em segundos mesmo se o app ja estiver aberto. Depois de abrir, chame desktop_snapshot para ver a janela e continuar a tarefa.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Caminho absoluto do item' },
          name: { type: 'string', description: 'Nome do item para confirmacao' },
        },
      },
    },
    {
      name: 'desktop_launch',
      description: 'Opens any PROGRAM via Windows Search (Start menu): presses the Windows key, types the name and confirms. Preferred way to open programs (Edge, Firefox, Calculator, Settings, Store apps). Needs no snapshot and no focused window. For FILES and FOLDERS use search_local_items instead.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Program name to launch (e.g. Calculadora, Edge, Firefox)' },
        },
      },
    },
    {
      name: 'desktop_act',
      description: 'Runs a WHOLE desktop task in ONE call (preferred for open-then-click-then-type flows): pass steps like [{op:"launch",query:"Word"},{op:"click",name:"Documento em branco"},{op:"type",role:"Document",text:"Hello word"}]. Ops: launch (program via Windows Search), click/type/press (by visible element "name" and optional "role", resolved on a fresh screen with retries: name+role then name only; "name" may be empty when "role" alone identifies it), wait (ms). Page limits apply (max action steps, max minutes). Use the primitives (desktop_snapshot/click/type) only to explore an unknown screen first. Opaque screens (canvas, games) are not clickable â€” use desktop_describe to answer what is on them.',
      parameters: {
        type: 'object',
        required: ['steps'],
        properties: {
          objective: { type: 'string', description: 'Short goal shown on the MomAI Desktop page' },
          steps: {
            type: 'array',
            description: 'Steps in order. click/type/press need "name" (visible element name) and optional "role". type needs "text" (+optional submit:true). press needs "key" (SendKeys syntax). wait needs "ms".',
            items: { type: 'object' },
          },
        },
      },
    },
    {
      name: 'desktop_snapshot',
      description: 'Reads the foreground window through the Windows accessibility tree and lists clickable elements as numbered refs. Always call this first before desktop_find/click/type/press, and again whenever the screen changes. Element analysis must use this tree, never pixel coordinates.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'active (foreground window, default) or desktop (whole desktop, heavier)' },
          objective: { type: 'string', description: 'Short goal of this run, shown on the MomAI Desktop page' },
        },
      },
    },
    {
      name: 'desktop_find',
      description: 'Searches the last desktop_snapshot for an element by visible name. Returns matching refs.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Visible element name to find (e.g. Salvar)' },
          role: { type: 'string', description: 'Optional control role filter (e.g. Button, Edit, MenuItem)' },
          snapshotId: { type: 'string', description: 'Snapshot id (defaults to the latest)' },
        },
      },
    },
    {
      name: 'desktop_click',
      description: 'Clicks an element from a desktop_snapshot by ref, using the native UI pattern when available. The element window is brought to front automatically. Refs expire when the screen changes: take a new desktop_snapshot and retry with the new ref.',
      parameters: {
        type: 'object',
        required: ['ref'],
        properties: {
          ref: { type: 'number', description: 'Element ref from desktop_snapshot' },
          snapshotId: { type: 'string', description: 'Snapshot id (defaults to the latest)' },
        },
      },
    },
    {
      name: 'desktop_type',
      description: 'Types text into an element from a desktop_snapshot by ref.',
      parameters: {
        type: 'object',
        required: ['ref', 'text'],
        properties: {
          ref: { type: 'number', description: 'Element ref from desktop_snapshot' },
          text: { type: 'string', description: 'Text to type' },
          submit: { type: 'boolean', description: 'Press Enter after typing' },
          snapshotId: { type: 'string', description: 'Snapshot id (defaults to the latest)' },
        },
      },
    },
    {
      name: 'desktop_press',
      description: 'Presses a key while an element from a desktop_snapshot has focus. Keys use SendKeys syntax, e.g. {ENTER}, {TAB}, ^c.',
      parameters: {
        type: 'object',
        required: ['ref', 'key'],
        properties: {
          ref: { type: 'number', description: 'Element ref from desktop_snapshot' },
          key: { type: 'string', description: 'Key to press (SendKeys syntax)' },
          snapshotId: { type: 'string', description: 'Snapshot id (defaults to the latest)' },
        },
      },
    },
    {
      name: 'desktop_get_run',
      description: 'Shows one desktop automation run with its step timeline for the MomAI Desktop page card.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run id (defaults to the latest active run)' },
        },
      },
    },
    {
      name: 'desktop_list_runs',
      description: 'Lists recent desktop automation runs.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max runs to list (default 10)' },
        },
      },
    },
    {
      name: 'desktop_stop_run',
      description: 'Stops an active desktop automation run.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run id (defaults to the latest active run)' },
        },
      },
    },
    {
      name: 'desktop_get_frames',
      description: 'Returns the replay screenshots of a desktop run for the MomAI Desktop page (titles + images). Page use; the model does not need to call this.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run id (defaults to the latest active run)' },
        },
      },
    },
    {
      name: 'desktop_settings',
      description: 'Reads or updates MomAI Desktop guardrails (allowed apps, limits, replay, safe-stop). Call with no arguments to read.',
      parameters: {
        type: 'object',
        properties: {
          allowedApps: { type: 'array', description: 'Process names allowed for automation (empty allows all)', items: { type: 'string' } },
          recordVisuals: { type: 'boolean', description: 'Save one screenshot per step for the replay (default true)' },
          maxSteps: { type: 'number', description: 'Max action steps per desktop_act run (default 10)' },
          maxRunMinutes: { type: 'number', description: 'Max minutes per run before it stops itself, 0 disables (default 10)' },
          safeStop: { type: 'boolean', description: 'Stop the run when the foreground app changes unexpectedly (default true)' },
        },
      },
    },
    {
      name: 'desktop_describe',
      description: 'Looks at the current screen and describes it in detail, or answers a question about what is visible. Use when the user asks what is on screen, or to orient in a tricky opaque area (canvas, custom UI). Needs a vision-capable model; otherwise explains the limit.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'What to detail about the screen (default: describe everything visible)' },
          screen: { type: 'number', description: 'Display index for multi-monitor setups (default: primary)' },
        },
      },
    },
    {
      name: 'desktop_screenshot',
      description: 'Shows the current screen to the USER as images in chat (one per display, or a single display via "screen"). Use when the user wants to SEE the screen, or asks what is on it and also wants the image. For the model to orient itself, use desktop_describe instead.',
      parameters: {
        type: 'object',
        properties: {
          screen: { type: 'number', description: 'Display index (default: all displays)' },
        },
      },
    },
  ],

  async execute({ content, args, toolName, momai }) {
    const text = String(content || '').trim()
    await debugLog(`execute called: toolName=${toolName}, text="${text.slice(0, 80)}"`, momai)

    /* â”€â”€ desktop_* (computer use via accessibility tree) â”€â”€ */
    if (typeof toolName === 'string' && toolName.startsWith('desktop_')) {
      return await handleDesktopTool({ toolName, args, content, momai })
    }

    /* â”€â”€ open_local_item â”€â”€ */
    if (toolName === 'open_local_item') {
      const targetPath = String(args?.path || '').trim()
      const targetName = String(args?.name || path.basename(targetPath)).trim()

      if (!targetPath) {
        return {
          tool: 'open_local_item',
          instruction: 'Caminho do item nao fornecido.',
        }
      }

      const result = await openItem(targetPath)
      if (result.ok) {
        /* Text only: the single run card appears at the end of the task. */
        return {
          tool: 'open_local_item',
          instruction: JSON.stringify({ ok: true, message: `"${targetName}" aberto com sucesso.`, path: targetPath, next: 'Chame desktop_snapshot para ver a janela e continuar a tarefa.' }),
        }
      }
      return {
        tool: 'open_local_item',
        instruction: `Nao foi possivel abrir: ${result.error}`,
      }
    }

    /* â”€â”€ search_local_items â”€â”€ */
    const rawQuery = toolName === 'search_local_items' ? (String(args?.query || content || '')).trim() : text
    const searchTerms = extractSearchTerms(rawQuery)
    await debugLog(`search: raw="${rawQuery.slice(0, 80)}" terms="${searchTerms.slice(0, 80)}"`, momai)

    const allItems = getOrRefreshIndex()
    await debugLog(`scan: total=${allItems.length} items in index`, momai)

    const scored = allItems
      .map((item) => ({ ...item, score: scoreItem(item, searchTerms) }))
      .filter((item) => item.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)

    await debugLog(`scored: ${scored.length} results after filtering (threshold=0.1)`, momai)
    if (scored.length > 0) {
      const top3 = scored.slice(0, 3).map(i => `${i.name}(${Math.round(i.score*100)}% ${i.type})`).join(', ')
      await debugLog(`top: ${top3}`, momai)
    }

    if (scored.length === 0) {
      return {
        tool: 'search_local_items',
        instruction: `Nenhum resultado encontrado para "${rawQuery}".`,
      }
    }

    /* Auto-open ONLY when:
       1. User explicitly says "abra X" / "abrir X" (isExplicitOpenQuery)
       2. AND there is a PERFECT match (score === 1.0)
       Otherwise, show results and ask the user which one to open. */
    if (isExplicitOpenQuery(rawQuery)) {
      const perfectMatch = scored.find((item) => item.score >= 1.0)
      if (perfectMatch) {
        const result = await openItem(perfectMatch.path)
        if (result.ok) {
          /* Text only: the single run card appears at the end of the task. */
          return {
            tool: 'search_local_items',
            instruction: JSON.stringify({ ok: true, message: `"${perfectMatch.name}" encontrado e aberto automaticamente.`, path: perfectMatch.path, next: 'Chame desktop_snapshot para ver a janela e continuar a tarefa.' }),
          }
        }
      }
    }

    return {
      tool: 'search_local_items',
      instruction: JSON.stringify({
        results: scored.map((item) => ({ name: item.name, path: item.path, type: item.type, category: item.category, score: Math.round(item.score * 100) / 100 })),
        total: scored.length,
        message: scored.length === 1
          ? `Encontrado 1 resultado para "${rawQuery}". Abra com open_local_item e continue a tarefa com desktop_snapshot.`
          : `Encontrados ${scored.length} resultados para "${rawQuery}". Abra o melhor com open_local_item (prefira Programa/Atalho com maior score) e continue a tarefa com desktop_snapshot. So pergunte ao usuario qual abrir se dois candidatos forem igualmente provaveis E a tarefa for SOMENTE abrir, sem proximos passos.`,
      }),
    }
  },
}

/* FunÃ§Ãµes puras exportadas apenas para testes unitÃ¡rios (sem I/O).
   O host lÃª apenas `.tools` e `.execute`; este campo Ã© aditivo e nÃ£o
   altera o comportamento de runtime. */
module.exports.__internals = {
  normalizeAccents,
  buildVocabulary,
  filterQueryWords,
  scoreNameMatch,
  extractSearchTerms,
  inferCategory,
  isFolderQuery,
  isFileQuery,
  isExplicitOpenQuery,
}
