#!/usr/bin/env node
/**
 * 萌芽 · PC 端印记（孩子未来要做的 300 件事）后台同步
 *
 * 权威来源是用户维护的 data/footprints.md（清单勾选 [x]/[ ] 直接写在文件里）。
 * 在 PC 上编辑该文件后运行本脚本，把印记同步到 Cloudflare Workers + D1，App 端通过 useMilestones()
 * 直接读取，不再内置写死种子印记。
 *
 * 用法：
 *   1. 在 .env 中配置 MENGYA_API_BASE（Worker 地址）与 MENGYA_EMAIL / MENGYA_PASSWORD（共享账号登录凭据）
 *   2. 编辑 data/footprints.md（勾选状态：- [ ] 未做 / - [x] 已做）
 *   3. npm run footprints:dry    先预览将新增/更新哪些印记（只读，不写库）
 *      npm run footprints:sync   执行同步
 *
 * 语义：按「账号 + 标题」幂等同步 —— 新增 md 中缺失的印记；只更新已有印记的
 *       标题描述、分类、排序。绝不动 status / completed_at（这两列属于 App 内的
 *       完成状态，由用户在使用中维护，md 的 [x] 只在首次插入时生效）；也绝不
 *       删除任何印记（包括 App 内手动添加的）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')
const STATUSES = ['todo', 'doing', 'done']

function loadEnv() {
  const out = {}
  try {
    const txt = readFileSync(path.join(root, '.env'), 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* .env 不存在时仅依赖 process.env */
  }
  return { ...out, ...process.env }
}

const env = loadEnv()
const base = String(env.MENGYA_API_BASE ?? env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
const email = env.MENGYA_EMAIL
const password = env.MENGYA_PASSWORD

for (const [k, v] of [
  ['MENGYA_API_BASE', base],
  ['MENGYA_EMAIL', email],
  ['MENGYA_PASSWORD', password]
]) {
  if (!v) {
    console.error(`缺少 ${k}，请在 .env 中配置（MENGYA_API_BASE 为 Worker 地址，MENGYA_* 为共享账号登录凭据）`)
    process.exit(1)
  }
}

// 登录共享账号（伪协同：两位家长共用同一账号，写入的 user_id 由 Worker 从 token 推导）
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
})
if (!login.ok) {
  console.error(`登录失败（${login.status}）：${(await login.text()).slice(0, 300)}`)
  process.exit(1)
}
const session = await login.json()
const token = session.token

async function api(pathname, init = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
  })
  if (!res.ok) {
    console.error(`请求失败（${res.status} ${pathname}）：${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }
  return res.json()
}

/* ---------------- 解析 data/footprints.md ---------------- */

function cleanTitle(s) {
  return s
    .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseFootprints(md) {
  const items = []
  const pathStack = [] // [{level, text}]
  let sort = 0
  for (const raw of md.split(/\r?\n/)) {
    const h = raw.match(/^(#{1,4})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const text = cleanTitle(h[2])
      if (!text) continue
      while (pathStack.length && pathStack[pathStack.length - 1].level >= level) pathStack.pop()
      pathStack.push({ level, text })
      continue
    }
    const m = raw.match(/^\s*-\s*\[( |x|X)\]\s+(.+)$/)
    if (!m) continue
    const title = cleanTitle(m[2])
    if (!title) continue
    const checked = m[1] !== ' '
    const subs = pathStack.filter((p) => p.level >= 2)
    const category = subs.length > 1 ? subs[subs.length - 1].text : (subs[0]?.text ?? '其他')
    const description = subs.map((p) => p.text).join(' · ')
    items.push({ title, description, category, checked, sort_order: sort++ })
  }
  return items
}

let md
try {
  md = readFileSync(path.join(root, 'data', 'footprints.md'), 'utf8')
} catch (e) {
  console.error(`读取 data/footprints.md 失败：${e?.message ?? e}`)
  process.exit(1)
}

const items = parseFootprints(md)
if (items.length === 0) {
  console.error('data/footprints.md 中没有解析到任何 - [ ] / - [x] 清单项')
  process.exit(1)
}
console.log(`从 data/footprints.md 解析出 ${items.length} 条印记`)

/* ---------------- 幂等同步到 Workers ---------------- */

let added = 0
let updated = 0
let skipped = 0

for (const it of items) {
  const query = { eq: { title: it.title }, limit: 1 }
  const { rows } = await api(`/api/rows/milestones?q=${encodeURIComponent(JSON.stringify(query))}`)

  if (rows.length === 0) {
    console.log(`  + ${it.title}（${it.category}）`)
    added++
    if (!DRY) {
      await api('/api/rows/milestones', {
        method: 'POST',
        body: JSON.stringify({
          row: {
            title: it.title,
            description: it.description,
            category: it.category,
            age_min_months: null,
            age_max_months: null,
            status: it.checked ? 'done' : 'todo',
            sort_order: it.sort_order
          }
        })
      })
    }
    continue
  }

  const cur = rows[0]
  if (
    cur.description === it.description &&
    (cur.category ?? null) === it.category &&
    (cur.sort_order ?? 0) === it.sort_order
  ) {
    skipped++
    continue
  }
  console.log(`  ~ ${it.title}`)
  updated++
  if (!DRY) {
    await api(`/api/rows/milestones/${encodeURIComponent(cur.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ patch: { description: it.description, category: it.category, sort_order: it.sort_order } })
    })
  }
}

console.log(
  DRY
    ? `[dry-run] 将新增 ${added} 条、更新 ${updated} 条、跳过 ${skipped} 条（未写库）`
    : `同步完成：新增 ${added} 条、更新 ${updated} 条、跳过 ${skipped} 条`
)
