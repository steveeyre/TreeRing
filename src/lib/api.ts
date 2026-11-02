// Mengya API client — talks to Workers + D1 (same origin /api).
// Replaces the retired Supabase backend (auth, CRUD, audio).

import { enqueueMutation, pendingMutations, removeMutation } from './outbox'
import { refreshAll } from './refresh'

export interface ApiUser {
  id: string
  email: string
}

export interface ApiSession {
  user: ApiUser
  token: string
  expires_at: string
}

export interface ApiError extends Error {
  code?: string
  status?: number
}

const TOKEN_KEY = 'mengya-token'
const USER_KEY = 'mengya-user'

export function getApiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return raw.replace(/\/+$/, '')
}

export function isBackendConfigured(): boolean {
  // Same-origin /api works without any env; explicit base URL is optional (local dev).
  return true
}

function apiUrl(path: string): string {
  const base = getApiBase()
  return `${base}${path}`
}

export function readStoredSession(): ApiSession | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const userRaw = localStorage.getItem(USER_KEY)
    if (!token || !userRaw) return null
    const user = JSON.parse(userRaw) as ApiUser
    if (!user?.id || !user?.email) return null
    return { user, token, expires_at: '' }
  } catch {
    return null
  }
}

export function writeStoredSession(s: ApiSession | null): void {
  try {
    if (!s) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      return
    }
    localStorage.setItem(TOKEN_KEY, s.token)
    localStorage.setItem(USER_KEY, JSON.stringify(s.user))
  } catch {
    /* quota — ignore */
  }
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function toApiError(code: string, message: string, status: number): ApiError {
  const e = new Error(message) as ApiError
  e.code = code
  e.status = status
  return e
}

export function friendlyAuthMessage(e: unknown): string {
  if (e instanceof TypeError) {
    return '连不上服务器（failed to fetch）：请检查网络，或确认 Worker 已部署且域名可访问'
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/Load failed|NetworkError|fetch/i.test(msg)) {
    return '连不上服务器：请检查网络，或确认 Worker 已部署且域名可访问'
  }
  return msg
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
    })
  } catch (e) {
    throw toApiError('NETWORK', friendlyAuthMessage(e), 0)
  }
  let body: any = null
  try {
    body = await res.json()
  } catch {
    throw toApiError('BAD_RESPONSE', `服务器返回异常（HTTP ${res.status}）`, res.status)
  }
  if (!res.ok || body?.ok === false) {
    const code = String(body?.code ?? 'SERVER_ERROR')
    const message = String(body?.error ?? body?.message ?? `请求失败（HTTP ${res.status}）`)
    throw toApiError(code, mapServerMessage(code, message), res.status)
  }
  return body as T
}

function mapServerMessage(code: string, fallback: string): string {
  switch (code) {
    case 'EMAIL_EXISTS':
      return '该邮箱已注册，请直接登录'
    case 'INVALID_CREDENTIALS':
      return '邮箱或密码不正确'
    case 'INVALID_EMAIL':
      return '邮箱格式不正确'
    case 'WEAK_PASSWORD':
      return '密码至少 6 位'
    case 'UNAUTHORIZED':
      return '未登录或会话已过期，请重新登录'
    case 'NOT_FOUND':
      return '接口不存在，请确认 Worker 已更新到最新版'
    default:
      return fallback
  }
}

export function authHeaders(): Record<string, string> {
  const token = readToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function apiSignup(email: string, password: string): Promise<ApiSession> {
  const body = await request<{ user: ApiUser; token: string; expires_at: string }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  const session: ApiSession = { user: body.user, token: body.token, expires_at: body.expires_at }
  writeStoredSession(session)
  return session
}

export async function apiLogin(email: string, password: string): Promise<ApiSession> {
  const body = await request<{ user: ApiUser; token: string; expires_at: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  const session: ApiSession = { user: body.user, token: body.token, expires_at: body.expires_at }
  writeStoredSession(session)
  return session
}

export async function apiMe(): Promise<ApiUser> {
  const body = await request<{ user: ApiUser }>('/api/auth/me', { headers: authHeaders() })
  return body.user
}

export async function apiLogout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST', headers: authHeaders() })
  } catch {
    /* logout is best-effort */
  } finally {
    writeStoredSession(null)
  }
}

export async function apiHealth(): Promise<{ ok: boolean; time: string }> {
  return await request('/api/health')
}

export async function apiBootstrap(): Promise<{ members: any[]; children: any[] }> {
  const body = await request<{ members: any[]; children: any[] }>('/api/bootstrap', {
    headers: authHeaders()
  })
  return { members: body.members ?? [], children: body.children ?? [] }
}

export interface CommonTag {
  tag: string
  count: number
}

/** Tags ranked by how often they were used, for the timeline's quick-tag picker. */
export async function apiCommonTags(limit = 30): Promise<CommonTag[]> {
  const body = await request<{ tags: CommonTag[] }>(`/api/tags/common?limit=${limit}`, {
    headers: authHeaders()
  })
  return Array.isArray(body.tags) ? body.tags : []
}

/* ---------------- business CRUD (D1 via /api/rows) ---------------- */

export type RowTable =
  | 'members'
  | 'children'
  | 'entries'
  | 'milestones'
  | 'list_items'
  | 'growth_records'
  | 'health_events'

export interface RowQuery {
  eq?: Record<string, unknown>
  in?: Record<string, string[]>
  isNull?: string[]
  notNull?: string[]
  gte?: Record<string, string>
  lt?: Record<string, string>
  contains?: Record<string, unknown[]>
  jsonNotNull?: string[]
  search?: { term: string; cols?: string[] }
  keyset?: { col: string; value: string; idCol?: string; idValue?: string; desc?: boolean }
  order?: { col: string; desc?: boolean }[]
  limit?: number
  /** Ask the server for the matching row count, unaffected by limit. */
  count?: boolean
}

function rowsPath(table: RowTable, q?: RowQuery): string {
  const path = `/api/rows/${table}`
  if (!q) return path
  return `${path}?q=${encodeURIComponent(JSON.stringify(q))}`
}

export async function apiListRows<T>(table: RowTable, q?: RowQuery): Promise<T[]> {
  const body = await request<{ rows: T[] }>(rowsPath(table, q), { headers: authHeaders() })
  return body.rows ?? []
}

/** Same as apiListRows, plus the total number of matching rows across all pages. */
export async function apiListRowsWithTotal<T>(
  table: RowTable,
  q: RowQuery = {}
): Promise<{ rows: T[]; total: number }> {
  const body = await request<{ rows: T[]; total?: number }>(rowsPath(table, { ...q, count: true }), {
    headers: authHeaders()
  })
  const rows = body.rows ?? []
  return { rows, total: body.total ?? rows.length }
}

/** Insert-or-update by id (upsert). Returns the stored row. */
export async function apiSaveRow<T>(table: RowTable, row: Record<string, unknown>): Promise<T> {
  try {
    return await postRow<T>(table, row)
  } catch (e) {
    if (!isNetworkError(e)) throw e
    enqueueMutation({
      id: crypto.randomUUID(),
      userId: currentUserId(),
      kind: 'save',
      table,
      row,
      createdAt: new Date().toISOString()
    })
    scheduleFlush()
    return { created_at: new Date().toISOString(), ...row } as T
  }
}

/** Batch upsert (restore / sync). Returns the number of rows written. */
export async function apiSaveRows(
  table: RowTable,
  rows: Record<string, unknown>[]
): Promise<number> {
  if (rows.length === 0) return 0
  try {
    return await postRows(table, rows)
  } catch (e) {
    if (!isNetworkError(e)) throw e
    enqueueMutation({
      id: crypto.randomUUID(),
      userId: currentUserId(),
      kind: 'saveBatch',
      table,
      rows,
      createdAt: new Date().toISOString()
    })
    scheduleFlush()
    return rows.length
  }
}

export async function apiUpdateRow<T>(
  table: RowTable,
  id: string,
  patch: Record<string, unknown>,
  match?: Record<string, unknown>
): Promise<T | null> {
  try {
    return await patchRow<T>(table, id, patch, match)
  } catch (e) {
    if (!isNetworkError(e)) throw e
    enqueueMutation({
      id: crypto.randomUUID(),
      userId: currentUserId(),
      kind: 'update',
      table,
      rowId: id,
      patch,
      match,
      createdAt: new Date().toISOString()
    })
    scheduleFlush()
    return { id, ...patch } as T
  }
}

export async function apiDeleteRow(table: RowTable, id: string): Promise<void> {
  try {
    await deleteRow(table, id)
  } catch (e) {
    if (!isNetworkError(e)) throw e
    enqueueMutation({
      id: crypto.randomUUID(),
      userId: currentUserId(),
      kind: 'delete',
      table,
      rowId: id,
      createdAt: new Date().toISOString()
    })
    scheduleFlush()
  }
}

/* ---------------- offline outbox ---------------- */

function currentUserId(): string | null {
  return readStoredSession()?.user?.id ?? null
}

function isNetworkError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as ApiError).code === 'NETWORK'
}

/** Raw row calls. The outbox replays through these so a replay never re-queues itself. */
async function postRow<T>(table: RowTable, row: Record<string, unknown>): Promise<T> {
  const body = await request<{ row: T }>(`/api/rows/${table}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ row })
  })
  scheduleRefresh()
  return body.row
}

async function postRows(table: RowTable, rows: Record<string, unknown>[]): Promise<number> {
  const body = await request<{ count?: number }>(`/api/rows/${table}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ rows })
  })
  scheduleRefresh()
  return body.count ?? rows.length
}

async function patchRow<T>(
  table: RowTable,
  id: string,
  patch: Record<string, unknown>,
  match?: Record<string, unknown>
): Promise<T | null> {
  const body = await request<{ row: T }>(`/api/rows/${table}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ patch, match })
  })
  scheduleRefresh()
  return body.row ?? null
}

async function deleteRow(table: RowTable, id: string): Promise<void> {
  await request(`/api/rows/${table}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders()
  })
  scheduleRefresh()
}

let flushing = false

/** Replay queued writes in order. Stops at the first network failure so ordering is kept. */
export async function flushOutbox(): Promise<void> {
  if (flushing || !readToken()) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  flushing = true
  let changed = false
  try {
    for (const m of pendingMutations()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break
      const uid = currentUserId()
      if (m.userId && uid && m.userId !== uid) {
        removeMutation(m.id)
        changed = true
        continue
      }
      try {
        if (m.kind === 'save') await postRow(m.table as RowTable, m.row)
        else if (m.kind === 'saveBatch') await postRows(m.table as RowTable, m.rows)
        else if (m.kind === 'update') await patchRow(m.table as RowTable, m.rowId, m.patch, m.match)
        else await deleteRow(m.table as RowTable, m.rowId)
        removeMutation(m.id)
        changed = true
      } catch (e) {
        if (isNetworkError(e)) break
        // Permanent rejection (validation / version conflict): drop it so the queue can drain.
        console.warn('[outbox] dropped', m.kind, m.table, e)
        removeMutation(m.id)
        changed = true
      }
    }
  } finally {
    flushing = false
    if (changed) refreshAll()
  }
}

function scheduleFlush(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  setTimeout(() => void flushOutbox(), 0)
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

/** Coalesce post-write reloads so a burst of writes costs one refresh. */
function scheduleRefresh(): void {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    refreshAll()
  }, 300)
}

let outboxStarted = false

/** Starts online-listener + retry loop. Safe to call more than once. */
export function startOutbox(): void {
  if (outboxStarted) return
  outboxStarted = true
  window.addEventListener('online', () => void flushOutbox())
  window.setInterval(() => void flushOutbox(), 20000)
  void flushOutbox()
}

export async function apiClaimParse<T>(entryId: string): Promise<T | null> {
  const body = await request<{ entry: T | null }>(
    `/api/entries/${encodeURIComponent(entryId)}/claim`,
    { method: 'POST', headers: authHeaders() }
  )
  return body.entry ?? null
}

export async function apiReleaseParse(
  entryId: string,
  token: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const body = await request<{ committed: boolean }>(
    `/api/entries/${encodeURIComponent(entryId)}/release`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify({ token, patch }) }
  )
  return !!body.committed
}

/* ---------------- audio (R2) ---------------- */

function audioPath(key: string): string {
  return `/api/audio/${key.split('/').map(encodeURIComponent).join('/')}`
}

/** Playable URL for <audio>; the token rides in the query because src can't set headers. */
export function audioUrl(key: string): string {
  const token = readToken() ?? ''
  return `${apiUrl(audioPath(key))}?t=${encodeURIComponent(token)}`
}

export async function apiUploadAudio(key: string, blob: Blob, contentType: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(apiUrl(audioPath(key)), {
      method: 'PUT',
      headers: { 'content-type': contentType, ...authHeaders() },
      body: blob
    })
  } catch (e) {
    throw toApiError('NETWORK', friendlyAuthMessage(e), 0)
  }
  if (!res.ok) {
    let code = 'UPLOAD_FAILED'
    let message = `音频上传失败（HTTP ${res.status}）`
    try {
      const body = await res.json()
      code = String(body?.code ?? code)
      message = String(body?.error ?? message)
    } catch {
      /* keep defaults */
    }
    throw toApiError(code, message, res.status)
  }
  return key
}

export async function apiDownloadAudio(key: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(apiUrl(audioPath(key)), { headers: authHeaders() })
  } catch (e) {
    throw toApiError('NETWORK', friendlyAuthMessage(e), 0)
  }
  if (!res.ok) throw toApiError('DOWNLOAD_FAILED', `音频下载失败（HTTP ${res.status}）`, res.status)
  return await res.blob()
}
