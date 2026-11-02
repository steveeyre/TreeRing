// One shared refresh ticker for every data hook.
// Workers + D1 has no realtime push channel, so the app polls; running a timer per hook
// meant the archive page fired ~10 independent requests every 20s. Subscribers now share
// a single interval and a single visibility check.

const TICK_MS = 30000

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function emit(): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  for (const fn of Array.from(listeners)) {
    try {
      fn()
    } catch {
      /* one failing subscriber must not stop the rest */
    }
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') emit()
}

function start(): void {
  if (timer) return
  timer = setInterval(emit, TICK_MS)
  window.addEventListener('focus', emit)
  document.addEventListener('visibilitychange', onVisibility)
}

function stop(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  window.removeEventListener('focus', emit)
  document.removeEventListener('visibilitychange', onVisibility)
}

/** Subscribe to the shared refresh tick. Returns an unsubscribe function. */
export function subscribeRefresh(fn: () => void): () => void {
  listeners.add(fn)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) stop()
  }
}

/** Manual refresh (after a sync, or when the user asks for it). */
export function refreshAll(): void {
  emit()
}

export const REFRESH_MS = TICK_MS
