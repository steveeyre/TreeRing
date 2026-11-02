import {
  apiBootstrap,
  apiClaimParse,
  apiDeleteRow,
  apiListRows,
  apiLogin,
  apiLogout,
  apiReleaseParse,
  apiSaveRow,
  apiSaveRows,
  apiSignup,
  apiUpdateRow,
  friendlyAuthMessage,
  type RowTable
} from './api'
import { requestAdviceText } from './advice'
import { audioKey, putAudio } from './audioStore'
import { getAI, useAppStore, usePrefs } from './store'
import { parseEntryText, childContextText } from './parser'
import { classifyLocally } from './classify'
import { ageInMonths } from './format'
import type { MilestoneImport } from './importer'
import type {
  CategoryKey,
  Child,
  Entry,
  GrowthRecord,
  HealthEvent,
  HealthEventType,
  ListItem,
  ListType,
  Member,
  Milestone,
  ParsedResult,
  Status
} from './types'

function userId(): string {
  const id = useAppStore.getState().session?.user.id
  if (!id) throw new Error('未登录')
  return id
}

/** Prefer the child the parent is currently viewing; never silently use children[0] when a selection exists. */
export function resolveChildId(): string | null {
  const selected = usePrefs.getState().currentChildId
  if (selected) return selected
  return defaultChildId(useAppStore.getState().children)
}

/**
 * Newest child (latest birth date) is the sensible fallback when nothing is selected:
 * the baby is the one parents record day to day, and a stale/empty selection otherwise
 * files entries under whichever child happens to be first.
 */
export function defaultChildId(children: Child[]): string | null {
  if (!children.length) return null
  return [...children].sort((a, b) => (b.birth_date ?? '').localeCompare(a.birth_date ?? ''))[0].id
}

function toDateOnly(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function normalizeTitle(title: string): string {
  return title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/* ---------------- auth (Cloudflare Workers + D1) ---------------- */

export async function signIn(email: string, password: string): Promise<void> {
  try {
    const s = await apiLogin(email, password)
    useAppStore.getState().setSession(s)
  } catch (e) {
    throw new Error(friendlyAuthMessage(e))
  }
}

export async function signUp(email: string, password: string): Promise<void> {
  try {
    const s = await apiSignup(email, password)
    useAppStore.getState().setSession(s)
  } catch (e) {
    throw new Error(friendlyAuthMessage(e))
  }
}

export async function signOut(): Promise<void> {
  await apiLogout()
  const st = useAppStore.getState()
  st.setSession(null)
  st.setMembers([])
  st.setChildren([])
  st.setBooted(false)
  try {
    const { clearBootstrapCache } = await import('./bootstrapCache')
    clearBootstrapCache()
  } catch {
    /* ignore */
  }
}

/* ---------------- bootstrap ---------------- */

export async function loadBootstrap(
  _uid: string
): Promise<{ members: Member[]; children: Child[] }> {
  // D1 后端按 Bearer token 识别用户；_uid 仅为兼容旧调用保留。
  // 成员种子（爸爸/妈妈）已在 Worker 端首次登录时写入。
  try {
    const { members, children } = await apiBootstrap()
    return { members: (members ?? []) as Member[], children: (children ?? []) as Child[] }
  } catch (e) {
    throw new Error(friendlyAuthMessage(e))
  }
}

/* ---------------- children & members ---------------- */

const AVATAR_COLORS = ['#3F6B51', '#A9762F', '#8E4A38', '#5C7A99', '#7A6A9B', '#8A8F5C']

export async function createChild(input: {
  name: string
  birth_date: string | null
  gender: string | null
}): Promise<Child> {
  const uid = userId()
  const row = await apiSaveRow<Child>('children', {
    ...input,
    user_id: uid,
    avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
  })
  await syncChildren()
  return row
}

export async function updateChild(id: string, patch: Partial<Child>): Promise<void> {
  await apiUpdateRow<Child>('children', id, patch)
  await syncChildren()
}

async function syncChildren(): Promise<void> {
  let list: Child[] = []
  try {
    list = await apiListRows<Child>('children', { order: [{ col: 'created_at' }] })
  } catch {
    return
  }
  useAppStore.getState().setChildren(list)
  const cur = usePrefs.getState().currentChildId
  if (cur && !list.some((c) => c.id === cur)) {
    usePrefs.getState().setCurrentChildId(list[0]?.id ?? null)
  }
}

export async function createMember(input: {
  name: string
  emoji: string
  color: string
}): Promise<void> {
  const uid = userId()
  await apiSaveRow<Member>('members', { ...input, user_id: uid })
  await syncMembers()
}

async function syncMembers(): Promise<void> {
  let list: Member[] = []
  try {
    list = await apiListRows<Member>('members', {
      order: [{ col: 'sort_order' }, { col: 'created_at' }]
    })
  } catch {
    return
  }
  useAppStore.getState().setMembers(list)
  const cur = usePrefs.getState().currentRecorderId
  if (cur && !list.some((m) => m.id === cur)) {
    usePrefs.getState().setCurrentRecorderId(list[0]?.id ?? null)
  }
}

/* ---------------- entries ---------------- */

export interface SaveEntryInput {
  body: string
  childId: string | null
  recorderId: string | null
  occurredAt?: string
  categories?: CategoryKey[]
  tags?: string[]
  audio?: { blob: Blob; ext: string; durationSec: number } | null
}

export async function saveEntry(input: SaveEntryInput): Promise<Entry> {
  const uid = userId()
  const id = crypto.randomUUID()
  // Never write an orphan entry: fall back to the selected child (or the first one).
  const childId = input.childId ?? resolveChildId()
  let audioPath: string | null = null
  if (input.audio) {
    const key = audioKey(uid, id, input.audio.ext)
    try {
      audioPath = await putAudio(key, input.audio.blob, input.audio.durationSec)
    } catch {
      throw new Error('录音没能存进本机（可能是存储空间不足），请清理后重试')
    }
  }
  const body = input.body
  const ai = getAI()
  const manualCats = input.categories ?? []
  const manualTags = input.tags ?? []
  // Classify on the spot so a fresh entry is filed even when no AI key is configured.
  const local = classifyLocally(body)
  const cats = mergeCats(manualCats, local.categories)
  const tags = Array.from(new Set([...manualTags, ...local.tags]))
  const payload = {
    id,
    user_id: uid,
    child_id: childId,
    recorder_id: input.recorderId,
    body,
    categories: cats,
    tags,
    manual_categories: manualCats,
    manual_tags: manualTags,
    ai_categories: local.categories,
    ai_tags: local.tags,
    content_version: 1,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    audio_path: audioPath,
    audio_duration_sec: input.audio?.durationSec ?? null,
    parse_status: ai.autoParse && ai.apiKey && body.trim() ? 'pending' : 'none'
  }
  const entry = await apiSaveRow<Entry>('entries', payload)
  // Remember who just recorded so the next Composer opens with the same person.
  if (input.recorderId) usePrefs.getState().setCurrentRecorderId(input.recorderId)
  if (childId) usePrefs.getState().setCurrentChildId(childId)
  if (entry.parse_status === 'pending') void runParse(entry.id)
  return entry
}

function mergeTags(manual: string[] | null | undefined, ai: string[] | null | undefined): string[] {
  return Array.from(new Set([...(manual ?? []), ...(ai ?? [])]))
}

function mergeCats(
  manual: CategoryKey[] | null | undefined,
  ai: CategoryKey[] | null | undefined
): CategoryKey[] {
  // One entry belongs to exactly one category; an explicit pick beats the classifier.
  const m = (manual ?? []).filter(Boolean)
  if (m.length) return [m[0]]
  const a = (ai ?? []).filter(Boolean)
  return a.length ? [a[0]] : ['other']
}

export async function updateEntry(id: string, patch: Partial<Entry>): Promise<void> {
  await apiUpdateRow<Entry>('entries', id, patch as Record<string, unknown>)
}

async function readEntry(id: string): Promise<Entry | null> {
  const rows = await apiListRows<Entry>('entries', { eq: { id }, limit: 1 })
  return rows[0] ?? null
}

/** Update entry body/meta with optimistic content_version check against silent overwrite. */
export async function updateEntryContent(
  id: string,
  patch: {
    body: string
    categories?: CategoryKey[]
    tags?: string[]
    child_id?: string | null
    recorder_id?: string | null
    occurred_at?: string
  },
  expectedContentVersion: number
): Promise<Entry> {
  const current = await readEntry(id)
  if (!current) throw new Error('条目不存在')
  const cur = current
  const curVersion = cur.content_version ?? 1
  if (curVersion !== expectedContentVersion) {
    throw new Error('内容已在其他设备被修改，请刷新后重试，避免覆盖')
  }
  const manualCats = patch.categories ?? []
  const manualTags = patch.tags ?? []
  const bodyChanged = cur.body !== patch.body
  const local = bodyChanged ? classifyLocally(patch.body) : null
  const aiCats = local ? local.categories : cur.ai_categories
  const aiTags = local ? local.tags : cur.ai_tags
  const mergedCats = mergeCats(manualCats, aiCats)
  const mergedTags = mergeTags(manualTags, aiTags)
  const canAI =
    bodyChanged && getAI().autoParse && !!getAI().apiKey && !!patch.body.trim()
  const nextVersion = bodyChanged ? curVersion + 1 : curVersion
  const entry = await apiUpdateRow<Entry>(
    'entries',
    id,
    {
      body: patch.body,
      categories: mergedCats,
      tags: mergedTags,
      manual_categories: manualCats,
      manual_tags: manualTags,
      child_id: patch.child_id ?? cur.child_id,
      recorder_id: patch.recorder_id ?? cur.recorder_id,
      occurred_at: patch.occurred_at ?? cur.occurred_at,
      content_version: nextVersion,
      // Body changed → previous parse/advice are stale; re-classify locally right away.
      ...(bodyChanged
        ? {
            ai_categories: aiCats,
            ai_tags: aiTags,
            parse_status: canAI ? 'pending' : 'none',
            parse_attempts: 0,
            parse_error: null
          }
        : {})
    },
    { content_version: expectedContentVersion }
  )
  if (!entry) throw new Error('内容已在其他设备被修改，请刷新后重试，避免覆盖')
  if (entry.parse_status === 'pending') void runParse(entry.id)
  return entry
}

export async function deleteEntry(id: string): Promise<void> {
  await apiUpdateRow<Entry>('entries', id, { deleted_at: new Date().toISOString() })
}

async function getChildContext(childId: string | null): Promise<string> {
  if (!childId) return childContextText(null, null)
  const rows = await apiListRows<{ name: string; birth_date: string | null }>('children', {
    eq: { id: childId },
    limit: 1
  })
  const child = rows[0]
  if (!child) return childContextText(null, null)
  return childContextText(child.name, ageInMonths(child.birth_date))
}

export async function requestAdvice(entryId: string): Promise<string> {
  const entry = await readEntry(entryId)
  if (!entry) throw new Error('条目不存在')
  const context = await getChildContext(entry.child_id)
  const text = await requestAdviceText(entry.body, context)
  await updateEntry(entryId, { ai_advice: text })
  return text
}

/* ---------------- parse lease ---------------- */

const MAX_PARSE_ATTEMPTS = 3

async function claimParseLease(entryId: string): Promise<{ entry: Entry; token: string } | null> {
  // The Worker takes the lease atomically (single UPDATE ... WHERE) and bumps attempts,
  // so two devices racing on the same entry can never both hold it.
  const claimed = await apiClaimParse<Entry>(entryId)
  if (!claimed) return null
  const token = (claimed as unknown as { parse_token?: string | null }).parse_token
  if (!token) return null
  return { entry: claimed, token }
}

async function releaseParseLease(
  entryId: string,
  token: string,
  patch: Partial<Entry>
): Promise<boolean> {
  return apiReleaseParse(entryId, token, patch as Record<string, unknown>)
}

/** Manual retry: reset attempt counter so parents can re-run after failures. */
export async function retryParse(entryId: string): Promise<void> {
  await updateEntry(entryId, {
    parse_status: 'pending',
    parse_attempts: 0,
    parse_error: null
  })
  await runParse(entryId)
}

export async function runParse(entryId: string): Promise<void> {
  try {
    const ai = getAI()
    if (!ai.apiKey) {
      // The local classifier already filed this entry; don't leave a pending badge behind.
      await updateEntry(entryId, { parse_status: 'none', parse_error: null }).catch(() => {})
      return
    }
    const claimed = await claimParseLease(entryId)
    if (!claimed) return
    const { entry, token } = claimed
    if (!entry.body.trim()) {
      await releaseParseLease(entryId, token, { parse_status: 'none' })
      return
    }
    const contentVersionAtClaim = entry.content_version ?? 1
    const context = await getChildContext(entry.child_id)
    const result = await parseEntryText(entry.body, context)

    // Re-read: body may have changed while AI was thinking.
    const fresh = await readEntry(entryId)
    if (!fresh) return
    if ((fresh.content_version ?? 1) !== contentVersionAtClaim) {
      await releaseParseLease(entryId, token, {
        parse_status: 'pending',
        parse_error: '正文已修改，将重新解析'
      })
      return
    }
    await applyParse(fresh, result, token, contentVersionAtClaim)
  } catch (e) {
    console.error('parse failed', e)
    const msg = e instanceof Error ? e.message : '解析失败'
    const fresh = await readEntry(entryId).catch(() => null)
    const attempts = fresh?.parse_attempts ?? 0
    const token = (fresh as unknown as { parse_token?: string | null } | null)?.parse_token
    if (token) {
      await releaseParseLease(entryId, token, {
        parse_status: attempts >= MAX_PARSE_ATTEMPTS ? 'failed' : 'pending',
        parse_error: msg
      }).catch(() => {})
    } else {
      await updateEntry(entryId, { parse_status: 'failed', parse_error: msg }).catch(() => {})
    }
  }
}

async function applyParse(
  entry: Entry,
  result: ParsedResult,
  token: string,
  contentVersion: number
): Promise<void> {
  const uid = entry.user_id
  const childId = entry.child_id
  const manualCats = entry.manual_categories ?? entry.categories ?? []
  const manualTags = entry.manual_tags ?? entry.tags ?? []
  const aiCats = result.categories
  const semantic: string[] = []
  if (result.facts.quotes?.length) semantic.push('语录')
  if (result.facts.newWords?.length) semantic.push('新词')
  const aiTags = Array.from(new Set([...result.tags, ...semantic]))
  const categories = mergeCats(manualCats, aiCats)
  const tags = mergeTags(manualTags, aiTags)
  const committed = await releaseParseLease(entry.id, token, {
    parsed: result.facts,
    categories,
    tags,
    ai_categories: aiCats,
    ai_tags: aiTags,
    parse_status: 'done',
    parsed_version: contentVersion,
    parse_error: null
  })
  if (!committed) return

  const f = result.facts
  const tasks: Promise<unknown>[] = []
  if (f.books?.length) {
    for (const b of f.books) {
      if (b.title) tasks.push(upsertListItem(uid, childId, 'book', b.title, { author: b.author }, entry.id, 'ai'))
    }
  }
  if (f.games?.length) {
    for (const g of f.games) {
      if (g.title) tasks.push(upsertListItem(uid, childId, 'game', g.title, { platform: g.platform }, entry.id, 'ai'))
    }
  }
  if (f.media?.length) {
    for (const m of f.media) {
      if (!m.title) continue
      const type: ListType = m.kind?.includes('纪录片')
        ? 'documentary'
        : m.kind?.includes('动画')
          ? 'animation'
          : 'movie'
      tasks.push(upsertListItem(uid, childId, type, m.title, { kind: m.kind }, entry.id, 'ai'))
    }
  }
  const growth = f.growth
  if (growth && (growth.heightCm != null || growth.weightKg != null)) {
    tasks.push(
      (async () => {
        await upsertDerivedGrowth({
          user_id: uid,
          child_id: childId,
          measured_at: toDateOnly(entry.occurred_at),
          height_cm: growth.heightCm ?? null,
          weight_kg: growth.weightKg ?? null,
          source_entry_id: entry.id,
          source_fact_key: 'growth'
        })
      })()
    )
  }
  const illness = f.illness
  const illnessName = illness?.name
  if (illnessName) {
    tasks.push(
      (async () => {
        await upsertDerivedHealth({
          user_id: uid,
          child_id: childId,
          event_type: 'illness',
          title: illnessName,
          data: {
            onset: illness?.onset,
            symptoms: illness?.symptoms,
            medication: illness?.medication,
            recovery: illness?.recovery
          },
          occurred_at: toDateOnly(entry.occurred_at),
          source_entry_id: entry.id,
          source_fact_key: 'illness'
        })
      })()
    )
  }
  if (f.teeth) {
    tasks.push(
      (async () => {
        await upsertDerivedHealth({
          user_id: uid,
          child_id: childId,
          event_type: 'tooth',
          title: '牙齿记录',
          data: { note: f.teeth },
          occurred_at: toDateOnly(entry.occurred_at),
          source_entry_id: entry.id,
          source_fact_key: 'tooth'
        })
      })()
    )
  }
  await Promise.allSettled(tasks)
}

/* ---------------- derived growth / health ---------------- */

interface DerivedGrowthInput {
  user_id: string
  child_id: string | null
  measured_at: string
  height_cm: number | null
  weight_kg: number | null
  source_entry_id: string
  source_fact_key: string
}

async function upsertDerivedGrowth(input: DerivedGrowthInput): Promise<void> {
  const existing = await apiListRows<GrowthRecord>('growth_records', {
    eq: { source_entry_id: input.source_entry_id, source_fact_key: input.source_fact_key },
    limit: 1
  })
  const found = existing[0]
  if (found) {
    // A parent edited this row by hand; AI must not clobber the correction.
    if ((found as unknown as { manual_override?: boolean }).manual_override) return
    await apiUpdateRow('growth_records', found.id, {
      child_id: input.child_id,
      measured_at: input.measured_at,
      height_cm: input.height_cm,
      weight_kg: input.weight_kg
    })
    return
  }
  await apiSaveRow('growth_records', {
    id: crypto.randomUUID(),
    user_id: input.user_id,
    child_id: input.child_id,
    measured_at: input.measured_at,
    height_cm: input.height_cm,
    weight_kg: input.weight_kg,
    source_entry_id: input.source_entry_id,
    source_fact_key: input.source_fact_key
  })
}

interface DerivedHealthInput {
  user_id: string
  child_id: string | null
  event_type: HealthEventType
  title: string
  data: Record<string, unknown>
  occurred_at: string
  source_entry_id: string
  source_fact_key: string
}

async function upsertDerivedHealth(input: DerivedHealthInput): Promise<void> {
  const existing = await apiListRows<HealthEvent>('health_events', {
    eq: { source_entry_id: input.source_entry_id, source_fact_key: input.source_fact_key },
    limit: 1
  })
  const found = existing[0]
  if (found) {
    if ((found as unknown as { manual_override?: boolean }).manual_override) return
    await apiUpdateRow('health_events', found.id, {
      child_id: input.child_id,
      event_type: input.event_type,
      title: input.title,
      data: input.data,
      occurred_at: input.occurred_at
    })
    return
  }
  await apiSaveRow('health_events', {
    id: crypto.randomUUID(),
    user_id: input.user_id,
    child_id: input.child_id,
    event_type: input.event_type,
    title: input.title,
    data: input.data,
    occurred_at: input.occurred_at,
    source_entry_id: input.source_entry_id,
    source_fact_key: input.source_fact_key
  })
}

/* ---------------- list items ---------------- */

async function upsertListItem(
  uid: string,
  childId: string | null,
  listType: ListType,
  title: string,
  meta: Record<string, unknown> | null,
  sourceEntryId: string | null,
  origin: 'ai' | 'manual'
): Promise<void> {
  const normalized = normalizeTitle(title)
  const existing = await apiListRows<ListItem>('list_items', {
    eq: { list_type: listType, normalized_title: normalized, child_id: childId },
    limit: 1
  })
  const found = existing[0]
  if (found) {
    // Already tracked by hand or by an earlier entry — only record where it came from.
    if (!found.source_entry_id && sourceEntryId) {
      await apiUpdateRow('list_items', found.id, { source_entry_id: sourceEntryId })
    }
    return
  }
  await apiSaveRow('list_items', {
    id: crypto.randomUUID(),
    user_id: uid,
    child_id: childId,
    list_type: listType,
    title,
    normalized_title: normalized,
    meta,
    origin,
    source_entry_id: sourceEntryId
  })
}

export async function addListItem(
  type: ListType,
  title: string,
  meta?: Record<string, unknown> | null
): Promise<void> {
  await upsertListItem(userId(), resolveChildId(), type, title, meta ?? null, null, 'manual')
}

export async function setListItemStatus(id: string, status: Status): Promise<void> {
  await apiUpdateRow('list_items', id, { status })
}

export async function deleteListItem(id: string): Promise<void> {
  await apiDeleteRow('list_items', id)
}

/* ---------------- milestones ---------------- */

export async function addMilestone(input: {
  title: string
  description?: string | null
  age_min_months?: number | null
  age_max_months?: number | null
  category?: string | null
}): Promise<void> {
  const uid = userId()
  await apiSaveRow('milestones', { ...input, user_id: uid, sort_order: Date.now() })
}

export async function updateMilestone(
  id: string,
  patch: Partial<Pick<Milestone, 'title' | 'description' | 'age_min_months' | 'age_max_months' | 'category' | 'note'>>
): Promise<void> {
  await apiUpdateRow('milestones', id, patch as Record<string, unknown>)
}

export async function setMilestoneStatus(id: string, status: Status): Promise<void> {
  await apiUpdateRow('milestones', id, {
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null
  })
}

export async function deleteMilestone(id: string): Promise<void> {
  await apiDeleteRow('milestones', id)
}

/** 批量导入印记，按标题去重（与库中已有条目及本次批次内互相去重）。返回实际写入条数。 */
export async function importMilestones(items: MilestoneImport[]): Promise<number> {
  const uid = userId()
  const existing = await apiListRows<Milestone>('milestones', { isNull: ['deleted_at'] })
  const seen = new Set(existing.map((r) => normalizeTitle(r.title)))
  const payload: Record<string, unknown>[] = []
  let sort = Date.now()
  for (const it of items) {
    const title = it.title.trim()
    const key = normalizeTitle(title)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const done = it.status === 'done'
    payload.push({
      user_id: uid,
      child_id: resolveChildId(),
      title,
      description: it.description?.trim() || null,
      age_min_months: it.age_min_months ?? null,
      age_max_months: it.age_max_months ?? null,
      category: it.category?.trim() || null,
      status: done ? 'done' : 'todo',
      completed_at: done ? new Date().toISOString() : null,
      sort_order: sort++
    })
  }
  let count = 0
  for (let i = 0; i < payload.length; i += 200) {
    count += await apiSaveRows('milestones', payload.slice(i, i + 200))
  }
  return count
}

/* ---------------- growth & health ---------------- */

export async function addGrowthRecord(input: {
  measured_at: string
  height_cm: number | null
  weight_kg: number | null
}): Promise<void> {
  await apiSaveRow('growth_records', {
    ...input,
    user_id: userId(),
    child_id: resolveChildId()
  })
}

export async function deleteGrowthRecord(id: string): Promise<void> {
  await apiUpdateRow('growth_records', id, { deleted_at: new Date().toISOString() })
}

export async function addHealthEvent(input: {
  event_type: HealthEventType
  title: string
  occurred_at: string | null
  note?: string | null
}): Promise<void> {
  await apiSaveRow('health_events', {
    ...input,
    user_id: userId(),
    child_id: resolveChildId()
  })
}

export async function deleteHealthEvent(id: string): Promise<void> {
  await apiUpdateRow('health_events', id, { deleted_at: new Date().toISOString() })
}

/* ---------------- recycle bin ---------------- */

export interface DeletedEntry {
  id: string
  body: string
  occurred_at: string
  deleted_at: string | null
  categories: CategoryKey[] | null
  child_id: string | null
}

export interface DeletedGrowth {
  id: string
  measured_at: string
  height_cm: number | null
  weight_kg: number | null
  deleted_at: string | null
}

export interface DeletedHealth {
  id: string
  event_type: HealthEventType
  title: string
  occurred_at: string
  deleted_at: string | null
}

export async function listDeletedEntries(): Promise<DeletedEntry[]> {
  return apiListRows<DeletedEntry>('entries', {
    notNull: ['deleted_at'],
    order: [{ col: 'deleted_at', desc: true }],
    limit: 100
  })
}

export async function listDeletedGrowth(): Promise<DeletedGrowth[]> {
  return apiListRows<DeletedGrowth>('growth_records', {
    notNull: ['deleted_at'],
    order: [{ col: 'deleted_at', desc: true }],
    limit: 100
  })
}

export async function listDeletedHealth(): Promise<DeletedHealth[]> {
  return apiListRows<DeletedHealth>('health_events', {
    notNull: ['deleted_at'],
    order: [{ col: 'deleted_at', desc: true }],
    limit: 100
  })
}

export async function restoreEntry(id: string): Promise<void> {
  await apiUpdateRow('entries', id, { deleted_at: null })
}

export async function restoreGrowthRecord(id: string): Promise<void> {
  await apiUpdateRow('growth_records', id, { deleted_at: null })
}

export async function restoreHealthEvent(id: string): Promise<void> {
  await apiUpdateRow('health_events', id, { deleted_at: null })
}

/* ---------------- export ---------------- */

const ALL_EXPORT_TABLES: readonly RowTable[] = [
  'members',
  'children',
  'entries',
  'milestones',
  'list_items',
  'growth_records',
  'health_events'
]

export async function exportAllData(): Promise<{
  json: string
  counts: Record<string, number>
  bytes: number
  exportedAt: string
}> {
  const payload: Record<string, unknown> = {
    app: 'mengya',
    schema_version: 2,
    exported_at: new Date().toISOString(),
    includes_deleted: true
  }
  const counts: Record<string, number> = {}
  for (const t of ALL_EXPORT_TABLES) {
    const rows = await apiListRows<Record<string, unknown>>(
      t,
      t === 'entries' ? { order: [{ col: 'occurred_at', desc: true }] } : undefined
    )
    payload[t] = rows
    counts[t] = rows.length
  }
  const json = JSON.stringify(payload, null, 2)
  const reparsed = JSON.parse(json) as Record<string, unknown>
  for (const t of ALL_EXPORT_TABLES) {
    if (!Array.isArray(reparsed[t])) throw new Error(`校验失败：${t} 缺失或不是数组`)
    if ((reparsed[t] as unknown[]).length !== counts[t]) {
      throw new Error(`校验失败：${t} 行数不一致`)
    }
  }
  return {
    json,
    counts,
    bytes: json.length,
    exportedAt: payload.exported_at as string
  }
}

export type { GrowthRecord, HealthEvent, ListItem }

/* ---------------- backup / restore ---------------- */

const ALL_TABLES: readonly RowTable[] = ALL_EXPORT_TABLES

export interface RestoreResult {
  ok: boolean
  counts: Record<string, number>
  details: { table: string; ok: boolean; count: number; error?: string }[]
  error?: string
}

export interface RestorePreviewTable {
  table: string
  total: number
  insert: number
  update: number
  skipped: number
}

export interface RestorePreview {
  ok: boolean
  schemaVersion?: number | null
  exportedAt?: string | null
  tables: RestorePreviewTable[]
  errors: string[]
}

function parseRestorePayload(json: string): { data: Record<string, unknown>; meta: Record<string, unknown> } {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const root = parsed as Record<string, unknown>
  const data = ((root?.data as Record<string, unknown>) ?? root) as Record<string, unknown>
  return { data, meta: root ?? {} }
}

/** Dry-run: count insert vs overwrite per table without writing. */
export async function previewRestore(json: string): Promise<RestorePreview> {
  let data: Record<string, unknown>
  let meta: Record<string, unknown>
  try {
    ;({ data, meta } = parseRestorePayload(json))
  } catch (e) {
    return { ok: false, tables: [], errors: [e instanceof Error ? e.message : '解析失败'] }
  }
  const tables: RestorePreviewTable[] = []
  const errors: string[] = []
  for (const t of ALL_TABLES) {
    const rows = data?.[t]
    if (!Array.isArray(rows) || rows.length === 0) {
      tables.push({ table: t, total: 0, insert: 0, update: 0, skipped: 0 })
      continue
    }
    const ids = rows
      .map((r) => (r as { id?: string }).id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) {
      tables.push({ table: t, total: rows.length, insert: rows.length, update: 0, skipped: 0 })
      continue
    }
    let existingSet: Set<string>
    try {
      const existing = await apiListRows<{ id: string }>(t, { in: { id: ids } })
      existingSet = new Set(existing.map((r) => r.id))
    } catch (e) {
      errors.push(`${t}: ${e instanceof Error ? e.message : '读取失败'}`)
      tables.push({ table: t, total: rows.length, insert: 0, update: 0, skipped: rows.length })
      continue
    }
    let update = 0
    let insert = 0
    for (const id of ids) {
      if (existingSet.has(id)) update++
      else insert++
    }
    const skipped = rows.length - ids.length
    tables.push({ table: t, total: rows.length, insert, update, skipped })
  }
  return {
    ok: errors.length === 0,
    schemaVersion: (meta.schema_version as number | undefined) ?? null,
    exportedAt: (meta.exported_at as string | undefined) ?? null,
    tables,
    errors
  }
}

export async function restoreData(json: string): Promise<RestoreResult> {
  const uid = userId()
  let data: Record<string, unknown>
  try {
    ;({ data } = parseRestorePayload(json))
  } catch (e) {
    return {
      ok: false,
      counts: {},
      details: [],
      error: e instanceof Error ? e.message : '文件不是有效的 JSON'
    }
  }
  const counts: Record<string, number> = {}
  const details: RestoreResult['details'] = []
  const errors: string[] = []
  for (const t of ALL_TABLES) {
    const rows = data?.[t]
    if (!Array.isArray(rows) || rows.length === 0) {
      counts[t] = 0
      details.push({ table: t, ok: true, count: 0 })
      continue
    }
    const clean = rows.map((r) => ({ ...(r as object), user_id: uid }))
    // Upsert in batches to surface partial failures clearly.
    const batchSize = 200
    let okCount = 0
    let tableErr: string | undefined
    for (let i = 0; i < clean.length; i += batchSize) {
      const chunk = clean.slice(i, i + batchSize)
      try {
        okCount += await apiSaveRows(t, chunk)
      } catch (e) {
        tableErr = e instanceof Error ? e.message : '写入失败'
        break
      }
    }
    counts[t] = okCount
    details.push({ table: t, ok: !tableErr, count: okCount, error: tableErr })
    if (tableErr) errors.push(`${t}: ${tableErr}（成功 ${okCount}/${clean.length}）`)
  }
  return {
    ok: errors.length === 0,
    counts,
    details,
    error: errors.join('；') || undefined
  }
}
