/**
 * Live desktop-run state: polls the worker routes and refreshes on run
 * events, so the page timeline follows the chat execution in real time.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getRun,
  listRuns,
  stopRun,
  subscribeToRunEvents,
  type DesktopRunDetail,
  type DesktopRunSummary,
} from '../services/desktop-api'

const POLL_MS = 2000

export function useDesktopRuns() {
  const [runs, setRuns] = useState<DesktopRunSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setRuns(await listRuns(20))
    } catch {
      /* keep previous list */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS * 3)
    const off = subscribeToRunEvents(() => void refresh())
    return () => {
      clearInterval(timer)
      off()
    }
  }, [refresh])

  return { runs, loading, refresh }
}

export function useDesktopRun(runId: string | null) {
  const [run, setRun] = useState<DesktopRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [stopping, setStopping] = useState(false)
  const runIdRef = useRef(runId)
  runIdRef.current = runId

  const refresh = useCallback(async () => {
    const id = runIdRef.current
    if (!id) {
      setRun(null)
      setLoading(false)
      return
    }
    try {
      setRun(await getRun(id))
    } catch {
      /* keep previous detail */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void refresh()
    if (!runId) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    const off = subscribeToRunEvents((data) => {
      if (!data || !data.runId || data.runId === runIdRef.current) void refresh()
    })
    return () => {
      clearInterval(timer)
      off()
    }
  }, [runId, refresh])

  const stop = useCallback(async () => {
    const id = runIdRef.current
    if (!id) return false
    setStopping(true)
    try {
      const ok = await stopRun(id)
      await refresh()
      return ok
    } catch {
      return false
    } finally {
      setStopping(false)
    }
  }, [refresh])

  return { run, loading, stopping, refresh, stop }
}
