const wpath = require('node:path')
const fsPromises = require('node:fs/promises')
const fsSync = require('node:fs')

/* ──────────────────────────────────────────────
   Persistent worker entry for MomAI Desktop.

   The host forks backgroundScript directly as a worker process, so this
   file implements the host protocol (ready, execute, heartbeat, shutdown)
   and delegates tool calls to the runtime module (runtime.ts).
   ────────────────────────────────────────────── */

const [skillId, skillPath] = process.argv.slice(2)

const dataDir =
  process.env.MOMAI_DATA_DIR ||
  process.env.MOMAI_NODE_CORE_DATA_DIR ||
  wpath.resolve(__dirname, '..', '..', 'data')

const storageBase = wpath.join(dataDir, 'extensions', skillId || 'momai-desktop')

const SAFE_KEY = /^[a-zA-Z0-9_-]+$/

const storage = {
  storageDir: storageBase,
  async get(key) {
    if (typeof key !== 'string' || !SAFE_KEY.test(key)) throw new Error('Invalid storage key')
    try {
      return JSON.parse(await fsPromises.readFile(wpath.join(storageBase, `${key}.json`), 'utf-8'))
    } catch {
      return null
    }
  },
  async set(key, value) {
    if (typeof key !== 'string' || !SAFE_KEY.test(key)) throw new Error('Invalid storage key')
    await fsPromises.mkdir(storageBase, { recursive: true })
    const serialized = JSON.stringify(value, null, 2)
    if (serialized.length > 1024 * 1024) {
      throw new Error('Storage quota exceeded: max 1MB per extension')
    }
    await fsPromises.writeFile(wpath.join(storageBase, `${key}.json`), serialized, 'utf-8')
  },
}

function send(msg) {
  try {
    if (typeof process.send === 'function') process.send(msg)
  } catch {
    /* host unreachable */
  }
}

const momai = {
  log: (message) => send({ type: 'log', message: String(message) }),
  sendEvent: (eventType, data) => send({ type: 'event', eventType, data }),
  storage,
  async loadAsset(relativePath) {
    const base = wpath.resolve(skillPath || __dirname)
    const full = wpath.resolve(base, String(relativePath || ''))
    if (!full.startsWith(base + wpath.sep) && full !== base) {
      throw new Error('loadAsset: path escapes extension directory')
    }
    const bytes = new Uint8Array(await fsPromises.readFile(full))
    return { bytes, text: new TextDecoder().decode(bytes) }
  },
  async saveFile(relativePath, content) {
    const base = wpath.resolve(skillPath || __dirname)
    const full = wpath.resolve(base, String(relativePath || ''))
    if (!full.startsWith(base + wpath.sep) && full !== base) {
      throw new Error('saveFile: path escapes extension directory')
    }
    let buffer
    if (typeof content === 'string') buffer = Buffer.from(content, 'utf-8')
    else if (content instanceof Uint8Array) buffer = Buffer.from(content)
    else throw new Error('saveFile: content must be a string or Uint8Array')
    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('saveFile: file exceeds 5MB limit')
    }
    await fsPromises.mkdir(wpath.dirname(full), { recursive: true })
    await fsPromises.writeFile(full, buffer)
    return { ok: true, path: relativePath }
  },
}

function loadRuntime() {
  const runtimePath = wpath.join(skillPath || __dirname, 'runtime.ts')
  if (!fsSync.existsSync(runtimePath)) {
    throw new Error(`runtime module not found: ${runtimePath}`)
  }
  // eslint-disable-next-line global-require
  return require(runtimePath)
}

let runtime = null
let isShuttingDown = false

function clearRuntimeCache() {
  try {
    const base = wpath.resolve(skillPath || __dirname) + wpath.sep
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(base) && key !== __filename) delete require.cache[key]
    }
  } catch {
    /* best effort */
  }
}

async function shutdown() {
  if (isShuttingDown) return
  isShuttingDown = true
  try {
    const fn = runtime
      && (runtime.destroy || runtime.cleanup || runtime.stop || runtime.onShutdown)
    if (typeof fn === 'function') {
      await Promise.race([
        Promise.resolve(fn()),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ])
    }
  } catch {
    /* best effort */
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown())
process.on('SIGINT', () => shutdown())

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'shutdown') {
    await shutdown()
    return
  }
  if (msg.type !== 'execute') return
  const { requestId, payload } = msg
  try {
    if (!runtime) runtime = loadRuntime()
    const result = await runtime.execute({ ...(payload || {}), momai })
    send({ type: 'response', requestId, result: result || { ok: true } })
  } catch (err) {
    send({
      type: 'response',
      requestId,
      result: {
        tool: (payload && payload.toolName) || 'desktop',
        instruction: `Desktop worker error: ${err && err.message ? err.message : String(err)}`,
      },
    })
  }
  if (msg.reset !== false) {
    try {
      clearRuntimeCache()
      runtime = loadRuntime()
    } catch (err) {
      send({ type: 'log', message: `Runtime reload failed: ${err.message}` })
    }
  }
})

try {
  runtime = loadRuntime()
  send({ type: 'log', message: `Host initialized (PID: ${process.pid})` })
  send({ type: 'ready' })
} catch (err) {
  send({ type: 'log', message: `Failed to load extension: ${err.message}` })
  send({ type: 'init_error', error: err.message })
  process.exit(1)
}

setInterval(() => {
  send({ type: 'heartbeat', timestamp: Date.now() })
}, 30000)
