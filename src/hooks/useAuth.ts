import { useEffect } from 'react'
import { apiMe, readStoredSession, writeStoredSession } from '../lib/api'
import { useAppStore, usePrefs } from '../lib/store'
import { defaultChildId, loadBootstrap } from '../lib/data'
import { clearBootstrapCache, readBootstrapCache, writeBootstrapCache } from '../lib/bootstrapCache'
import type { Child, Member } from '../lib/types'

export function useAuth() {
  const session = useAppStore((s) => s.session)
  const setSession = useAppStore((s) => s.setSession)
  const setAuthLoaded = useAppStore((s) => s.setAuthLoaded)
  const setMembers = useAppStore((s) => s.setMembers)
  const setChildren = useAppStore((s) => s.setChildren)
  const setBooted = useAppStore((s) => s.setBooted)

  // Hydrate cached shell immediately so reopen isn't a white screen.
  useEffect(() => {
    const cached = readBootstrapCache()
    if (cached) {
      setMembers(cached.members as Member[])
      setChildren(cached.children as Child[])
    }
  }, [setMembers, setChildren])

  // Restore local session, then validate token with Worker.
  // No Supabase involved in the login chain anymore.
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      // If /api/auth/me hangs on a bad network, don't block the splash forever.
      if (alive) setAuthLoaded(true)
    }, 2500)
    ;(async () => {
      const stored = readStoredSession()
      if (!stored) {
        if (alive) {
          setSession(null)
          setAuthLoaded(true)
        }
        return
      }
      // Show stored session immediately for warm start; verify in background.
      setSession(stored)
      try {
        const user = await apiMe()
        if (!alive) return
        const verified = { ...stored, user }
        writeStoredSession(verified)
        setSession(verified)
      } catch {
        if (!alive) return
        // Token invalid/expired or backend unreachable: keep warm cache for
        // offline shell, but require re-login for writes.
        writeStoredSession(null)
        setSession(null)
      } finally {
        if (alive) setAuthLoaded(true)
        clearTimeout(timer)
      }
    })()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [setSession, setAuthLoaded])

  useEffect(() => {
    if (!session?.user.id) {
      // Keep cached members/children for warm start of next login; only clear booted.
      setBooted(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { members, children } = await loadBootstrap(session.user.id)
        if (!alive) return
        setMembers(members)
        setChildren(children)
        writeBootstrapCache(members, children)
        // Remember last recorder; fall back to first member if stale.
        const prefs = usePrefs.getState()
        if (!prefs.currentRecorderId || !members.some((m) => m.id === prefs.currentRecorderId)) {
          if (members[0]) prefs.setCurrentRecorderId(members[0].id)
        }
        if (!prefs.currentChildId || !children.some((c) => c.id === prefs.currentChildId)) {
          prefs.setCurrentChildId(defaultChildId(children))
        }
        setBooted(true)
      } catch (e) {
        console.error('bootstrap failed', e)
        if (!alive) return
        // Offline: still boot if we have a warm cache.
        const cached = readBootstrapCache()
        if (cached) {
          setMembers(cached.members as Member[])
          setChildren(cached.children as Child[])
          setBooted(true)
        } else {
          setBooted(true)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [session?.user.id, setMembers, setChildren, setBooted])

  return { session }
}

// Explicit sign-out helper clears device cache (called from data.signOut).
export function clearDeviceCache() {
  clearBootstrapCache()
  useAppStore.getState().setMembers([])
  useAppStore.getState().setChildren([])
  useAppStore.getState().setBooted(false)
}
