/**
 * 录音只存在本机：IndexedDB 保存原始 Blob，服务端只保留 audio_path 作为定位键。
 * key 沿用 `${userId}/${entryId}/${uuid}.${ext}` 结构，换设备/清浏览器数据后该键找不到二进制，
 * 因此 UI 必须把「没找到」当作正常情况处理。
 */

const DB_NAME = 'mengya-audio'
const DB_VERSION = 1
const STORE = 'audio'

export interface StoredAudio {
  key: string
  blob: Blob
  mime: string
  durationSec: number | null
  createdAt: string
  size: number
}

export function audioKey(userId: string, entryId: string, ext: string): string {
  return `${userId}/${entryId}/${crypto.randomUUID()}.${ext}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本地录音存储'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('本地录音库打开失败'))
  })
}

function runTx(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        t.oncomplete = () => {
          db.close()
          resolve()
        }
        t.onerror = () => {
          db.close()
          reject(t.error ?? new Error('本地录音库读写失败'))
        }
        t.onabort = () => {
          db.close()
          reject(t.error ?? new Error('本地录音库事务已取消'))
        }
        try {
          fn(t.objectStore(STORE))
        } catch (e) {
          try {
            t.abort()
          } catch {
            /* 事务已结束 */
          }
          reject(e)
        }
      })
  )
}

function readRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('本地录音库请求失败'))
  })
}

function collect(store: IDBObjectStore, prefix?: string): StoredAudio[] {
  const out: StoredAudio[] = []
  store.openCursor().onsuccess = (e) => {
    const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
    if (!cursor) return
    const rec = cursor.value as StoredAudio
    if (!prefix || rec.key.startsWith(prefix)) out.push(rec)
    cursor.continue()
  }
  return out
}

export async function putAudio(
  key: string,
  blob: Blob,
  durationSec: number | null
): Promise<string> {
  const rec: StoredAudio = {
    key,
    blob,
    mime: blob.type || 'audio/webm',
    durationSec,
    createdAt: new Date().toISOString(),
    size: blob.size
  }
  await runTx('readwrite', (store) => {
    store.put(rec)
  })
  return key
}

export async function getAudio(key: string): Promise<StoredAudio | null> {
  const db = await openDb()
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const rec = await readRequest<StoredAudio | undefined>(store.get(key))
    return rec ?? null
  } finally {
    db.close()
  }
}

export async function hasAudio(key: string): Promise<boolean> {
  return (await getAudio(key)) !== null
}

/** 建一个可直接喂给 <audio> 的 object URL；调用方负责 revoke。 */
export async function audioObjectUrl(key: string): Promise<string | null> {
  const rec = await getAudio(key)
  if (!rec) return null
  return URL.createObjectURL(rec.blob)
}

export async function deleteAudio(key: string): Promise<void> {
  await runTx('readwrite', (store) => {
    store.delete(key)
  })
}

/** 删除某条目下的全部录音（key 前缀 `${userId}/${entryId}/`）。 */
export async function deleteAudioForEntry(userId: string, entryId: string): Promise<number> {
  const prefix = `${userId}/${entryId}/`
  let removed = 0
  await runTx('readwrite', (store) => {
    store.openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
      if (!cursor) return
      const key = String(cursor.key)
      if (key.startsWith(prefix)) {
        cursor.delete()
        removed++
      }
      cursor.continue()
    }
  })
  return removed
}

export async function listAudio(): Promise<StoredAudio[]> {
  let out: StoredAudio[] = []
  await runTx('readonly', (store) => {
    out = collect(store)
  })
  return out
}

export async function audioUsage(): Promise<{ count: number; bytes: number }> {
  const all = await listAudio()
  return { count: all.length, bytes: all.reduce((n, r) => n + r.size, 0) }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
