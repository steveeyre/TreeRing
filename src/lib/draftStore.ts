import type { CategoryKey } from './types'

const DB_NAME = 'mengya-drafts'
const DB_VERSION = 1
const STORE = 'drafts'

export interface ComposerDraft {
  body: string
  categories: CategoryKey[]
  tags: string
  childId: string | null
  recorderId: string | null
  audio?: { blob: Blob; ext: string; durationSec: number }
  updatedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本机草稿'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('无法打开本机草稿库'))
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('草稿读写失败'))
        t.oncomplete = () => db.close()
        t.onerror = () => reject(t.error ?? new Error('草稿事务失败'))
      })
  )
}

export async function saveDraft(userId: string, draft: ComposerDraft): Promise<void> {
  await tx('readwrite', (s) => s.put(draft, userId))
}

export async function loadDraft(userId: string): Promise<ComposerDraft | null> {
  const value = await tx<ComposerDraft | undefined>('readonly', (s) => s.get(userId))
  return value ?? null
}

export async function clearDraft(userId: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(userId))
}

export function isDraftMeaningful(d: ComposerDraft | null): boolean {
  if (!d) return false
  return Boolean(d.body.trim() || d.audio || d.categories.length || d.tags.trim())
}
