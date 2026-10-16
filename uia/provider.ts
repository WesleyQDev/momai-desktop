const { execFile } = require('node:child_process')
const nodePath = require('node:path')
const nodeOs = require('node:os')

const DUMP_TIMEOUT_MS = 20000
const INVOKE_TIMEOUT_MS = 15000
const CAPTURE_TIMEOUT_MS = 25000
const FOREGROUND_DISPLAY_TIMEOUT_MS = 8000

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
 * 'desktop' (whole desktop, heavier). Pass a window handle to read that
 * window instead of the foreground one; 0/omitted keeps foreground.
 */
function dumpTree(scope, hwnd) {
  const safeScope = scope === 'desktop' ? 'desktop' : 'active'
  const args = [
    '-Scope', safeScope,
    '-MaxDepth', '7',
    '-MaxNodes', '400',
  ]
  const id = Math.trunc(Number(hwnd) || 0)
  if (Number.isFinite(id) && id !== 0) args.push('-Hwnd', String(id))
  return runScript('dump-uia.ps1', args, DUMP_TIMEOUT_MS)
}

/**
 * Lists top-level windows without touching focus: [{ hwnd, title, app }].
 * Used to bind a task to an already-open window behind the foreground one.
 */
function listWindows() {
  return runScript('list-windows.ps1', [], DUMP_TIMEOUT_MS)
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
 * Downscales a JPEG buffer to a small JPEG buffer (pure JS). Callers pass the
 * max width/quality policy; omitted values keep the replay default.
 */
function downscaleBuffer(buffer, maxWidth, quality) {
  const jpeg = require('jpeg-js')
  return downscaleShot(
    jpeg,
    buffer,
    maxWidth || SHOOT_MAX_WIDTH,
    quality || SHOOT_JPEG_QUALITY
  )
}

/**
 * Downscales any JPEG buffer under an explicit visual policy. Returns null
 * when the buffer cannot be decoded, so callers can fall back to the original.
 */
function downscaleJpegToLimit(buffer, maxWidth, quality) {
  try {
    return downscaleBuffer(buffer, maxWidth, quality)
  } catch {
    return null
  }
}

/**
 * Pure: maps the optional 0-based `screen` index to one entry of the display
 * list. Omitted index means the first display (`fallback: true`); an index
 * that is out of range returns null so the caller decides between refusing
 * the call and capturing the primary display.
 */
function resolveDisplayEntry(displays, screen) {
  const list = Array.isArray(displays) ? displays : []
  if (list.length === 0) return null
  if (screen === undefined || screen === null || screen === '') {
    return { index: 0, entry: list[0], fallback: true }
  }
  const idx = Math.trunc(Number(screen))
  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return null
  return { index: idx, entry: list[idx], fallback: false }
}

/** Lists the connected displays: [{ id, name }]. Empty array on failure. */
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
 * Pure: index of the display containing `point`, or -1 when none does.
 * Used to translate the foreground window center into a display index.
 */
function pickDisplayIndexByPoint(displays, point) {
  const list = Array.isArray(displays) ? displays : []
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return -1
  for (let i = 0; i < list.length; i++) {
    const entry = list[i]
    if (!entry) continue
    const left = Number(entry.left)
    const top = Number(entry.top)
    const right = Number(entry.right)
    const bottom = Number(entry.bottom)
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue
    if (!Number.isFinite(right) || !Number.isFinite(bottom)) continue
    if (point.x >= left && point.x < right && point.y >= top && point.y < bottom) return i
  }
  return -1
}

/**
 * Display index of the screen where the foreground window is, so a plain
 * "print da tela" on a multi-monitor setup captures the screen in use.
 * Returns -1 when it cannot be determined (single display, script failure,
 * minimized window): callers fall back to the default display.
 */
async function foregroundDisplayIndex(displays) {
  if (!Array.isArray(displays) || displays.length < 2) return -1
  let res: any = null
  try {
    res = await runScript('foreground-display.ps1', [], FOREGROUND_DISPLAY_TIMEOUT_MS)
  } catch {
    return -1
  }
  if (!res || res.ok !== true) return -1
  return pickDisplayIndexByPoint(displays, {
    x: Number(res.centerX),
    y: Number(res.centerY)
  })
}

/**
 * Captures one display as a downscaled JPEG buffer.
 * opts: { screen?: 0-based display index, preferForeground?, maxWidth?, quality? }.
 * With no explicit `screen` and `preferForeground`, the screen in use wins.
 * Returns { ok, buffer, display, name } or { ok: false, error }.
 */
async function captureDisplayBuffer(opts) {
  const settings = opts && typeof opts === 'object' ? opts : {}
  try {
    const displayList = await listDisplays()
    const explicit =
      settings.screen !== undefined && settings.screen !== null && settings.screen !== ''
    let resolved = resolveDisplayEntry(displayList, settings.screen)
    if (displayList.length > 0 && !resolved) {
      return {
        ok: false,
        error: `Display ${String(settings.screen)} not found (${displayList.length} display(s) available)`
      }
    }
    if (!explicit && settings.preferForeground === true && displayList.length > 1) {
      const preferred = await foregroundDisplayIndex(displayList)
      if (preferred >= 0) {
        resolved = { index: preferred, entry: displayList[preferred], fallback: true }
      }
    }
    const screenshot = require('screenshot-desktop')
    const shotArgs: { format: string; screen?: unknown } = { format: 'jpg' }
    if (resolved && resolved.entry && resolved.entry.id) shotArgs.screen = resolved.entry.id
    const shot = await screenshot(shotArgs)
    const buffer = downscaleBuffer(shot, settings.maxWidth, settings.quality)
    return {
      ok: true,
      buffer,
      display: resolved ? resolved.index : null,
      name: resolved && resolved.entry ? String(resolved.entry.name || '') : ''
    }
  } catch (err: any) {
    return { ok: false, error: `Could not capture the screen: ${err.message}` }
  }
}

/**
 * Captures one display to outPath as a small JPEG.
 * Returns { ok, path, display, name } — never throws for capture failures.
 */
async function captureDisplayToFile(outPath, opts) {
  const dest = String(outPath || '')
  if (!dest) return { ok: false, error: 'Empty output path' }
  const shot = await captureDisplayBuffer(opts)
  if (!shot.ok) return shot
  try {
    const fs = require('node:fs')
    await fs.promises.mkdir(nodePath.dirname(dest), { recursive: true })
    await fs.promises.writeFile(dest, shot.buffer)
    return { ok: true, path: dest, display: shot.display, name: shot.name }
  } catch (err: any) {
    return { ok: false, error: `Could not write the capture: ${err.message}` }
  }
}

/**
 * Captures one display as a JPEG data URL (no file is written).
 * opts: { screen?: 0-based display index, maxWidth?, quality? }.
 * Returns { ok, dataUrl, display, name }.
 */
async function captureDisplayDataUrl(screen, opts) {
  const settings = { ...(opts && typeof opts === 'object' ? opts : {}) }
  if (settings.screen === undefined && screen !== undefined) settings.screen = screen
  const shot = await captureDisplayBuffer(settings)
  if (!shot.ok) return shot
  return {
    ok: true,
    dataUrl: `data:image/jpeg;base64,${shot.buffer.toString('base64')}`,
    display: shot.display,
    name: shot.name
  }
}

/**
 * Captures ONE top-level window to outPath as a small JPEG through the
 * capture-window script (PrintWindow first, screen-region fallback).
 * opts: { maxWidth?, quality? }. Returns { ok, path, width, height, method }.
 */
async function captureWindowToFile(hwnd, outPath, opts) {
  const id = Math.trunc(Number(hwnd) || 0)
  if (id <= 0) return { ok: false, error: 'Invalid window handle' }
  const dest = String(outPath || '')
  if (!dest) return { ok: false, error: 'Empty output path' }
  const settings = opts && typeof opts === 'object' ? opts : {}
  let res: any = null
  try {
    res = await runScript(
      'capture-window.ps1',
      ['-Hwnd', String(id), '-OutPath', dest],
      CAPTURE_TIMEOUT_MS
    )
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
  if (!res || res.ok !== true) {
    return { ok: false, error: (res && res.error) || 'Window capture failed' }
  }
  const method = res.method
  try {
    const fs = require('node:fs')
    const raw = await fs.promises.readFile(dest)
    const small = downscaleBuffer(raw, settings.maxWidth, settings.quality)
    await fs.promises.writeFile(dest, small)
  } catch (err: any) {
    return { ok: false, error: `Could not encode the window capture: ${err.message}` }
  }
  return { ok: true, path: dest, width: res.width, height: res.height, method }
}

/**
 * Captures one top-level window as a JPEG data URL (via a temporary file,
 * since the capture script returns the image on disk).
 * Returns { ok, dataUrl, width, height }.
 */
async function captureWindowDataUrl(hwnd, opts) {
  const fs = require('node:fs')
  const tmp = nodePath.join(
    nodeOs.tmpdir(),
    `momai-desktop-window-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`
  )
  const shot = await captureWindowToFile(hwnd, tmp, opts)
  if (!shot.ok) return shot
  try {
    const bytes = await fs.promises.readFile(tmp)
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      width: shot.width,
      height: shot.height
    }
  } catch (err: any) {
    return { ok: false, error: `Could not read the window capture: ${err.message}` }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* best effort */
    }
  }
}

/**
 * Describes an already captured image for the model (detail questions,
 * tricky areas). Reuses the host route POST /extensions/llm/vision (same
 * contract the momai-vision extension uses: Bearer session token,
 * {image_base64, prompt, max_tokens}). Returns {ok, text} or
 * {ok:false, unavailable:true, error} when no vision model is on.
 */
async function describeImage(question, dataUrl) {
  const apiUrl = String(process.env.MOMAI_API_URL || '').replace(/\/$/, '')
  const token = String(process.env.MOMAI_SESSION_TOKEN || '')
  if (!apiUrl) return { ok: false, unavailable: true, error: 'Host API URL unavailable' }
  const imageBase64 = String(dataUrl || '').split(',')[1] || ''
  if (!imageBase64) return { ok: false, error: 'Empty image payload' }
  const prompt = String(question || 'Descreva em detalhes o que aparece nesta screenshot do computador.').slice(0, 500)
  let res: any = null
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
          image_base64: imageBase64,
          prompt,
          max_tokens: VISION_DESCRIBE_MAX_TOKENS,
          caller: 'momai-desktop',
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  } catch (err: any) {
    return { ok: false, unavailable: true, error: `Vision request failed: ${err.message}` }
  }
  if (!res || !res.ok) {
    return { ok: false, unavailable: true, error: `Vision unavailable (HTTP ${res ? res.status : 'noresponse'})` }
  }
  let data: any = null
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
  return { ok: true, text: text.trim() }
}

module.exports = {
  isSupported,
  dumpTree,
  listWindows,
  invokeAction,
  actOnTree,
  listDisplays,
  captureDisplayBuffer,
  captureDisplayToFile,
  captureDisplayDataUrl,
  captureWindowToFile,
  captureWindowDataUrl,
  describeImage,
  downscaleJpegToLimit,
}

module.exports.__internals = {
  resolveDisplayEntry,
  pickDisplayIndexByPoint,
}
