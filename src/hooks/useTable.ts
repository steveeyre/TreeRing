import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiListRows, apiListRowsWithTotal, type RowQuery, type RowTable } from '../lib/api'
import { subscribeRefresh } from '../lib/refresh'
import { pendingDeletedIds, pendingEntries, subscribeOutbox } from '../lib/outbox'
import { useAppStore } from '../lib/store'
import type {
  CategoryKey,
  Entry,
  GrowthRecord,
  HealthEvent,
  ListItem,
  ListType,
  Milestone
} from '../lib/types'

export interface EntryFilters {
  childId: string | null
  recorderId: string | null
  category: CategoryKey | null
  search: string
  /** Exact tag match picked from the common-tag list */
  tag?: string | null
}

function matchesFilters(e: Entry, f: EntryFilters): boolean {
  if (f.childId && e.child_id !== f.childId) return false
  if (f.recorderId && e.recorder_id !== f.recorderId) return false
  if (f.category && !(e.categories ?? []).includes(f.category)) return false
  if (f.tag && !(e.tags ?? []).includes(f.tag)) return false
  const term = f.search.trim()
  if (term) {
    const haystack = `${e.body ?? ''} ${(e.tags ?? []).join(' ')}`
    if (!haystack.includes(term)) return false
  }
  return true
}

/** Offline records that match the filters and are not in the loaded page yet. */
function pendingExtras(rows: Entry[], pending: Entry[], f: EntryFilters): Entry[] {
  if (!pending.length) return []
  const seen = new Set(rows.map((r) => r.id))
  return pending.filter((e) => !seen.has(e.id) && matchesFilters(e, f))
}

/** Show queued offline records immediately instead of making them vanish until sync. */
function withPending(rows: Entry[], pending: Entry[], f: EntryFilters): Entry[] {
  const extras = pendingExtras(rows, pending, f)
  if (!extras.length) return rows
  return [...extras, ...rows].sort((a, b) => {
    if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

export const ENTRY_PAGE_SIZE = 50

export function useEntries(filters: EntryFilters, options: { poll?: boolean } = {}) {
  const poll = options.poll !== false
  const userId = useAppStore((s) => s.session?.user.id)
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [pending, setPending] = useState<Entry[]>(() => pendingEntries())
  const [queuedDeletes, setQueuedDeletes] = useState<string[]>(() => pendingDeletedIds())
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const f = useMemo(
    () => filters,
    [filters.childId, filters.recorderId, filters.category, filters.search, filters.tag]
  )

  useEffect(
    () =>
      subscribeOutbox(() => {
        setPending(pendingEntries())
        setQueuedDeletes(pendingDeletedIds())
      }),
    []
  )

  const buildQuery = useCallback((): RowQuery | null => {
    if (!userId) return null
    const q: RowQuery = { isNull: ['deleted_at'] }
    const eq: Record<string, unknown> = {}
    if (f.childId) eq.child_id = f.childId
    if (f.recorderId) eq.recorder_id = f.recorderId
    if (Object.keys(eq).length) q.eq = eq
    if (f.category) q.contains = { categories: [f.category] }
    if (f.tag) q.contains = { ...(q.contains ?? {}), tags: [f.tag] }
    if (f.search.trim()) q.search = { term: f.search.trim() }
    return q
  }, [userId, f])

  const loadRef = useRef<(silent: boolean) => void>(() => {})

  useEffect(() => {
    if (!userId) {
      setEntries([])
      setTotal(0)
      setLoading(false)
      setError(null)
      setHasMore(false)
      return
    }
    let alive = true
    setLoading(true)
    const doLoad = async (silent = false) => {
      const q = buildQuery()
      if (!q) return
      if (!silent) setLoading(true)
      try {
        const { rows, total: serverTotal } = await apiListRowsWithTotal<Entry>('entries', {
          ...q,
          order: [
            { col: 'occurred_at', desc: true },
            { col: 'id', desc: true }
          ],
          limit: ENTRY_PAGE_SIZE
        })
        if (!alive) return
        setEntries(rows)
        setTotal(serverTotal)
        setHasMore(rows.length === ENTRY_PAGE_SIZE)
        setError(null)
      } catch (e) {
        if (!alive || silent) return
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (alive && !silent) setLoading(false)
      }
    }
    loadRef.current = doLoad
    void doLoad()
    return () => {
      alive = false
    }
  }, [userId, f, reloadKey, buildQuery])

  useEffect(() => {
    if (!poll) return
    return subscribeRefresh(() => loadRef.current(true))
  }, [poll])

  const loadMore = useCallback(async () => {
    if (!userId || loadingMore || !hasMore || entries.length === 0) return
    const last = entries[entries.length - 1]
    const q = buildQuery()
    if (!q) return
    setLoadingMore(true)
    try {
      const rows = await apiListRows<Entry>('entries', {
        ...q,
        keyset: {
          col: 'occurred_at',
          value: last.occurred_at,
          idCol: 'id',
          idValue: last.id,
          desc: true
        },
        order: [
          { col: 'occurred_at', desc: true },
          { col: 'id', desc: true }
        ],
        limit: ENTRY_PAGE_SIZE
      })
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        return [...prev, ...rows.filter((r) => !seen.has(r.id))]
      })
      setHasMore(rows.length === ENTRY_PAGE_SIZE)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载更多失败')
    } finally {
      setLoadingMore(false)
    }
  }, [userId, loadingMore, hasMore, entries, buildQuery])

  const visible = useMemo(() => {
    // Deletions still waiting for the network must disappear from lists and stats at once.
    const rows = queuedDeletes.length
      ? entries.filter((e) => !queuedDeletes.includes(e.id))
      : entries
    return withPending(rows, pending, f)
  }, [entries, pending, queuedDeletes, f])

  // Server total covers every page; adjust for records that only exist locally
  // (queued saves) or no longer exist remotely (queued deletes).
  const visibleTotal = useMemo(() => {
    const extras = pendingExtras(entries, pending, f).filter((e) => !queuedDeletes.includes(e.id))
    return Math.max(0, total - queuedDeletes.length + extras.length)
  }, [entries, pending, queuedDeletes, total, f])

  return { entries: visible, total: visibleTotal, loading, loadingMore, hasMore, error, reload, loadMore }
}

function useRows<T>(
  table: RowTable,
  build: () => RowQuery | null,
  deps: unknown[],
  options: { poll?: boolean } = {}
) {
  const poll = options.poll !== false
  const userId = useAppStore((s) => s.session?.user.id)
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const loadRef = useRef<(silent: boolean) => void>(() => {})

  useEffect(() => {
    if (!userId) {
      setRows([])
      setLoading(false)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    const doLoad = async (silent = false) => {
      const q = build()
      if (!q) return
      if (!silent) setLoading(true)
      try {
        const data = await apiListRows<T>(table, q)
        if (!alive) return
        setRows(data)
        setError(null)
      } catch (e) {
        if (!alive || silent) return
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (alive && !silent) setLoading(false)
      }
    }
    loadRef.current = doLoad
    void doLoad()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reloadKey, ...deps])

  useEffect(() => {
    if (!poll) return
    return subscribeRefresh(() => loadRef.current(true))
  }, [poll])

  return { rows, loading, error, reload }
}

export function useMilestones(poll = true) {
  return useRows<Milestone>(
    'milestones',
    () => ({ order: [{ col: 'sort_order' }] }),
    [],
    { poll }
  )
}

export function useListItems(listType: ListType, poll = true) {
  return useRows<ListItem>(
    'list_items',
    () => ({
      eq: { list_type: listType },
      order: [{ col: 'created_at', desc: true }]
    }),
    [listType],
    { poll }
  )
}

export function useGrowth(childId: string | null, poll = true) {
  return useRows<GrowthRecord>(
    'growth_records',
    () => ({
      isNull: ['deleted_at'],
      ...(childId ? { eq: { child_id: childId } } : {}),
      order: [{ col: 'measured_at' }]
    }),
    [childId],
    { poll }
  )
}

export function useHealth(childId: string | null, poll = true) {
  return useRows<HealthEvent>(
    'health_events',
    () => ({
      isNull: ['deleted_at'],
      ...(childId ? { eq: { child_id: childId } } : {}),
      order: [{ col: 'occurred_at', desc: true }]
    }),
    [childId],
    { poll }
  )
}
