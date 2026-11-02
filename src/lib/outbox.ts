// Offline write queue.
// Mutations that fail with a network error are kept here and replayed once the network is
// back. localStorage is enough because payloads are JSON rows (audio never goes through the
// outbox — recordings live in IndexedDB).

import type { Entry } from './types'

export type OutboxMutation =
  | {
      id: string
      userId: string | null
      kind: 'save'
      table: string
      row: Record<string, unknown>
      createdAt: string
    }
  | {
      id: string
      userId: string | null
      kind: 'saveBatch'
      table: string
      rows: Record<string, unknown>[]
      createdAt: string
    }
  | {
      id: string
      userId: string | null
      kind: 'update'
      table: string
      rowId: string
      patch: Record<string, unknown>
      match?: Record<string, unknown>
      createdAt: string
    }
  | {
      id: string
      userId: string | null
      kind: 'delete'
      table: string
      rowId: string
      createdAt: string
    }

const KEY = 'mengya-outbox'
const listeners = new Set<() => void>()
let cache: OutboxMutation[] | null = null

function read(): OutboxMutation[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed) ? (parsed as OutboxMutation[]) : []
  } catch {
    cache = []
  }
  return cache
}

function write(list: OutboxMutation[]): void {
  cache = list
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    /* quota — keep the in-memory copy so replay still works this session */
  }
  for (const fn of Array.from(listeners)) {
    try {
      fn()
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function pendingMutations(): OutboxMutation[] {
  return read().slice()
}

export function pendingCount(): number {
  return read().length
}

export function enqueueMutation(m: OutboxMutation): void {
  write([...read(), m])
}

export function removeMutation(id: string): void {
  const current = read()
  const next = current.filter((m) => m.id !== id)
  if (next.length !== current.length) write(next)
}

export function clearOutbox(): void {
  write([])
}

export function subscribeOutbox(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Ids whose deletion is queued but not yet acknowledged by the server. Reads must hide these
 * immediately, otherwise a deleted entry keeps counting in stats until the queue drains.
 */
export function pendingDeletedIds(): string[] {
  const ids = new Set<string>()
  for (const m of read()) {
    if (m.table !== 'entries') continue
    if (m.kind === 'delete') ids.add(m.rowId)
    else if (m.kind === 'update' && m.patch.deleted_at) ids.add(m.rowId)
  }
  return Array.from(ids)
}

/**
 * Rows created while offline, shaped like server rows so the timeline can render them
 * immediately. Patches queued for an entry are applied on top; queued deletes remove it.
 */
export function pendingEntries(): Entry[] {
  const patched = new Map<string, Record<string, unknown>>()
  const removed = new Set<string>()
  const rows: Entry[] = []

  const push = (row: Record<string, unknown>) => {
    if (row.deleted_at) return
    // Rows queued before the server assigned timestamps still need a usable created_at.
    rows.push({
      created_at: (row.created_at as string) ?? (row.occurred_at as string) ?? new Date().toISOString(),
      ...row
    } as unknown as Entry)
  }

  for (const m of read()) {
    if (m.table !== 'entries') continue
    if (m.kind === 'save') push(m.row)
    else if (m.kind === 'saveBatch') m.rows.forEach(push)
    else if (m.kind === 'update') {
      if (m.patch.deleted_at) removed.add(m.rowId)
      else patched.set(m.rowId, m.patch)
    } else if (m.kind === 'delete') removed.add(m.rowId)
  }

  return rows
    .filter((e) => !removed.has(e.id))
    .map((e) => (patched.has(e.id) ? ({ ...e, ...patched.get(e.id) } as Entry) : e))
}
