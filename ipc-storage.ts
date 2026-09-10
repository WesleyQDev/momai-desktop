// IPC storage bridge for the MomAI Desktop persistent worker.
//
// Persistent workers are forked directly by the host, so key-value state must
// go through host-owned SQLite over IPC (isolated per dev mode) instead of
// JSON files in the shared extensions directory.

function codedError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function createIpcDesktopStorage({ send, onResponse, storageDir, timeoutMs = 30000 } = {}) {
  let seq = 0
  const pending = new Map()

  onResponse((msg) => {
    if (!msg || msg.type !== 'storage-response' || !msg.requestId) return
    const entry = pending.get(msg.requestId)
    if (!entry) return
    pending.delete(msg.requestId)
    clearTimeout(entry.timer)
    const result = msg.result || {}
    if (result.ok === false) {
      entry.reject(codedError(result.errorCode || 'storage_error', result.error || 'storage request failed'))
      return
    }
    entry.resolve(result.value)
  })

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const requestId = 'desktop-' + Date.now() + '.' + seq++
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('storage IPC timeout: ' + method))
      }, timeoutMs)
      if (timer.unref) timer.unref()
      pending.set(requestId, { resolve, reject, timer })
      try {
        send({ type: 'storage-request', requestId, method, args })
      } catch (err) {
        pending.delete(requestId)
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  function area(prefix, methods) {
    return Object.fromEntries(methods.map((name) => [name, (...args) => call(prefix + '.' + name, args)]))
  }

  const storageMethods = area('storage', ['get', 'set', 'getMany', 'setMany', 'delete', 'listKeys', 'migrate'])
  return {
    storage: {
      storageDir,
      get: storageMethods.get,
      set: async (key, value, opts) => {
        await call('storage.set', opts === undefined ? [key, value] : [key, value, opts])
      },
      getMany: storageMethods.getMany,
      setMany: storageMethods.setMany,
      delete: async (key, opts) => {
        await call('storage.delete', opts === undefined ? [key] : [key, opts])
      },
      listKeys: storageMethods.listKeys,
      migrate: storageMethods.migrate
    },
    collections: area('collections', ['insert', 'list', 'count', 'search', 'remove', 'clear', 'upsert', 'upsertMany']),
    sessionFiles: area('sessionFiles', ['write', 'read', 'list', 'remove'])
  }
}

module.exports = {
  createIpcDesktopStorage
}
