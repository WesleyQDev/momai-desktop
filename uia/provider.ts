const { execFile } = require('node:child_process')
const nodePath = require('node:path')

const DUMP_TIMEOUT_MS = 20000
const INVOKE_TIMEOUT_MS = 15000

const SHOOT_MAX_WIDTH = 800
const SHOOT_JPEG_QUALITY = 55

const VISION_DESCRIBE_TIMEOUT_MS = 90000
const VISION_DESCRIBE_MAX_TOKENS = 512

function isSupported() {
  return process.platform === 'win32'
}

function scriptPath(name) {
  return nodePath.join(__dirname, 'scripts', name)
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim()
  if (!text) throw new Error('Empty automation output')
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // The scripts print a single compressed JSON line; tolerate extra lines.
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i])
    } catch {
      /* try previous line */
    }
  }
  throw new Error('Could not parse automation output')
}

function runScript(name, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error('NOT_SUPPORTED'))
      return
    }
    const fullArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath(name),
    ].concat(args || [])
    const child = execFile('powershell.exe', fullArgs, {
      timeout: timeoutMs || DUMP_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message || '').slice(0, 500)
        reject(new Error(`Automation script failed: ${detail}`))
        return
      }
      try {
        resolve(parseJsonOutput(stdout))
      } catch (parseErr) {
        reject(parseErr)
      }
    })
    child.on('error', (spawnErr) => {
      reject(new Error(`Could not start automation: ${spawnErr.message}`))
    })
  })
}

/**
 * Reads the accessibility tree. Scope: 'active' (foreground window) or
 * 'desktop' (whole desktop, heavier).
 */
function dumpTree(scope) {
  const safeScope = scope === 'desktop' ? 'desktop' : 'active'
  return runScript('dump-uia.ps1', [
    '-Scope', safeScope,
    '-MaxDepth', '7',
    '-MaxNodes', '400',
  ], DUMP_TIMEOUT_MS)
}

/**
 * Performs one action on a previously snapshotted element.
 * action: { path, action: 'invoke'|'click'|'setvalue'|'sendkeys'|'press',
 *           text?, submit?, key? }
 */
function invokeAction(action) {
  return runScript('invoke-uia.ps1', [
    '-PayloadJson', JSON.stringify(action || {}),
  ], INVOKE_TIMEOUT_MS)
}

const ACT_TIMEOUT_MS = 25000

/**
 * Merged find+act+tree in ONE process: locates by visible name/role,
 * acts on the live element immediately (no stale refs), and returns the
 * fresh tree for the next step. Replaces dump+invoke+dump ping-pong.
 * action: { findName?, findRole?, action, text?, submit?, key?,
 *           returnTree?, maxDepth?, maxNodes? }
 */
function actOnTree(action) {
  return runScript('invoke-uia.ps1', [
    '-PayloadJson', JSON.stringify({ returnTree: true, ...(action || {}) }),
  ], ACT_TIMEOUT_MS)
}

/**
 * Downscales a JPEG/PNG buffer to a small JPEG buffer (pure JS).
 */
function downscaleShot(jpeg, shot, maxWidth, quality) {
  const decoded = jpeg.decode(shot, { maxMemoryUsageInMB: 512 })
  const srcW = decoded.width
  const srcH = decoded.height
  const dstW = Math.min(maxWidth, srcW)
  const dstH = Math.max(1, Math.round((srcH * dstW) / srcW))
  const dst = Buffer.alloc(dstW * dstH * 4)
  const src = decoded.data
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor((y * srcH) / dstH))
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor((x * srcW) / dstW))
      const s = (srcY * srcW + srcX) * 4
      const d = (y * dstW + x) * 4
      dst[d] = src[s]
      dst[d + 1] = src[s + 1]
      dst[d + 2] = src[s + 2]
      dst[d + 3] = 255
    }
  }
  return jpeg.encode({ data: dst, width: dstW, height: dstH }, quality).data
}

/**
 * Captures one replay frame to outPath as a small JPEG.
 * Pure Node (screenshot capture + JPEG downscale), no shell involved.
 * opts: { screen?: display id (default primary) }.
 * Returns { ok, path } — never throws for capture failures.
 */
async function captureScreenshot(outPath, opts) {
  try {
    const dest = String(outPath || '')
    if (!dest) return { ok: false, error: 'Empty output path' }
    const screenshot = require('screenshot-desktop')
    const jpeg = require('jpeg-js')
    const fs = require('node:fs')
    const shotArgs: { format: string; screen?: unknown } = { format: 'jpg' }
    if (opts && opts.screen !== undefined && opts.screen !== null && opts.screen !== '') {
      shotArgs.screen = opts.screen
    }
    const shot = await screenshot(shotArgs)
    const small = downscaleShot(jpeg, shot, SHOOT_MAX_WIDTH, SHOOT_JPEG_QUALITY)
    await fs.promises.mkdir(require('node:path').dirname(dest), { recursive: true })
    await fs.promises.writeFile(dest, small)
    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Lists the connected displays: [{ id, name }]. Empty array on failure.
 */
async function listDisplays() {
  try {
    const screenshot = require('screenshot-desktop')
    const displays = await screenshot.listDisplays()
    return Array.isArray(displays) ? displays : []
  } catch {
    return []
  }
}

/**
 * Captures every display as a small JPEG dataUrl (for the show tool).
 * Returns [{ display, name, dataUrl }] — entries without image are skipped.
 */
async function captureAllScreens() {
  const out = []
  try {
    const screenshot = require('screenshot-desktop')
    const jpeg = require('jpeg-js')
    const displays = await listDisplays()
    const shots = displays.length > 0
      ? await Promise.all(displays.map(async (d) => {
        try {
          // The bundled types omit the documented `screen` option.
          const args: { format: string; screen?: unknown } = { format: 'jpg', screen: d.id }
          return await screenshot(args)
        } catch {
          return null
        }
      }))
      : [await screenshot({ format: 'jpg' })]
    for (let i = 0; i < shots.length; i++) {
      if (!shots[i]) continue
      try {
        const small = downscaleShot(jpeg, shots[i], SHOOT_MAX_WIDTH, SHOOT_JPEG_QUALITY)
        out.push({
          display: i,
          name: displays[i] && displays[i].name ? String(displays[i].name) : `Tela ${i + 1}`,
          dataUrl: `data:image/jpeg;base64,${small.toString('base64')}`,
        })
      } catch {
        /* skip broken frame */
      }
    }
  } catch {
    /* no screens */
  }
  return out
}

/**
 * Describes what's on screen for the model (detail questions, tricky
 * areas). Reuses the host route POST /extensions/llm/vision (same
 * contract the momai-vision extension uses: Bearer session token,
 * {image_base64, prompt, max_tokens}). Returns {ok, text} or
 * {ok:false, unavailable:true, error} when no vision model is on.
 */
async function describeScreen(question) {
  const apiUrl = String(process.env.MOMAI_API_URL || '').replace(/\/$/, '')
  const token = String(process.env.MOMAI_SESSION_TOKEN || '')
  if (!apiUrl) return { ok: false, unavailable: true, error: 'Host API URL unavailable' }
  const shots = await captureAllScreens()
  if (shots.length === 0) return { ok: false, error: 'Screenshot failed on every display.' }
  const shot = shots[0]
  const prompt = String(question || 'Descreva em detalhes o que aparece nesta screenshot do computador.').slice(0, 500)
  let res = null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VISION_DESCRIBE_TIMEOUT_MS)
    try {
      res = await fetch(`${apiUrl}/extensions/llm/vision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          image_base64: shot.dataUrl.split(',')[1],
          prompt,
          max_tokens: VISION_DESCRIBE_MAX_TOKENS,
          caller: 'momai-desktop',
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    return { ok: false, unavailable: true, error: `Vision request failed: ${err.message}` }
  }
  if (!res || !res.ok) {
    return { ok: false, unavailable: true, error: `Vision unavailable (HTTP ${res ? res.status : 'noresponse'})` }
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: 'Vision returned an unreadable response' }
  }
  if (data && data.visionAvailable === false) {
    return { ok: false, unavailable: true, error: String(data.error || 'vision_unavailable') }
  }
  let text = data && data.text !== undefined && data.text !== null ? data.text : ''
  if (typeof text !== 'string') {
    try {
      text = String((text && text.text) || '')
    } catch {
      text = ''
    }
  }
  if (!text.trim()) return { ok: false, error: 'Vision returned an empty description.' }
  return { ok: true, text: text.trim(), display: shot.name }
}

module.exports = {
  isSupported,
  dumpTree,
  invokeAction,
  actOnTree,
  captureScreenshot,
  listDisplays,
  captureAllScreens,
  describeScreen,
}
