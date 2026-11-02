// Mengya API Worker — Auth + business CRUD on D1 (R2 for audio).
// Same Worker also serves the PWA static assets via `env.ASSETS`.
// Auth model: single shared account (email + password), Bearer token sessions.
//
//   GET    /api/health
//   POST   /api/auth/signup   { email, password } -> { user, token, expires_at }
//   POST   /api/auth/login    { email, password } -> { user, token, expires_at }
//   GET    /api/auth/me                           -> { user }
//   POST   /api/auth/logout                       -> { ok: true }
//   GET    /api/bootstrap                         -> { members, children }
//   GET    /api/rows/:table?q=<json>              -> { rows }
//   POST   /api/rows/:table   { row } | { rows }  -> { row } | { count }
//   PATCH  /api/rows/:table/:id  { patch, match }  -> { row }
//   DELETE /api/rows/:table/:id                    -> { ok: true }
//   POST   /api/entries/:id/claim                  -> { entry | null }
//   POST   /api/entries/:id/release { token, patch } -> { committed }
//   PUT    /api/audio/<key>                        -> { path }
//   GET    /api/audio/<key>                        -> audio bytes (Range supported)

interface Env {
  DB: any
  AUDIO: any
  ASSETS: any
}

interface TableMeta {
  cols: string[]
  json: string[]
  bool: string[]
  // Text columns that must not be blank when a client sends them. Absent values are
  // left to the schema DEFAULT, so only explicit whitespace is rejected.
  nonBlank?: string[]
}

const SESSION_DAYS = 90
const PARSE_LEASE_SEC = 120
const MAX_PARSE_ATTEMPTS = 3
const COMMON_TAG_LIMIT = 30
const MAX_ROWS = 20000

const SEED_MEMBERS = [
  { name: '爸爸', emoji: '👨', color: '#4A90E2', sort_order: 0 },
  { name: '妈妈', emoji: '👩', color: '#E05A8A', sort_order: 1 }
]

// Column whitelist per table. Anything not listed here is rejected, so a
// malformed patch can never touch id/user_id or write an unknown column.
const TABLES: Record<string, TableMeta> = {
  members: {
    cols: ['id', 'user_id', 'name', 'emoji', 'color', 'sort_order', 'created_at'],
    json: [],
    bool: [],
    nonBlank: ['name']
  },
  children: {
    cols: ['id', 'user_id', 'name', 'birth_date', 'gender', 'avatar_color', 'created_at'],
    json: [],
    bool: [],
    nonBlank: ['name']
  },
  entries: {
    cols: [
      'id', 'user_id', 'child_id', 'recorder_id', 'body',
      'categories', 'tags', 'manual_categories', 'manual_tags', 'ai_categories', 'ai_tags',
      'occurred_at', 'created_at', 'updated_at', 'parsed',
      'parse_status', 'parse_attempts', 'parse_token', 'parse_lease_until', 'parse_error',
      'parsed_version', 'content_version', 'ai_advice', 'transcript',
      'audio_path', 'audio_duration_sec', 'deleted_at'
    ],
    json: ['categories', 'tags', 'manual_categories', 'manual_tags', 'ai_categories', 'ai_tags', 'parsed'],
    bool: []
  },
  milestones: {
    cols: [
      'id', 'user_id', 'child_id', 'title', 'description', 'age_min_months', 'age_max_months',
      'category', 'status', 'completed_at', 'note', 'sort_order', 'created_at'
    ],
    json: [],
    bool: []
  },
  list_items: {
    cols: [
      'id', 'user_id', 'child_id', 'list_type', 'title', 'normalized_title', 'origin',
      'meta', 'status', 'source_entry_id', 'created_at'
    ],
    json: ['meta'],
    bool: []
  },
  growth_records: {
    cols: [
      'id', 'user_id', 'child_id', 'measured_at', 'height_cm', 'weight_kg', 'head_cm',
      'source_entry_id', 'source_fact_key', 'manual_override', 'deleted_at', 'created_at'
    ],
    json: [],
    bool: ['manual_override']
  },
  health_events: {
    cols: [
      'id', 'user_id', 'child_id', 'event_type', 'title', 'data', 'occurred_at', 'note',
      'source_entry_id', 'source_fact_key', 'manual_override', 'deleted_at', 'created_at'
    ],
    json: ['data'],
    bool: ['manual_override']
  }
}

function tableMeta(table: string): TableMeta | null {
  return Object.prototype.hasOwnProperty.call(TABLES, table) ? TABLES[table] : null
}

function mutableCols(m: TableMeta): string[] {
  return m.cols.filter((c) => c !== 'id' && c !== 'user_id' && c !== 'created_at')
}

function json(data: unknown, status = 200, cors = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': cors,
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
    }
  })
}

function err(code: string, message: string, status = 400): Response {
  return json({ ok: false, code, error: message }, status)
}

function newId(): string {
  // @ts-ignore — Workers runtime provides crypto.randomUUID
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

function expiryIso(): string {
  return new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString()
}

function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase()
}

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  // @ts-ignore
  return btoa(s)
}

function b64decode(b64: string): Uint8Array {
  // @ts-ignore
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function newSalt(): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(16)))
}

async function hashPassword(password: string, saltB64: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits'
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64decode(saltB64), iterations: 100000 },
    key,
    256
  )
  return b64encode(new Uint8Array(bits))
}

async function getUserByToken(env: Env, token: string): Promise<{ id: string; email: string } | null> {
  if (!token) return null
  const row = await env.DB.prepare(
    'SELECT u.id as id, u.email as email, s.expires_at as expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  )
    .bind(token)
    .first()
  if (!row) return null
  if (String(row.expires_at) < nowIso()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run().catch(() => {})
    return null
  }
  return { id: String(row.id), email: String(row.email) }
}

async function getAuthUser(req: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('authorization') ?? ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  return await getUserByToken(env, m[1].trim())
}

/** Audio is fetched by <audio src>, which cannot set headers — accept ?t=<token>. */
async function getAuthUserQuery(req: Request, env: Env, url: URL) {
  const fromHeader = await getAuthUser(req, env)
  if (fromHeader) return fromHeader
  const t = url.searchParams.get('t')
  return t ? await getUserByToken(env, t.trim()) : null
}

async function createSession(env: Env, userId: string): Promise<{ token: string; expires_at: string }> {
  const token = newId().replace(/-/g, '') + newId().replace(/-/g, '').slice(0, 8)
  const expires_at = expiryIso()
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires_at)
    .run()
  return { token, expires_at }
}

/* ---------------- row (de)serialisation ---------------- */

function decodeRow(m: TableMeta, row: any): any {
  if (!row) return row
  const out: any = { ...row }
  for (const c of m.json) {
    const v = out[c]
    if (typeof v === 'string' && v.length > 0) {
      try {
        out[c] = JSON.parse(v)
      } catch {
        out[c] = null
      }
    } else if (v === undefined) {
      out[c] = null
    }
  }
  for (const c of m.bool) if (c in out) out[c] = !!out[c]
  return out
}

function encodeValue(c: string, m: TableMeta, v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (m.json.includes(c)) return typeof v === 'string' ? v : JSON.stringify(v)
  if (m.bool.includes(c)) return v ? 1 : 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  return JSON.stringify(v)
}

/* ---------------- query building ---------------- */

interface RowQuery {
  eq?: Record<string, unknown>
  in?: Record<string, string[]>
  isNull?: string[]
  notNull?: string[]
  gte?: Record<string, string>
  lt?: Record<string, string>
  contains?: Record<string, unknown[]>
  jsonNotNull?: string[]
  search?: { term?: string; cols?: string[] }
  keyset?: { col?: string; value?: string; idCol?: string; idValue?: string; desc?: boolean }
  order?: { col?: string; desc?: boolean }[]
  limit?: number
  /** Ask for the total number of rows matching the filters, ignoring limit. */
  count?: boolean
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function buildWhere(m: TableMeta, q: RowQuery, userId: string): { sql: string; binds: unknown[] } {
  const parts: string[] = ['t."user_id" = ?']
  const binds: unknown[] = [userId]
  const ok = (c: unknown): c is string => typeof c === 'string' && m.cols.includes(c)

  if (q && typeof q === 'object') {
    if (q.eq) {
      for (const [c, v] of Object.entries(q.eq)) {
        if (!ok(c)) continue
        if (v === null) parts.push(`t."${c}" IS NULL`)
        else {
          parts.push(`t."${c}" = ?`)
          binds.push(encodeValue(c, m, v))
        }
      }
    }
    for (const c of q.isNull ?? []) if (ok(c)) parts.push(`t."${c}" IS NULL`)
    for (const c of q.notNull ?? []) if (ok(c)) parts.push(`t."${c}" IS NOT NULL`)
    if (q.gte) {
      for (const [c, v] of Object.entries(q.gte)) {
        if (!ok(c)) continue
        parts.push(`t."${c}" >= ?`)
        binds.push(v)
      }
    }
    if (q.lt) {
      for (const [c, v] of Object.entries(q.lt)) {
        if (!ok(c)) continue
        parts.push(`t."${c}" < ?`)
        binds.push(v)
      }
    }
    if (q.in) {
      for (const [c, values] of Object.entries(q.in)) {
        if (!ok(c) || !Array.isArray(values) || values.length === 0) continue
        parts.push(`t."${c}" IN (${values.map(() => '?').join(',')})`)
        binds.push(...values)
      }
    }
    if (q.contains) {
      for (const [c, values] of Object.entries(q.contains)) {
        if (!ok(c) || !Array.isArray(values) || values.length === 0) continue
        parts.push(
          `EXISTS (SELECT 1 FROM json_each(t."${c}") je WHERE je.value IN (${values
            .map(() => '?')
            .join(',')}))`
        )
        binds.push(...values)
      }
    }
    for (const path of q.jsonNotNull ?? []) {
      if (typeof path !== 'string') continue
      const dot = path.lastIndexOf('.')
      if (dot <= 0) continue
      const col = path.slice(0, dot)
      const key = path.slice(dot + 1)
      if (!ok(col)) continue
      parts.push(`json_extract(t."${col}", ?) IS NOT NULL`)
      binds.push(`$.${key}`)
    }
    const term = q.search?.term
    if (typeof term === 'string' && term.trim()) {
      const like = `%${escapeLike(term.trim())}%`
      const searchCols = (q.search?.cols ?? ['body']).filter(ok)
      const ors: string[] = []
      for (const c of searchCols) {
        ors.push(`t."${c}" LIKE ? ESCAPE '\\'`)
        binds.push(like)
      }
      if (ok('tags')) {
        ors.push(`t."tags" LIKE ? ESCAPE '\\'`)
        binds.push(`%${escapeLike(JSON.stringify(term.trim())).slice(1, -1)}%`)
      }
      if (ors.length) parts.push(`(${ors.join(' OR ')})`)
    }
    const ks = q.keyset
    if (ks && ok(ks.col) && typeof ks.value === 'string') {
      const idCol = ok(ks.idCol) ? ks.idCol : 'id'
      const cmp = ks.desc === false ? '>' : '<'
      parts.push(`(t."${ks.col}" ${cmp} ? OR (t."${ks.col}" = ? AND t."${idCol}" ${cmp} ?))`)
      binds.push(ks.value, ks.value, typeof ks.idValue === 'string' ? ks.idValue : ks.value)
    }
  }
  return { sql: parts.join(' AND '), binds }
}

function buildOrder(m: TableMeta, q: RowQuery): string {
  const parts: string[] = []
  for (const o of q.order ?? []) {
    const col = o?.col
    if (typeof col !== 'string' || !m.cols.includes(col)) continue
    parts.push(`t."${col}" ${o.desc ? 'DESC' : 'ASC'}`)
  }
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : ''
}

/* ---------------- rows handlers ---------------- */

async function handleListRows(env: Env, table: string, url: URL, userId: string): Promise<Response> {
  const m = tableMeta(table)
  if (!m) return err('NOT_FOUND', `未知数据表：${table}`, 404)
  const raw = url.searchParams.get('q')
  let q: RowQuery = {}
  if (raw) {
    try {
      q = JSON.parse(raw) as RowQuery
    } catch {
      return err('BAD_REQUEST', '查询参数不是合法 JSON', 400)
    }
  }
  const { sql: whereSql, binds } = buildWhere(m, q, userId)
  const orderSql = buildOrder(m, q)
  const limit = Math.min(Math.max(Number(q.limit) || 500, 1), MAX_ROWS)
  const sql = `SELECT t.* FROM "${table}" t WHERE ${whereSql}${orderSql} LIMIT ?`
  const res = await env.DB.prepare(sql)
    .bind(...binds, limit)
    .all()
  const rows = (res?.results ?? []).map((r: any) => decodeRow(m, r))
  if (!q.count) return json({ ok: true, rows })
  const totalRes = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${table}" t WHERE ${whereSql}`)
    .bind(...binds)
    .first()
  return json({ ok: true, rows, total: Number((totalRes as any)?.n) || 0 })
}

class ValidationError extends Error {}

function normalizeText(m: TableMeta, c: string, v: unknown): unknown {
  if (!(m.nonBlank ?? []).includes(c) || typeof v !== 'string') return v
  const trimmed = v.trim()
  if (!trimmed) throw new ValidationError(`「${c}」不能为空`)
  return trimmed
}

function buildRecord(m: TableMeta, raw: any, userId: string): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newId(),
    user_id: userId
  }
  for (const c of mutableCols(m)) {
    if (raw[c] !== undefined) rec[c] = normalizeText(m, c, raw[c])
  }
  if (m.cols.includes('updated_at') && !rec.updated_at) rec.updated_at = nowIso()
  return rec
}

async function handleInsertRows(
  env: Env,
  table: string,
  body: any,
  userId: string
): Promise<Response> {
  const m = tableMeta(table)
  if (!m) return err('NOT_FOUND', `未知数据表：${table}`, 404)
  const list: any[] = Array.isArray(body?.rows)
    ? body.rows
    : Array.isArray(body)
      ? body
      : body?.row && typeof body.row === 'object'
        ? [body.row]
        : body && typeof body === 'object'
          ? [body]
          : []
  if (list.length === 0) return err('BAD_REQUEST', '没有可写入的数据', 400)

  let recs: Record<string, unknown>[]
  try {
    recs = list.filter((r) => r && typeof r === 'object').map((r) => buildRecord(m, r, userId))
  } catch (e) {
    if (e instanceof ValidationError) return err('BAD_REQUEST', e.message, 400)
    throw e
  }
  if (recs.length === 0) return err('BAD_REQUEST', '没有可写入的数据', 400)

  // Rows are grouped by the columns they actually provide, and absent columns are
  // left out of the INSERT rather than bound as NULL. Binding NULL would override
  // the schema DEFAULT and trip NOT NULL columns (entries.manual_categories,
  // entries.parse_status, …) on rows that only send a subset of fields.
  const groups = new Map<string, { cols: string[]; rows: Record<string, unknown>[] }>()
  for (const rec of recs) {
    const provided = mutableCols(m).filter((c) => rec[c] !== undefined)
    const sig = provided.join(',')
    let g = groups.get(sig)
    if (!g) {
      g = { cols: ['id', 'user_id', ...provided], rows: [] }
      groups.set(sig, g)
    }
    g.rows.push(rec)
  }

  for (const g of groups.values()) {
    const cols = g.cols
    const perChunk = Math.max(1, Math.floor(90 / cols.length))
    const updatable = cols.filter((c) => c !== 'id' && c !== 'user_id')
    const conflictSql = updatable.length
      ? ` ON CONFLICT(id) DO UPDATE SET ${updatable.map((c) => `"${c}" = excluded."${c}"`).join(', ')}`
      : ' ON CONFLICT(id) DO NOTHING'
    for (let i = 0; i < g.rows.length; i += perChunk) {
      const chunk = g.rows.slice(i, i + perChunk)
      const valuesSql = chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(', ')
      const sql =
        `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${valuesSql}` + conflictSql
      const binds: unknown[] = []
      for (const rec of chunk) for (const c of cols) binds.push(encodeValue(c, m, rec[c]))
      await env.DB.prepare(sql)
        .bind(...binds)
        .run()
    }
  }

  if (list.length === 1) {
    const row = await env.DB.prepare(`SELECT t.* FROM "${table}" t WHERE t."id" = ? AND t."user_id" = ?`)
      .bind(recs[0].id, userId)
      .first()
    return json({ ok: true, row: decodeRow(m, row) })
  }
  return json({ ok: true, count: recs.length, rows: recs.map((r) => ({ id: r.id })) })
}

async function handleUpdateRow(
  env: Env,
  table: string,
  id: string,
  body: any,
  userId: string
): Promise<Response> {
  const m = tableMeta(table)
  if (!m) return err('NOT_FOUND', `未知数据表：${table}`, 404)
  const source = body?.patch && typeof body.patch === 'object' ? body.patch : body
  if (!source || typeof source !== 'object') return err('BAD_REQUEST', '缺少 patch 内容', 400)

  const sets: string[] = []
  const binds: unknown[] = []
  try {
    for (const c of mutableCols(m)) {
      if (c === 'parse_token' || c === 'parse_lease_until') continue
      if (!Object.prototype.hasOwnProperty.call(source, c)) continue
      sets.push(`"${c}" = ?`)
      binds.push(encodeValue(c, m, normalizeText(m, c, source[c])))
    }
  } catch (e) {
    if (e instanceof ValidationError) return err('BAD_REQUEST', e.message, 400)
    throw e
  }
  if (m.cols.includes('updated_at') && !Object.prototype.hasOwnProperty.call(source, 'updated_at')) {
    sets.push(`"updated_at" = ?`)
    binds.push(nowIso())
  }
  // content_version is the optimistic-concurrency token: the client echoes it back in
  // `match`, so the server must bump it on every accepted write or stale writes never 409.
  if (m.cols.includes('content_version') && !Object.prototype.hasOwnProperty.call(source, 'content_version')) {
    sets.push(`"content_version" = "content_version" + 1`)
  }
  if (sets.length === 0) return err('BAD_REQUEST', '没有可更新的字段', 400)

  let where = `"id" = ? AND "user_id" = ?`
  const whereBinds: unknown[] = [id, userId]
  const match = body?.match
  if (match && typeof match === 'object') {
    for (const [c, v] of Object.entries(match)) {
      if (!m.cols.includes(c)) continue
      if (v === null) where += ` AND "${c}" IS NULL`
      else {
        where += ` AND "${c}" = ?`
        whereBinds.push(encodeValue(c, m, v))
      }
    }
  }

  const res = await env.DB.prepare(`UPDATE "${table}" SET ${sets.join(', ')} WHERE ${where}`)
    .bind(...binds, ...whereBinds)
    .run()
  if (!res?.meta?.changes) {
    const exists = await env.DB.prepare(`SELECT "id" FROM "${table}" WHERE "id" = ? AND "user_id" = ?`)
      .bind(id, userId)
      .first()
    if (exists) return err('CONFLICT', '内容已在其他设备被修改，请刷新后重试', 409)
    return err('NOT_FOUND', '记录不存在', 404)
  }
  const row = await env.DB.prepare(`SELECT t.* FROM "${table}" t WHERE t."id" = ? AND t."user_id" = ?`)
    .bind(id, userId)
    .first()
  return json({ ok: true, row: decodeRow(m, row) })
}

async function handleDeleteRow(env: Env, table: string, id: string, userId: string): Promise<Response> {
  const m = tableMeta(table)
  if (!m) return err('NOT_FOUND', `未知数据表：${table}`, 404)
  const res = await env.DB.prepare(`DELETE FROM "${table}" WHERE "id" = ? AND "user_id" = ?`)
    .bind(id, userId)
    .run()
  if (!res?.meta?.changes) return err('NOT_FOUND', '记录不存在', 404)
  return json({ ok: true })
}

/* ---------------- parse lease ---------------- */

async function handleClaimParse(env: Env, id: string, userId: string): Promise<Response> {
  const token = newId()
  const lease = new Date(Date.now() + PARSE_LEASE_SEC * 1000).toISOString()
  const res = await env.DB.prepare(
    `UPDATE entries SET parse_status = 'running', parse_token = ?, parse_lease_until = ?, parse_error = NULL
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL
       AND parse_status IN ('pending', 'failed', 'running')
       AND (parse_lease_until IS NULL OR parse_lease_until < ?)
       AND parse_attempts < ?`
  )
    .bind(token, lease, id, userId, nowIso(), MAX_PARSE_ATTEMPTS)
    .run()
  if (!res?.meta?.changes) return json({ ok: true, entry: null })
  await env.DB.prepare('UPDATE entries SET parse_attempts = parse_attempts + 1 WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  const row = await env.DB.prepare('SELECT t.* FROM entries t WHERE t.id = ? AND t.user_id = ?')
    .bind(id, userId)
    .first()
  return json({ ok: true, entry: decodeRow(TABLES.entries, row) })
}

async function handleReleaseParse(env: Env, id: string, body: any, userId: string): Promise<Response> {
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!token) return err('BAD_REQUEST', '缺少 parse token', 400)
  const patch = body?.patch && typeof body.patch === 'object' ? body.patch : {}
  const m = TABLES.entries
  const sets: string[] = ['"parse_token" = NULL', '"parse_lease_until" = NULL']
  const binds: unknown[] = []
  for (const c of mutableCols(m)) {
    if (c === 'parse_token' || c === 'parse_lease_until') continue
    if (!Object.prototype.hasOwnProperty.call(patch, c)) continue
    sets.push(`"${c}" = ?`)
    binds.push(encodeValue(c, m, patch[c]))
  }
  const res = await env.DB.prepare(
    `UPDATE entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ? AND parse_token = ? AND deleted_at IS NULL`
  )
    .bind(...binds, id, userId, token)
    .run()
  return json({ ok: true, committed: !!res?.meta?.changes })
}

/* ---------------- audio (R2) ---------------- */

function audioKeyFrom(url: URL): string {
  const raw = url.pathname.slice('/api/audio/'.length)
  let key = ''
  try {
    key = decodeURIComponent(raw)
  } catch {
    return ''
  }
  if (!key || key.startsWith('/') || key.includes('..')) return ''
  return key
}

async function handleAudioPut(req: Request, env: Env, key: string, user: { id: string }): Promise<Response> {
  if (!env.AUDIO) return err('AUDIO_UNAVAILABLE', '语音存储未开通（R2 未绑定）', 503)
  if (key.split('/')[0] !== user.id) return err('FORBIDDEN', '无权写入该文件', 403)
  const contentType = req.headers.get('content-type') ?? 'application/octet-stream'
  if (!req.body) return err('BAD_REQUEST', '缺少文件内容', 400)
  await env.AUDIO.put(key, req.body, { httpMetadata: { contentType } })
  return json({ ok: true, path: key })
}

async function handleAudioGet(req: Request, env: Env, key: string, user: { id: string }): Promise<Response> {
  if (!env.AUDIO) return err('AUDIO_UNAVAILABLE', '语音存储未开通（R2 未绑定）', 503)
  if (key.split('/')[0] !== user.id) return err('FORBIDDEN', '无权访问该文件', 403)
  const ranged = !!req.headers.get('range')
  const obj = ranged ? await env.AUDIO.get(key, { range: req.headers }) : await env.AUDIO.get(key)
  if (!obj) return err('NOT_FOUND', '文件不存在', 404)
  const headers = new Headers()
  headers.set('content-type', obj.httpMetadata?.contentType ?? 'application/octet-stream')
  headers.set('cache-control', 'private, max-age=3600')
  headers.set('accept-ranges', 'bytes')
  headers.set('access-control-allow-origin', '*')
  let status = 200
  const range: any = obj.range
  if (ranged && range && typeof range.offset === 'number') {
    const size = Number(obj.size ?? 0)
    const start = range.offset
    const length = typeof range.length === 'number' ? range.length : size - start
    const end = size > 0 ? Math.min(start + length - 1, size - 1) : start + length - 1
    headers.set('content-range', `bytes ${start}-${end}/${size}`)
    headers.set('content-length', String(end - start + 1))
    status = 206
  }
  return new Response(obj.body, { status, headers })
}

/* ---------------- auth handlers ---------------- */

async function handleSignup(req: Request, env: Env): Promise<Response> {
  let body: any = null
  try {
    body = await req.json()
  } catch {
    return err('BAD_REQUEST', '请求体不是合法 JSON', 400)
  }
  const email = normalizeEmail(body?.email)
  const password = String(body?.password ?? '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err('INVALID_EMAIL', '邮箱格式不正确', 400)
  }
  if (password.length < 6) {
    return err('WEAK_PASSWORD', '密码至少 6 位', 400)
  }
  const existed = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existed) {
    return err('EMAIL_EXISTS', '该邮箱已注册，请直接登录', 409)
  }
  const salt = newSalt()
  const password_hash = await hashPassword(password, salt)
  const id = newId()
  await env.DB.prepare('INSERT INTO users (id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .bind(id, email, password_hash, salt)
    .run()
  const session = await createSession(env, id)
  return json({ ok: true, user: { id, email }, ...session }, 200)
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  let body: any = null
  try {
    body = await req.json()
  } catch {
    return err('BAD_REQUEST', '请求体不是合法 JSON', 400)
  }
  const email = normalizeEmail(body?.email)
  const password = String(body?.password ?? '')
  if (!email || !password) {
    return err('BAD_REQUEST', '请输入邮箱和密码', 400)
  }
  const row = await env.DB.prepare('SELECT id, email, password_hash, password_salt FROM users WHERE email = ?')
    .bind(email)
    .first()
  if (!row) {
    return err('INVALID_CREDENTIALS', '邮箱或密码不正确', 401)
  }
  const hash = await hashPassword(password, String(row.password_salt))
  if (hash !== String(row.password_hash)) {
    return err('INVALID_CREDENTIALS', '邮箱或密码不正确', 401)
  }
  const session = await createSession(env, String(row.id))
  return json({ ok: true, user: { id: String(row.id), email: String(row.email) }, ...session }, 200)
}

async function handleBootstrap(env: Env, user: { id: string }): Promise<Response> {
  const readMembers = async () =>
    (
      await env.DB.prepare('SELECT * FROM members WHERE user_id = ? ORDER BY sort_order, created_at')
        .bind(user.id)
        .all()
    )?.results ?? []
  let members = await readMembers()
  if (members.length === 0) {
    for (const m of SEED_MEMBERS) {
      await env.DB.prepare(
        'INSERT INTO members (id, user_id, name, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(newId(), user.id, m.name, m.emoji, m.color, m.sort_order)
        .run()
    }
    members = await readMembers()
  }
  const children =
    (
      await env.DB.prepare('SELECT * FROM children WHERE user_id = ? ORDER BY created_at')
        .bind(user.id)
        .all()
    )?.results ?? []
  return json({ ok: true, members, children }, 200)
}

async function handleCommonTags(env: Env, user: { id: string }, url: URL): Promise<Response> {
  const raw = Number(url.searchParams.get('limit'))
  const limit = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : COMMON_TAG_LIMIT, 1), 100)
  const res = await env.DB.prepare(
    `SELECT je.value AS tag, COUNT(*) AS cnt
       FROM entries e, json_each(e."tags") je
      WHERE e."user_id" = ? AND e."deleted_at" IS NULL
        AND je.value IS NOT NULL
        AND TRIM(CAST(je.value AS TEXT)) <> ''
      GROUP BY je.value
      ORDER BY cnt DESC, tag ASC
      LIMIT ?`
  )
    .bind(user.id, limit)
    .all()
  const tags = (res?.results ?? []).map((r: any) => ({ tag: String(r.tag), count: Number(r.cnt) }))
  return json({ ok: true, tags }, 200)
}

/* ---------------- router ---------------- */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type, authorization',
          'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
        }
      })
    }
    try {
      const path = url.pathname

      if (path === '/api/health') {
        return json({ ok: true, time: nowIso() })
      }
      if (path === '/api/auth/signup' && req.method === 'POST') {
        return await handleSignup(req, env)
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        return await handleLogin(req, env)
      }
      if (path === '/api/auth/me' && req.method === 'GET') {
        const user = await getAuthUser(req, env)
        if (!user) return err('UNAUTHORIZED', '未登录或会话已过期，请重新登录', 401)
        return json({ ok: true, user }, 200)
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        const auth = req.headers.get('authorization') ?? ''
        const m = auth.match(/^Bearer\s+(.+)$/i)
        if (m) {
          await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(m[1].trim()).run().catch(() => {})
        }
        return json({ ok: true }, 200)
      }
      if (path === '/api/tags/common' && req.method === 'GET') {
        const user = await getAuthUser(req, env)
        if (!user) return err('UNAUTHORIZED', '未登录或会话已过期，请重新登录', 401)
        return await handleCommonTags(env, user, url)
      }
      if (path === '/api/bootstrap' && req.method === 'GET') {
        const user = await getAuthUser(req, env)
        if (!user) return err('UNAUTHORIZED', '未登录或会话已过期，请重新登录', 401)
        return await handleBootstrap(env, user)
      }

      // Audio (R2) — token may arrive as ?t= because <audio src> cannot set headers.
      if (path.startsWith('/api/audio/')) {
        const user = await getAuthUserQuery(req, env, url)
        if (!user) return err('UNAUTHORIZED', '未登录或会话已过期，请重新登录', 401)
        const key = audioKeyFrom(url)
        if (!key) return err('BAD_REQUEST', '文件路径不合法', 400)
        if (req.method === 'PUT' || req.method === 'POST') return await handleAudioPut(req, env, key, user)
        if (req.method === 'GET') return await handleAudioGet(req, env, key, user)
        return err('NOT_FOUND', '接口不存在', 404)
      }

      // Entries parse lease
      const entryMatch = path.match(/^\/api\/entries\/([^/]+)\/(claim|release)$/)
      if (entryMatch) {
        const user = await getAuthUser(req, env)
        if (!user) return err('UNAUTHORIZED', '未登录或会话已过期，请重新登录', 401)
        const id = decodeURIComponent(entryMatch[1])
        if (entryMatch[2] === 'claim' && req.method === 'POST') {
          return await handleClaimParse(env, id, user.id)
        }
        if (entryMatch[2] === 'release' && req.method === 'POST') {
          let body: any = null
          try {
            body = await req.json()
          } catch {
            return err('BAD_REQUEST', '请求体不是合法 JSON', 400)
          }
          return await handleReleaseParse(env, id, body, user.id)
        }
        return err('NOT_FOUND', '接口不存在', 404)
      }

      // Generic table CRUD
      const rowsMatch = path.match(/^\/api\/rows\/([A-Za-z_]+)(?:\/([^/]+))?$/)
      if (rowsMatch) {
        const user = await getAuthUser(req, env)
        if (!user) return err('UNAUTHORIZED', '未登录或会话已过期，请重新登录', 401)
        const table = rowsMatch[1]
        const rowId = rowsMatch[2] ? decodeURIComponent(rowsMatch[2]) : ''
        if (req.method === 'GET' && !rowId) return await handleListRows(env, table, url, user.id)
        if (req.method === 'POST' && !rowId) {
          let body: any = null
          try {
            body = await req.json()
          } catch {
            return err('BAD_REQUEST', '请求体不是合法 JSON', 400)
          }
          return await handleInsertRows(env, table, body, user.id)
        }
        if ((req.method === 'PATCH' || req.method === 'PUT') && rowId) {
          let body: any = null
          try {
            body = await req.json()
          } catch {
            return err('BAD_REQUEST', '请求体不是合法 JSON', 400)
          }
          return await handleUpdateRow(env, table, rowId, body, user.id)
        }
        if (req.method === 'DELETE' && rowId) return await handleDeleteRow(env, table, rowId, user.id)
        return err('NOT_FOUND', '接口不存在', 404)
      }

      if (path.startsWith('/api/')) {
        return err('NOT_FOUND', '接口不存在', 404)
      }
      // Non-API: serve PWA static assets. `[assets] not_found_handling` only covers
      // requests the asset layer resolves on its own, so deep links that reach the
      // Worker are rewritten to index.html here.
      if (env.ASSETS) {
        const res = await env.ASSETS.fetch(req)
        // Deep links must return the app shell instead of 404. Keeping the Accept
        // check would leave non-browser clients (and prerenderers) with a blank 404.
        // Real asset URLs keep their 404 so a wrong path stays visible.
        const looksLikeAsset = /\.[A-Za-z0-9]+$/.test(path)
        if (res.status === 404 && req.method === 'GET' && !looksLikeAsset) {
          return await env.ASSETS.fetch(new Request(new URL('/index.html', url).toString(), req))
        }
        return res
      }
      return new Response('Not found', { status: 404 })
    } catch (e) {
      return err('SERVER_ERROR', e instanceof Error ? e.message : '服务器内部错误', 500)
    }
  }
}
