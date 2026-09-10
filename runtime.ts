const fs = require('node:fs')
const path = require('node:path')
const nodeUrl = require('node:url')
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

const START_APPS_CACHE = { items: null, timestamp: 0 }
const START_APPS_TTL_MS = 5 * 60_000

function fetchStartApps() {
  return new Promise<any>((resolve) => {
    if (process.platform !== 'win32') return resolve([])
    const now = Date.now()
    if (START_APPS_CACHE.items && now - START_APPS_CACHE.timestamp < START_APPS_TTL_MS) {
      return resolve(START_APPS_CACHE.items)
    }
    let timer = null
    const done = (items) => {
      if (timer) clearTimeout(timer)
      START_APPS_CACHE.items = items
      START_APPS_CACHE.timestamp = Date.now()
      resolve(items)
    }
    try {
      const child = exec(
        'powershell.exe -NoProfile -NonInteractive -Command "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"',
        { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return done(START_APPS_CACHE.items || [])
          return done(parseStartAppsOutput(stdout))
        }
      )
      timer = setTimeout(() => {
        try { if (child) child.kill() } catch {}
        done(START_APPS_CACHE.items || [])
      }, 9000)
    } catch {
      done(START_APPS_CACHE.items || [])
    }
  })
}

function openShellAppsFolderPath(shellPath) {
  return new Promise<any>((resolve) => {
    const raw = String(shellPath || '').trim()
    if (!isShellAppsFolderPath(raw)) return resolve({ ok: false, error: 'Not a store path' })
    const built = buildStartAppsLaunchCommand(raw.replace(/^shell:appsfolder\\/i, ''))
    if (!built.ok) return resolve({ ok: false, error: built.error })
    let settled = false
    let timer = null
    const done = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    try {
      exec(`powershell.exe -NoProfile -NonInteractive -Command "${built.command}"`, { timeout: 10000, windowsHide: true }, (err) => {
        if (err) return done({ ok: false, error: err.message })
        openedInSession.add(raw)
        return done({ ok: true, path: raw })
      })
      timer = setTimeout(() => {
        openedInSession.add(raw)
        done({ ok: true, path: raw })
      }, 10000)
    } catch (err) {
      return done({ ok: false, error: err.message })
    }
  })
}

function openItem(itemPath) {
  return new Promise<any>((resolve) => {
    const raw = String(itemPath || '').trim()
    if (!raw) return resolve({ ok: false, error: 'Caminho vazio' })
    if (isShellAppsFolderPath(raw)) return openShellAppsFolderPath(raw).then(resolve)
    const normalized = path.resolve(raw)
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
    closed: (x) => `Fechei "${x}"`,
    wentto: (x) => `Fui para "${x}"`,
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
    closed: (x) => `Closed "${x}"`,
    wentto: (x) => `Went to "${x}"`,
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

/* Generic desktop_act helpers (pure, unit-tested). Close stays
   app-agnostic: window chrome button first, Alt+F4 as fallback. */
function isDesktopActActionOp(op) {
  const v = String(op || '').trim().toLowerCase()
  return v === 'launch' || v === 'click' || v === 'type' || v === 'press' || v === 'close' || v === 'goto'
}

function keyboardFallbackKey(name) {
  const raw = String(name || '').trim()
  if (!raw) return null
  if (raw.length === 1) {
    return /[0-9+\-*/=.,()%]/.test(raw) ? raw : null
  }
  const lower = raw.toLowerCase()
  if (lower === 'enter' || lower === 'return') return '{ENTER}'
  if (lower === 'tab') return '{TAB}'
  if (lower === 'escape' || lower === 'esc') return '{ESC}'
  if (lower === 'backspace') return '{BACKSPACE}'
  if (lower === 'delete' || lower === 'del') return '{DEL}'
  return null
}

function closeButtonCandidates() {
  return [
    { name: 'Close', role: 'Button' },
    { name: 'Fechar', role: 'Button' },
  ]
}

/* Launch verification: did the requested program actually take the
   foreground? Matches query words against process name and window title
   (both normalized), so a miss fails loudly instead of automating the
   wrong window. Never compares against hardcoded program names. */
function launchQueryWords(query) {
  const norm = (s) => normalizeAccents(String(s || '')).toLowerCase()
  const words = new Set<string>()
  for (const src of [norm(query), norm(extractSearchTerms(query))]) {
    for (const w of src.split(/[^a-z0-9]+/)) {
      if (w.length > 2) words.add(w)
    }
  }
  return [...words]
}

function doesLaunchMatchApp(query, appName, windowTitle) {
  const norm = (s) => normalizeAccents(String(s || '')).toLowerCase()
  const app = norm(appName)
  const title = norm(windowTitle)
  if (!app && !title) return false
  const hay = `${app} ${title}`
  const words = launchQueryWords(query)
  if (words.length === 0) return false
  for (const w of words) {
    if (hay.includes(w)) return true
  }
  return false
}

/* Finds an already-open top-level window matching the requested program
   (title match wins over process-only match). Lets launch bind to a
   window behind the user's foreground instead of reopening the app. */
function findLaunchWindow(windows, query) {
  const list = Array.isArray(windows) ? windows : []
  const words = launchQueryWords(query)
  if (list.length === 0 || words.length === 0) return null
  const norm = (s) => normalizeAccents(String(s || '')).toLowerCase()
  let best = null
  let bestScore = 0
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const title = norm(entry.title)
    const app = norm(entry.app)
    if (!title && !app) continue
    let score = 0
    for (const w of words) {
      if (title && title.includes(w)) score += 2
      else if (app && app.includes(w)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  if (!best || bestScore <= 0) return null
  /* A match without a window handle can't be bound: treat as no match. */
  if (!normalizeHwnd(best.hwnd)) return null
  return {
    hwnd: normalizeHwnd(best.hwnd),
    title: String(best.title || ''),
    app: String(best.app || ''),
  }
}

/* Miss message that keeps the last underlying reason (not found vs
   focus lost vs occluded) so a stop explains itself. */
function formatActMissError(name, role, lastError) {
  const target = String(name || role || 'element')
  const detail = String(lastError || '').trim()
  if (!detail) return `Element "${target}" could not be acted on.`
  return `Element "${target}" could not be acted on (${detail})`
}

/* Recovery hint for a failed act step: keyboard fallback for digits,
   relaunch when the bound window is gone, launch-first when nothing was
   ever bound (the program may simply be closed). */
function buildActFailHint(input) {
  const src = input && typeof input === 'object' ? input : {}
  const parts = []
  if (String(src.op || '') === 'click') {
    const fallback = keyboardFallbackKey(src.effName)
    if (fallback) parts.push(`try {op:"press", key:"${fallback}"} instead of clicking`)
  }
  if (src.stale === true) {
    parts.push('the bound window is gone — relaunch the program (launch step) before clicking')
  } else if (!normalizeHwnd(src.bound)) {
    parts.push('if the program isn\'t open, begin the sequence with {op:"launch",query:"..."} instead of clicking')
  }
  if (parts.length === 0) return ''
  return ` — ${parts.join('; ')}`
}

/* Terminal directive: a stop adjusts and retries; a DONE only confirms the
   planned steps — the model must verify the OBJECTIVE is fully met and keep
   going with another act call instead of summarizing halfway. */
function buildActTerminalInstruction(input) {
  const src = input && typeof input === 'object' ? input : {}
  const lines = String(src.lines || '')
  const finalText = String(src.finalText || '')
  if (src.aborted === true) {
    return `TASK STOPPED at step ${src.outcomesLength} of ${src.stepsLength}:\n${lines}\nCURRENT SCREEN:\n${finalText}\nDecida: ajuste e chame desktop_act de novo, ou avise o usuario. Nao explique passo manual.`
  }
  return `TASK DONE (${src.outcomesLength}/${src.stepsLength}):\n${lines}\nCURRENT SCREEN:\n${finalText}\nDONE confirma só os passos — confira se o OBJETIVO está 100% cumprido: se faltar algo, chame desktop_act de novo com os passos restantes NUMA chamada em vez de resumir. Só resuma quando tudo estiver feito, e nunca despeje instruções manuais para o usuário.`
}

/* Loop guard: fingerprint of an act plan so an identical failed sequence
   can't burn rounds forever. Text bodies count by prefix only (fixing a
   typo is a new plan, not a repeat). */
function actCallSignature(objective, steps) {
  const list = Array.isArray(steps) ? steps : []
  const short = list.map((s) => {
    const step = s && typeof s === 'object' ? s : {}
    return [
      String(step.op || ''),
      String(step.query || step.name || step.role || step.key || step.url || ''),
      String(step.text || '').slice(0, 40),
      Number(step.ms || 0),
      step.submit === true,
    ].join('|')
  })
  return `${String(objective || '')} :: ${short.join(' ;; ')}`
}

/* Blocks the third identical failed attempt in a row: repeating the same
   plan twice already proved it doesn't work — the model must change names,
   order, or explore first. Successes and different plans reset the count. */
function shouldBlockActRepeat(history, sig) {
  const list = Array.isArray(history) ? history : []
  const key = String(sig || '')
  if (!key) return { blocked: false, fails: 0 }
  let fails = 0
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i] && typeof list[i] === 'object' ? list[i] : {}
    if (String(entry.sig || '') !== key) break
    if (entry.ok === true) return { blocked: false, fails: 0 }
    fails++
  }
  return { blocked: fails >= 2, fails }
}

/* True when a miss smells like stolen focus (not a wrong name or a gone
   window): the caller may bring the bound window back once and retry. */
function shouldRefocusWindow(boundHwnd, lastError) {
  if (!normalizeHwnd(boundHwnd)) return false
  const msg = String(lastError || '')
  if (!msg) return false
  if (/window_gone|nao encontrado|not found|not in this snapshot/i.test(msg)) return false
  return /background_occluded|foreground|focus|foco|mudou|trocou/i.test(msg)
}

/* Resolves a snapshot app filter (string or array, as the model passes
   apps) against open windows. Pure: the caller lists the windows. */
function resolveAppScope(apps, windows) {
  const list = Array.isArray(apps) ? apps : (apps ? [apps] : [])
  const query = list.map((a) => String(a || '').trim()).filter(Boolean).join(' ')
  if (!query) return null
  const found = findLaunchWindow(windows, query)
  if (!found) return null
  return { hwnd: found.hwnd, query, title: found.title, app: found.app }
}

/* Shapes the launch step result: ok only when the requested program owns
   the foreground, loud failure otherwise (never automate/blind-bind the
   wrong window). Pure so the wording stays covered by tests. */
function buildLaunchOutcome(input) {
  const src = input && typeof input === 'object' ? input : {}
  const query = String(src.query || '')
  const where = String(src.where || '"unknown window"')
  const matched = doesLaunchMatchApp(query, src.postApp, src.postTitle)
  if (!matched) {
    return {
      ok: false,
      outcome: `launch "${query}": FAILED (foreground is ${where} — the app didn't open; retry ONLY the launch step, don't click, don't open anything else)`,
    }
  }
  const already = src.unchanged === true
  return {
    ok: true,
    outcome: already
      ? `launch "${query}": ok (${where}) — already open, continuing in this window`
      : `launch "${query}": ok (${where})`,
  }
}

/* Window binding (mouse-independent tasks): a run sticks to the window
   handle it first acted on instead of whatever owns the foreground.
   0 means unscoped (foreground behavior, as before). */
function normalizeHwnd(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.trunc(n)
}

/* True when the acted window belongs to the same app under a different
   handle (new window, dialog): safe to follow. Never across apps. */
function shouldRebindWindow(boundApp, foundApp, boundHwnd, foundHwnd) {
  const from = normalizeHwnd(boundHwnd)
  const to = normalizeHwnd(foundHwnd)
  if (!from || !to || from === to) return false
  const a = String(boundApp || '').trim().toLowerCase()
  const b = String(foundApp || '').trim().toLowerCase()
  if (!a || !b || a !== b) return false
  return true
}

/* Navigation target guard: only web addresses go through the browser
   shortcut flow; anything else is refused before any keystroke. */
function normalizeGotoUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return { ok: false, error: 'Empty URL' }
  if (/\s/.test(value)) return { ok: false, error: 'URL must not contain spaces' }
  const schemeMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, error: `Refused URL scheme "${scheme}"` }
    }
    try {
      const parsed = new nodeUrl.URL(value)
      if (!parsed.hostname) return { ok: false, error: 'URL has no host' }
      return { ok: true, url: value }
    } catch {
      return { ok: false, error: 'Invalid URL' }
    }
  }
  const candidate = `https://${value}`
  try {
    const parsed = new nodeUrl.URL(candidate)
    if (!parsed.hostname) return { ok: false, error: 'URL has no valid host' }
    return { ok: true, url: candidate }
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
}

/* SendKeys treats + ^ % ~ ( ) [ ] { } as modifiers: escape them in one
   pass so an address is typed literally. */
function escapeSendKeysText(text) {
  const token = {
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
  return String(text || '').replace(/[{}\+\^%~\(\)\[\]]/g, (ch) => token[ch] || ch)
}

/* Reads the screen right after an action so the model can keep going
   without remembering to snapshot: returns fresh-screen text or ''. */
async function followupScreen(run, scope, maxLines) {
  try {
    const boundHwnd = scope === 'desktop' ? 0 : normalizeHwnd(run.targetHwnd)
    const fresh = await uiaProvider.dumpTree(scope === 'desktop' ? 'desktop' : 'active', boundHwnd)
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
      hwnd: normalizeHwnd(fresh.hwnd),
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
    hwnd: normalizeHwnd(res.hwnd),
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
  const base = path.basename(dataDir) === 'data' ? path.dirname(dataDir) : dataDir
  const next = path.join(base, 'app-cache', 'extensions', extId, 'cache', 'frames')
  migrateLegacyFramesDir(dataDir, extId, next)
  return next
}

// One-time move from the pre-unification home inside the extension storage
// dir. Idempotent: only runs while the new home is still missing.
function migrateLegacyFramesDir(dataDir, extId, next) {
  try {
    if (fs.existsSync(next)) return
    const legacy = path.join(dataDir, 'extensions', extId, 'frames')
    if (!fs.existsSync(legacy)) return
    fs.mkdirSync(path.dirname(next), { recursive: true })
    fs.renameSync(legacy, next)
  } catch {
    /* best effort */
  }
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
      || params.backgroundOnly !== undefined
      || params.askBeforeForeground !== undefined
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
    /* Background-first: the taskbar search index (Get-StartApps) resolves
       Store and desktop programs to a direct launch with no keystrokes and
       no cursor motion. The simulated Start menu below stays only as a
       last resort for names outside every index. */
    try {
      const startApps = await fetchStartApps()
      const best = findBestStartApp(startApps, query)
      if (best) {
        const opened = await openShellAppsFolderPath(`shell:AppsFolder\\${best.appId}`)
        if (opened && opened.ok === true) {
          const launchStepLabel = `${t('launched', best.name)} (segundo plano)`
          desktopRuns.appendStep(run.id, { kind: 'action', label: launchStepLabel })
          await desktopRuns.emitRunEvent(momai, 'desktop_run_step', { runId: run.id, kind: 'action', label: launchStepLabel })
          const launchSettings = await desktopRuns.loadSettings(momai)
          const screen = await followupScreen(run, 'active', 18)
          if (launchSettings.recordVisuals !== false) {
            await captureRunFrame(run, launchStepLabel, stepContext(run.snapshotApp, run.snapshotTitle))
          }
          const instruction = screen.text
            ? `Launched "${best.name}" without taking the mouse or keyboard.\nTELA ATUAL (use SOMENTE estas refs):\n${screen.text}\nPROXIMO PASSO OBRIGATORIO: continue a tarefa com desktop_find, desktop_click ou desktop_type usando as refs ACIMA, escrevendo 1 linha de progresso junto. Nao escreva a resposta final antes de concluir.`
            : JSON.stringify({ ok: true, action: `Launched "${best.name}"`, runId: run.id, delivery: 'background', next: 'Chame desktop_snapshot para ver a janela e continuar a tarefa.' })
          return { tool: toolName, instruction }
        }
      }
    } catch {
      /* fall through to the legacy path below */
    }
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
    /* Loop guard: the same plan failing identically twice already proved it
       doesn't work — refuse a third identical run so rounds aren't burned
       in a loop. Successes and different plans reset the count. */
    const callSig = actCallSignature(objective, steps)
    const repeatCheck = shouldBlockActRepeat(run.actHistory, callSig)
    if (repeatCheck.blocked) {
      return {
        tool: toolName,
        instruction: `Same sequence already failed ${repeatCheck.fails} times identically — refusing to burn more rounds on it. Change the plan instead: different element names (confirm with desktop_snapshot first), a different order, or fewer steps (type once and move with Tab/Enter instead of clicking field by field). Don't call desktop_act again with these steps.`,
      }
    }

    async function actSnapshot(scope) {
      let best = null
      const boundHwnd = scope === 'desktop' ? 0 : normalizeHwnd(run.targetHwnd)
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleepMs(800)
        try {
          const dump = await uiaProvider.dumpTree(scope === 'desktop' ? 'desktop' : 'active', boundHwnd)
          if (dump && dump.ok === true && Array.isArray(dump.nodes) && dump.nodes.length >= 3) {
            const assigned = uiaNodes.assignRefs(dump.nodes, { maxNodes: 120, maxDepth: 8 })
            const snapshot = {
              nodes: assigned.nodes,
              truncated: assigned.truncated || dump.truncated === true,
              totalSeen: assigned.totalSeen,
              appName: String(dump.appName || ''),
              windowTitle: String(dump.windowTitle || ''),
              hwnd: normalizeHwnd(dump.hwnd),
              scope: scope === 'desktop' ? 'desktop' : 'active',
            }
            const id = desktopRuns.putSnapshot(snapshot)
            run.snapshotId = id
            if (snapshot.appName) run.snapshotApp = snapshot.appName
            if (snapshot.windowTitle) run.snapshotTitle = snapshot.windowTitle
            const result = { snapshot, id, boundStale: dump.boundStale === true }
            /* A stale binding means the bound window is gone: drop it so
               later steps fall back to the foreground, and let the caller
               say relaunch is appropriate. */
            if (result.boundStale) run.targetHwnd = 0
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
       locales). Never quits after 1 miss. Scoped to the bound window when
       the run has one, so user clicks elsewhere don't hijack the task. */
    type ActNameResult =
      | { ok: true; label: string; snapshotId: string | null; rebound: boolean; stale: boolean; refocused: boolean }
      | { ok: false; error: string; stale?: boolean }
    async function actOnName(op, name, role, extra): Promise<ActNameResult> {
      const invokeOpts = extra && typeof extra === 'object' ? { ...extra } : {}
      const boundHwnd = normalizeHwnd(run.targetHwnd)
      async function attemptMerged(round, hwnd) {
        try {
          return await uiaProvider.actOnTree({
            findName: round.name,
            findRole: round.role,
            action: op,
            ...(hwnd ? { hwnd } : {}),
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
      let lastError = ''
      let sawStale = false
      /* Shared success path (binding/rebind bookkeeping lives here so the
         refocus retry below behaves exactly like a first-try success). */
      type ActNameSuccess = Extract<ActNameResult, { ok: true }>
      const handleSuccess = (res): ActNameSuccess => {        /* Capture the bound identity BEFORE ingesting: ingest
           refreshes run.snapshotApp to the found window. */
        const boundApp = String(run.snapshotApp || '')
        const ingested = ingestReturnedTree(run, res, 'active', 0)
        const foundHwnd = normalizeHwnd(res.hwnd)
        const foundApp = String(res.appName || '')
        let rebound = false
        let stale = false
        if (boundHwnd && res.boundStale === true) {
          /* Bound window is gone: unbind so later steps read the
             foreground, and report relaunch as appropriate. */
          run.targetHwnd = 0
          stale = true
        } else if (!boundHwnd && foundHwnd) {
          run.targetHwnd = foundHwnd
        } else if (shouldRebindWindow(boundApp, foundApp, boundHwnd, foundHwnd)) {
          run.targetHwnd = foundHwnd
          rebound = true
        }
        return {
          ok: true,
          label: res.name || name || role,
          snapshotId: ingested ? ingested.snapshotId : null,
          rebound,
          stale,
          refocused: false,
        }
      }
      for (const round of rounds) {
        /* Scoped first (bound window survives user focus changes), then
           foreground retries for windows the app opened meanwhile. The
           scoped tree is stable, so one attempt is enough there. */
        const scopes = boundHwnd ? [boundHwnd, 0] : [0]
        for (const hwnd of scopes) {
          const tries = hwnd ? 1 : 2
          for (let attempt = 0; attempt < tries; attempt++) {
            const res = await attemptMerged(round, hwnd)
            if (res && res.ok === true) return handleSuccess(res)
            if (res && res.error) lastError = String(res.error)
            if (res && res.boundStale === true) sawStale = true
            await sleepMs(700)
          }
        }
      }
      /* A stale miss means the bound window closed mid-task: drop the
         binding now so the hint below (and later steps) relaunch instead
         of reading a dead handle. Computed after every attempt above. */
      const dropStaleBinding = () => {
        if (sawStale && boundHwnd && normalizeHwnd(run.targetHwnd) === boundHwnd) {
          run.targetHwnd = 0
          return true
        }
        return false
      }
      /* Single self-healing pass: when the failure smells like stolen focus
         (not a wrong name or a gone window), bring the bound window back
         once and retry scoped. Anything else stops with the real reason. */
      if (shouldRefocusWindow(boundHwnd, lastError)) {
        const refocus = await actInvoke({ action: 'focuswindow', hwnd: boundHwnd })
        if (refocus && refocus.ok === true) {
          for (const round of rounds) {
            const res = await attemptMerged(round, boundHwnd)
            if (res && res.ok === true) {
              const out = handleSuccess(res)
              out.refocused = true
              return out
            }
            if (res && res.error) lastError = String(res.error)
            if (res && res.boundStale === true) sawStale = true
            await sleepMs(700)
          }
        } else if (refocus && /window_gone/i.test(String(refocus.error || ''))) {
          run.targetHwnd = 0
          return { ok: false, error: formatActMissError(name, role, lastError), stale: true }
        }
      }
      const wentStale = dropStaleBinding()
      if (wentStale) return { ok: false, error: formatActMissError(name, role, lastError), stale: true }
      return { ok: false, error: formatActMissError(name, role, lastError) }
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
      if (isDesktopActActionOp(op)) {
        if (!checkLimits()) break
        actionCount++
      }
      if (op === 'launch') {
        const query = String(step.query || '').trim()
        if (!query) {
          markSkipped('launch: skipped (empty query)')
          continue
        }
        const priorApp = String(run.snapshotApp || '')
        /* A launch starts a new window identity: drop any previous
           binding so the follow-up snapshot binds fresh. */
        run.targetHwnd = 0
        /* Background-first: resolve through the Start index and launch
           directly (no keystrokes, no cursor) so user clicks mid-launch
           can't hijack it. Simulated Start menu stays as fallback for
           names outside every index. */
        let launched = false
        try {
          const startApps = await fetchStartApps()
          const best = findBestStartApp(startApps, query)
          if (best) {
            const opened = await openShellAppsFolderPath(`shell:AppsFolder\\${best.appId}`)
            launched = !!(opened && opened.ok === true)
          }
        } catch {
          /* fall through to the keystroke path below */
        }
        if (!launched) {
          const res = await actInvoke({ action: 'winsearch', text: query })
          if (!res || res.ok !== true) {
            const detail = res && res.error ? res.error : 'unknown error'
            desktopRuns.appendStep(run.id, { kind: 'error', label: `Launch "${query}" failed: ${detail}` })
            outcomes.push(`launch "${query}": FAILED (${detail})`)
            aborted = true
            continue
          }
        }
        {
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
          const postApp = taken ? String(taken.snapshot.appName || '') : ''
          const postTitle = taken ? String(taken.snapshot.windowTitle || '') : ''
          const unchanged = priorApp && postApp
            && priorApp.toLowerCase() === postApp.toLowerCase()
          /* Launch verification: a sent launch is not proof. Bind and
             report ok ONLY when the requested program owns the foreground;
             otherwise fail loudly (a click elsewhere during launch, a slow
             start, or a missed query) so later steps never automate the
             wrong window — and never bind to it. */
          const launchLabel = `${t('launched', query)} → ${where}`
          const decided = buildLaunchOutcome({ query, where, postApp, postTitle, unchanged })
          if (!decided.ok) {
            /* The program may be open behind the user's foreground window
               (a click mid-launch keeps focus elsewhere): bind to the
               existing window instead of failing and reopening it. */
            let reboundWindow = null
            try {
              const listed = await uiaProvider.listWindows()
              const wins = listed && listed.ok === true && Array.isArray(listed.windows) ? listed.windows : []
              reboundWindow = findLaunchWindow(wins, query)
            } catch {
              reboundWindow = null
            }
            if (reboundWindow) {
              run.targetHwnd = normalizeHwnd(reboundWindow.hwnd)
              if (reboundWindow.app) run.snapshotApp = reboundWindow.app
              if (reboundWindow.title) run.snapshotTitle = reboundWindow.title
              const bgLabel = `${t('launched', query)} → "${reboundWindow.title || reboundWindow.app}"`
              desktopRuns.appendStep(run.id, { kind: 'action', label: bgLabel })
              outcomes.push(`launch "${query}": ok ("${reboundWindow.title || reboundWindow.app}" was already open behind ${where} — bound, continuing without reopening or stealing focus)`)
              continue
            }
            desktopRuns.appendStep(run.id, { kind: 'error', label: `Launch "${query}" missed: foreground is ${where}` })
            outcomes.push(decided.outcome)
            aborted = true
            continue
          }
          /* Bind the run to the launched window: later steps read and act
             on this window even if the user clicks elsewhere. */
          if (taken) run.targetHwnd = normalizeHwnd(taken.snapshot.hwnd)
          desktopRuns.appendStep(run.id, { kind: 'action', label: launchLabel })
          if (recordFrames) await captureRunFrame(run, launchLabel, stepContext(taken ? taken.snapshot.appName : '', taken ? taken.snapshot.windowTitle : ''))
          outcomes.push(decided.outcome)
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
        if (res.ok === true) {
          await sleepMs(600)
          const stepLabel = op === 'click' ? t('clicked', res.label) : op === 'type' ? t('typed', res.label) : t('pressed', res.label)
          desktopRuns.appendStep(run.id, { kind: 'action', label: stepLabel })
          if (recordFrames) await captureRunFrame(run, stepLabel, stepContext(run.snapshotApp, run.snapshotTitle))
          const reboundNote = res.rebound ? ` — window changed within "${run.snapshotApp}", rebound and continuing` : ''
          const staleNote = res.stale ? ' — note: the previously bound window is gone; relaunch is appropriate if more steps need it' : ''
          const refocusNote = res.refocused ? ' (brought the window back and retried)' : ''
          outcomes.push(`${op} "${effName || effRole}"${autoTarget}: ok ("${res.label}")${reboundNote}${staleNote}${refocusNote}`)
        } else {
          desktopRuns.appendStep(run.id, { kind: 'error', label: `${op} "${effName}" failed: ${res.error}` })
          const hint = buildActFailHint({ op, effName, stale: res.stale === true, bound: normalizeHwnd(run.targetHwnd) })
          outcomes.push(`${op} "${effName}": FAILED (${res.error})${hint}`)
          aborted = true
        }
      } else if (op === 'close') {
        let closed = false
        for (const candidate of closeButtonCandidates()) {
          const res = await actOnName('click', candidate.name, candidate.role, {})
          if (res && res.ok === true) {
            await sleepMs(600)
            const stepLabel = t('closed', res.label)
            desktopRuns.appendStep(run.id, { kind: 'action', label: stepLabel })
            if (recordFrames) await captureRunFrame(run, stepLabel, stepContext(run.snapshotApp, run.snapshotTitle))
            outcomes.push(`close: ok ("${res.label}")${res.refocused ? ' (brought the window back and retried)' : ''}`)
            closed = true
            break
          }
        }
        if (!closed) {
          const taken = await actSnapshot('active')
          const nodes = taken ? taken.snapshot.nodes : []
          const picked = nodes.find((n) => String(n.name || '').trim() !== '') || null
          if (!picked) {
            desktopRuns.appendStep(run.id, { kind: 'error', label: 'close failed: empty screen' })
            outcomes.push('close: FAILED (no target on screen)')
            aborted = true
          } else {
            const res = await actOnName('press', String(picked.name || ''), String(picked.control || ''), { key: '%{F4}' })
            if (res.ok === true) {
              await sleepMs(600)
              const stepLabel = t('closed', run.snapshotApp || run.snapshotTitle || res.label)
              desktopRuns.appendStep(run.id, { kind: 'action', label: stepLabel })
              if (recordFrames) await captureRunFrame(run, stepLabel, stepContext(run.snapshotApp, run.snapshotTitle))
              outcomes.push(`close: ok (Alt+F4 via "${res.label}")${res.refocused ? ' (brought the window back and retried)' : ''}`)
            } else {
              desktopRuns.appendStep(run.id, { kind: 'error', label: `close failed: ${res.error}` })
              outcomes.push(`close: FAILED (${res.error})`)
              aborted = true
            }
          }
        }
      } else if (op === 'goto') {
        const rawUrl = String(step.url || '').trim()
        if (!rawUrl) {
          markSkipped('goto: skipped (empty url)')
          continue
        }
        const checked = normalizeGotoUrl(rawUrl)
        if (!checked.ok) {
          desktopRuns.appendStep(run.id, { kind: 'error', label: `goto failed: ${checked.error}` })
          outcomes.push(`goto "${rawUrl.slice(0, 80)}": FAILED (${checked.error})`)
          aborted = true
          continue
        }
        /* Address-bar flow without fragile name lookups: Ctrl+L focuses the
           bar in any browser, then the address is typed and confirmed. The
           window handle below steers the keys to the bound window even when
           the user clicked elsewhere; the app check stays as a backstop. */
        const gotoHwnd = normalizeHwnd(run.targetHwnd)
        const res = await actInvoke({
          action: 'gotourl',
          text: escapeSendKeysText(checked.url),
          app: String(run.snapshotApp || ''),
          ...(gotoHwnd ? { hwnd: gotoHwnd } : {}),
        })
        if (res && res.ok === true) {
          await sleepMs(2500)
          const taken = await actSnapshot('active')
          const where = taken ? `"${taken.snapshot.windowTitle || taken.snapshot.appName}"` : 'unknown window'
          const stepLabel = `${t('wentto', checked.url)} → ${where}`
          desktopRuns.appendStep(run.id, { kind: 'action', label: stepLabel })
          if (recordFrames) await captureRunFrame(run, stepLabel, stepContext(taken ? taken.snapshot.appName : '', taken ? taken.snapshot.windowTitle : ''))
          outcomes.push(`goto "${checked.url}": ok (${where})`)
        } else {
          const detail = res && res.error ? res.error : 'unknown error'
          desktopRuns.appendStep(run.id, { kind: 'error', label: `goto failed: ${detail}` })
          outcomes.push(`goto "${checked.url}": FAILED (${detail})`)
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
    /* Terminal record for the loop guard above (best-effort). */
    try {
      const hist = Array.isArray(run.actHistory) ? run.actHistory : []
      hist.push({ sig: callSig, ok: !aborted })
      run.actHistory = hist.slice(-6)
    } catch {
      /* history is best-effort */
    }
    const lines = outcomes.map((o, i) => `${i + 1}. ${o}`).join('\n')
    const finalText = finalScreen.text
    const instruction = buildActTerminalInstruction({
      aborted,
      outcomesLength: outcomes.length,
      stepsLength: steps.length,
      lines,
      finalText,
    })
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
    /* Optional app scope (apps: "Name" or ["Name"]): read that program's
       window even when it sits behind the foreground one, so user clicks
       elsewhere don't hijack the read. */
    let scopedHwnd = 0
    let scopedQuery = ''
    if (scope !== 'desktop' && params.apps !== undefined && params.apps !== null) {
      const wanted = Array.isArray(params.apps) ? params.apps : [params.apps]
      const query = wanted.map((a) => String(a || '').trim()).filter(Boolean).join(' ')
      if (query) {
        let openWindows = []
        try {
          const listed = await uiaProvider.listWindows()
          if (listed && listed.ok === true && Array.isArray(listed.windows)) openWindows = listed.windows
        } catch {
          openWindows = []
        }
        const found = resolveAppScope(wanted, openWindows)
        if (found) {
          scopedHwnd = found.hwnd
          scopedQuery = found.query
        } else {
          /* Not open: fetch it in this same call (background launch, no
             keystrokes, no focus steal) instead of bouncing the model
             through launch + snapshot round-trips it may not have budget
             for. Only when the model explicitly asked for this app. */
          let fetched = null
          try {
            const startApps = await fetchStartApps()
            const best = findBestStartApp(startApps, query)
            if (best) {
              const opened = await openShellAppsFolderPath(`shell:AppsFolder\\${best.appId}`)
              if (opened && opened.ok === true) {
                for (let waitRound = 0; waitRound < 4 && !fetched; waitRound++) {
                  if (waitRound > 0) await sleepMs(1500)
                  let wins = []
                  try {
                    const relisted = await uiaProvider.listWindows()
                    if (relisted && relisted.ok === true && Array.isArray(relisted.windows)) wins = relisted.windows
                  } catch {
                    wins = []
                  }
                  fetched = resolveAppScope(wanted, wins)
                }
              }
            }
          } catch {
            fetched = null
          }
          if (!fetched) {
            return { tool: toolName, instruction: `Could not open "${query}" (not found in the Start index or it failed to start). Tell the user plainly instead of acting on the current screen.` }
          }
          scopedHwnd = fetched.hwnd
          scopedQuery = fetched.query
        }
      }
    }
    let dump = null
    let lastError = ''
    // A freshly opened program may need a moment before its tree appears.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleepMs(800)
      try {
        dump = await uiaProvider.dumpTree(scope, scopedHwnd)
      } catch (err) {
        lastError = err.message
        dump = null
      }
      if (dump && dump.ok === true && Array.isArray(dump.nodes) && dump.nodes.length >= 3) break
      if (dump && dump.ok === true) lastError = ''
    }
    if (scopedHwnd && (!dump || dump.boundStale === true)) {
      return { tool: toolName, instruction: `"${scopedQuery}" closed before it could be read — launch it again, then snapshot.` }
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
      hwnd: normalizeHwnd(dump.hwnd),
      scope,
    }
    const snapshotId = desktopRuns.putSnapshot(snapshot)
    const objective = String(params.objective || content || '').slice(0, 200)
    let run = desktopRuns.latestActiveRun()
    const runFresh = run && Date.now() - Date.parse(run.updatedAt) < 10 * 60 * 1000
    if (!runFresh) run = desktopRuns.createRun(objective)
    else if (objective && !run.objective) run.objective = objective
    run.snapshotId = snapshotId
    /* A scoped read targets the requested app on purpose: bind the run to
       it and never treat the (expected) app difference as focus theft. */
    if (scopedHwnd && snapshot.hwnd) run.targetHwnd = snapshot.hwnd
    /* Continuity guard: acting on app X and then seeing app Y means focus
       moved (user alt-tabbed, popup stole it). Never act blindly then. */
    const lastStep = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null
    const lastWasAction = !!lastStep && (lastStep.kind === 'action' || lastStep.kind === 'error')
    const prevApp = run.snapshotApp
    if (snapshot.appName) run.snapshotApp = snapshot.appName
    if (snapshot.windowTitle) run.snapshotTitle = snapshot.windowTitle
    let focusWarning = ''
    if (!scopedHwnd && lastWasAction && prevApp && snapshot.appName
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
    /* The snapshot's window handle rides along so path-mode resolution
       starts at the snapshot's own window (refs stay valid even when the
       user clicked elsewhere); patterns then act without focus. */
    const snapshotHwnd = normalizeHwnd(resolved.snapshot.hwnd)
    const hwndField = snapshotHwnd ? { hwnd: snapshotHwnd } : {}
    if (toolName === 'desktop_click') {
      payload = { path: node.path, rect: node.rect, name: node.name, app: resolved.snapshot.appName, action: 'click', ...hwndField }
    } else if (toolName === 'desktop_type') {
      const text = String(params.text || '')
      if (!text) {
        return { tool: toolName, instruction: 'Tell me the text to type (text).' }
      }
      payload = { path: node.path, rect: node.rect, name: node.name, app: resolved.snapshot.appName, action: 'setvalue', text, submit: params.submit === true, ...hwndField }
    } else {
      const key = String(params.key || '')
      if (!key) {
        return { tool: toolName, instruction: 'Tell me the key to press (key, e.g. {ENTER}).' }
      }
      payload = { path: node.path, rect: node.rect, name: node.name, app: resolved.snapshot.appName, action: 'press', key, ...hwndField }
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
        const freshScope = resolved.snapshot.scope === 'desktop' ? 'desktop' : 'active'
        const fresh = await uiaProvider.dumpTree(freshScope, snapshotHwnd)
        if (fresh && fresh.ok === true) {
          const reassigned = uiaNodes.assignRefs(fresh.nodes, { maxNodes: 120, maxDepth: 8 })
          const freshSnapshot = {
            nodes: reassigned.nodes,
            truncated: reassigned.truncated || fresh.truncated === true,
            totalSeen: reassigned.totalSeen,
            appName: String(fresh.appName || ''),
            windowTitle: String(fresh.windowTitle || ''),
            hwnd: normalizeHwnd(fresh.hwnd),
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
    /* Foreground guard: opaque and canvas targets report background_unavailable
       instead of silently stealing the cursor. Ask first, restore after. */
    if (requiresForegroundEscalation(result)) {
      const blocked = shouldBlockForeground(settings, params.allowForeground)
      if (blocked) {
        return {
          tool: toolName,
          instruction: `${buildForegroundConsentMessage(resolved.snapshot.appName, actionLabel)} Detail: ${detail}. To proceed, call ${toolName} again with the same ref plus allowForeground:true after the user confirms.`,
        }
      }
    }
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

/* ── Background program resolution (same index as Windows Start) ──
   Why this exists: the file-system index misses Store (UWP) apps such as
   Calculator, so launches fell back to simulating the Start menu with real
   keystrokes. Merging Get-StartApps (the same source the taskbar search
   uses) lets common programs launch via shell:AppsFolder with no mouse
   and no keyboard takeover. */

const PROGRAM_ALIASES = {
  calculator: ['calculadora', 'calc'],
  notepad: ['bloco de notas', 'bloco-de-notas', 'blocodenotas'],
  explorer: ['explorador', 'explorador de arquivos'],
  settings: ['configuracoes', 'configuracoes do windows'],
  terminal: ['prompt', 'cmd'],
}

function resolveProgramAlias(raw) {
  const norm = normalizeAccents(raw).trim().replace(/\s+/g, ' ')
  if (!norm) return ''
  for (const [canonical, aliases] of Object.entries(PROGRAM_ALIASES)) {
    if (norm === canonical) return canonical
    if (aliases.includes(norm)) return canonical
  }
  return norm
}

function parseStartAppsOutput(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return []
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  const out = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = String(entry.Name ?? entry.name ?? '').trim()
    const appId = String(entry.AppID ?? entry.AppId ?? entry.appId ?? entry.Appid ?? '').trim()
    if (name && appId) out.push({ name, appId })
  }
  return out
}

function buildStartAppsLaunchCommand(appId) {
  const id = String(appId || '').trim()
  if (!id) return { ok: false, error: 'Empty AppID' }
  if (/[\r\n"']/.test(id)) return { ok: false, error: 'Invalid AppID' }
  /* Single quotes: the command is wrapped in double quotes for cmd.exe, so
     double quotes here would split -Command ("Command failed"). */
  return { ok: true, command: `Start-Process 'shell:AppsFolder\\${id}'` }
}

function findBestStartApp(candidates, query) {
  const list = Array.isArray(candidates) ? candidates : []
  if (list.length === 0) return null
  const rawQuery = String(query || '').trim()
  if (!rawQuery) return null
  const alias = resolveProgramAlias(extractSearchTerms(rawQuery) || rawQuery)
  const vocab = buildVocabulary(list.map((c) => ({ name: c.name })))
  let best = null
  let bestScore = 0
  for (const candidate of list) {
    const nameNorm = normalizeAccents(candidate.name)
    const direct = scoreNameMatch(nameNorm, normalizeAccents(rawQuery), vocab)
    const aliasScore = scoreNameMatch(nameNorm, alias, vocab)
    const score = Math.max(direct, aliasScore)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  if (!best || bestScore <= 0.3) return null
  return best
}

function isShellAppsFolderPath(value) {
  return /^shell:appsfolder\\/i.test(String(value || '').trim())
}

/* ── Foreground escalation guard ──
   Background UIA patterns (invoke/value/toggle) never move the real cursor.
   Mouse and SendKeys fallbacks do. This guard keeps the silent fallback from
   stealing input: callers ask first and restore focus afterwards. */

const FOREGROUND_METHODS = new Set([
  'mouse', 'mouse-rect', 'sendkeys', 'sendkeys-rect', 'winsearch', 'gotourl', 'foreground',
])

function requiresForegroundEscalation(result) {
  if (!result || typeof result !== 'object') return false
  const delivery = String(result.delivery || '').toLowerCase()
  if (delivery === 'foreground') return true
  if (delivery === 'background') return false
  const method = String(result.method || '').toLowerCase()
  if (FOREGROUND_METHODS.has(method)) return true
  const error = String(result.error || '')
  return /background_unavailable|opaque|canvas|needs foreground/i.test(error)
}

function shouldBlockForeground(settings, explicitConsent) {
  const consent = explicitConsent === true
  if (settings && settings.backgroundOnly === true) return !consent
  if (settings && settings.askBeforeForeground === true) return !consent
  if (settings && settings.askBeforeForeground === undefined) return !consent
  return false
}

function buildForegroundConsentMessage(appName, actionLabel) {
  const app = String(appName || 'this app').trim() || 'this app'
  const action = String(actionLabel || 'this action').trim() || 'this action'
  return `Preciso assumir o primeiro plano para ${action} em "${app}": esse alvo nao responde em segundo plano. Vou devolver o foco e o cursor logo depois. Confirme para continuar em primeiro plano ou cancele para manter tudo em segundo plano.`
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
      description: 'Runs a WHOLE desktop task in ONE call (preferred for open-then-click-then-type flows): pass steps like [{op:"launch",query:"Word"},{op:"click",name:"Documento em branco"},{op:"type",role:"Document",text:"Hello word"},{op:"close"}]. Ops: launch (program via Windows Search), click/type/press (by visible element "name" and optional "role", resolved on a fresh screen with retries: name+role then name only; "name" may be empty when "role" alone identifies it), close (window Close button, else Alt+F4), goto (focus address bar via Ctrl+L, type URL, Enter), wait (ms). The task binds to the acted window: later steps read and act on that window even when focus moved elsewhere — do not relaunch while it exists. Page limits apply (max action steps, max minutes). Use the primitives (desktop_snapshot/click/type) only to explore an unknown screen first. Opaque screens (canvas, games) are not clickable â€” use desktop_describe to answer what is on them.',
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
      description: 'Reads a window through the Windows accessibility tree and lists clickable elements as numbered refs. Always call this first before desktop_find/click/type/press, and again whenever the screen changes. Element analysis must use this tree, never pixel coordinates.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'active (foreground window, default) or desktop (whole desktop, heavier)' },
          apps: { type: 'array', description: 'Read this program even behind the foreground window, e.g. ["Calculadora"]. Opens it in the background when closed, so the screen comes back in this same call.', items: { type: 'string' } },
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
      description: 'Clicks an element from a desktop_snapshot by ref, preferring a background accessibility pattern that never moves the real cursor. Foreground takeover needs explicit user consent. Refs expire when the screen changes: take a new desktop_snapshot and retry with the new ref.',
      parameters: {
        type: 'object',
        required: ['ref'],
        properties: {
          ref: { type: 'number', description: 'Element ref from desktop_snapshot' },
          snapshotId: { type: 'string', description: 'Snapshot id (defaults to the latest)' },
          allowForeground: { type: 'boolean', description: 'Explicit user consent to take over the foreground when background is unavailable' },
        },
      },
    },
    {
      name: 'desktop_type',
      description: 'Types text into an element from a desktop_snapshot by ref, preferring a background value pattern.',
      parameters: {
        type: 'object',
        required: ['ref', 'text'],
        properties: {
          ref: { type: 'number', description: 'Element ref from desktop_snapshot' },
          text: { type: 'string', description: 'Text to type' },
          submit: { type: 'boolean', description: 'Press Enter after typing' },
          snapshotId: { type: 'string', description: 'Snapshot id (defaults to the latest)' },
          allowForeground: { type: 'boolean', description: 'Explicit user consent to take over the foreground when background is unavailable' },
        },
      },
    },
    {
      name: 'desktop_press',
      description: 'Presses a key while an element from a desktop_snapshot has focus. Keys use SendKeys syntax, e.g. {ENTER}, {TAB}, ^c. Foreground keys need explicit user consent.',
      parameters: {
        type: 'object',
        required: ['ref', 'key'],
        properties: {
          ref: { type: 'number', description: 'Element ref from desktop_snapshot' },
          key: { type: 'string', description: 'Key to press (SendKeys syntax)' },
          snapshotId: { type: 'string', description: 'Snapshot id (defaults to the latest)' },
          allowForeground: { type: 'boolean', description: 'Explicit user consent to take over the foreground' },
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
      description: 'Reads or updates MomAI Desktop guardrails (allowed apps, limits, replay, safe-stop, background mode). Call with no arguments to read.',
      parameters: {
        type: 'object',
        properties: {
          allowedApps: { type: 'array', description: 'Process names allowed for automation (empty allows all)', items: { type: 'string' } },
          recordVisuals: { type: 'boolean', description: 'Save one screenshot per step for the replay (default true)' },
          maxSteps: { type: 'number', description: 'Max action steps per desktop_act run (default 10)' },
          maxRunMinutes: { type: 'number', description: 'Max minutes per run before it stops itself, 0 disables (default 10)' },
          safeStop: { type: 'boolean', description: 'Stop the run when the foreground app changes unexpectedly (default true)' },
          backgroundOnly: { type: 'boolean', description: 'Never take over mouse or keyboard; only background patterns and direct launches (default false)' },
          askBeforeForeground: { type: 'boolean', description: 'Ask for explicit consent before any foreground takeover (default true)' },
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

    let scored = allItems
      .map((item) => ({ ...item, score: scoreItem(item, searchTerms) }))
      .filter((item) => item.score > 0.1)

    /* Merge the same source the taskbar search uses (Get-StartApps): Store
       apps such as Calculator never appear in the file-system index, so they
       are scored here with alias support (calculadora/calc) and launched via
       shell:AppsFolder with no keystroke simulation. */
    try {
      const startApps = await fetchStartApps()
      if (Array.isArray(startApps) && startApps.length > 0) {
        const alias = resolveProgramAlias(searchTerms)
        const vocab = getVocabulary()
        const normTerms = normalizeAccents(searchTerms)
        for (const app of startApps) {
          const nameNorm = normalizeAccents(app.name)
          const direct = scoreNameMatch(nameNorm, normTerms, vocab)
          const aliasScore = alias ? scoreNameMatch(nameNorm, alias, vocab) : 0
          const score = Math.max(direct, aliasScore)
          if (score > 0.3) {
            scored.push({
              name: app.name,
              path: `shell:AppsFolder\\${app.appId}`,
              type: 'Programa',
              category: inferCategory(app.name, ''),
              score: Math.min(score + 0.05, 1.0),
            })
          }
        }
      }
    } catch {
      /* Start list is best effort: file index alone still answers */
    }
    scored = scored
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
  isDesktopActActionOp,
  keyboardFallbackKey,
  closeButtonCandidates,
  normalizeGotoUrl,
  escapeSendKeysText,
  normalizeHwnd,
  shouldRebindWindow,
  doesLaunchMatchApp,
  buildLaunchOutcome,
  findLaunchWindow,
  resolveAppScope,
  formatActMissError,
  shouldRefocusWindow,
  buildActFailHint,
  actCallSignature,
  shouldBlockActRepeat,
  buildActTerminalInstruction,
  resolveProgramAlias,
  parseStartAppsOutput,
  buildStartAppsLaunchCommand,
  findBestStartApp,
  isShellAppsFolderPath,
  requiresForegroundEscalation,
  shouldBlockForeground,
  buildForegroundConsentMessage,
  framesBaseDir,
}
