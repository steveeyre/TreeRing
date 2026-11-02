#!/usr/bin/env node
/**
 * 萌芽 · PC 端后台清单同步
 *
 * 在 PC 上直接编辑 data/lists.json（童书 / 影视 / 游戏 / 自定义），
 * 然后运行本脚本把改动同步到 Cloudflare Workers + D1。不经过 App，不需要 App 内编辑入口。
 *
 * 用法：
 *   1. 在 .env 中配置 MENGYA_API_BASE（Worker 地址）与 MENGYA_EMAIL / MENGYA_PASSWORD（共享账号登录凭据）
 *   2. 编辑 data/lists.json
 *   3. npm run lists:dry    先预览将新增/更新哪些条目（只读，不写库）
 *      npm run lists:sync   执行同步
 *
 * 语义：按「账号 + 清单类型 + 名称」幂等同步 —— 新增缺失项、更新已有项的
 *       meta 与状态；不会删除任何数据（包括 App 内手动添加或 AI 自动解析出的条目）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')
const LIST_TYPES = ['book', 'game', 'media', 'custom']
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

let data
try {
  data = JSON.parse(readFileSync(path.join(root, 'data', 'lists.json'), 'utf8'))
} catch (e) {
  console.error(`读取 data/lists.json 失败：${e?.message ?? e}`)
  process.exit(1)
}

let added = 0
let updated = 0
let skipped = 0

for (const type of LIST_TYPES) {
  const items = Array.isArray(data[type]) ? data[type] : []
  for (const it of items) {
    const title = String(it.title ?? '').trim()
    if (!title) {
      console.warn(`  [${type}] 跳过空标题条目`)
      continue
    }
    const meta = it.meta && typeof it.meta === 'object' ? it.meta : null
    const status = STATUSES.includes(it.status) ? it.status : 'todo'

    const query = { eq: { list_type: type, title }, limit: 1 }
    const { rows } = await api(`/api/rows/list_items?q=${encodeURIComponent(JSON.stringify(query))}`)

    if (rows.length === 0) {
      console.log(`  [${type}] + ${title}`)
      added++
      if (!DRY) {
        await api('/api/rows/list_items', {
          method: 'POST',
          body: JSON.stringify({ row: { list_type: type, title, meta, status } })
        })
      }
      continue
    }

    const cur = rows[0]
    if (status === cur.status && JSON.stringify(meta ?? null) === JSON.stringify(cur.meta ?? null)) {
      skipped++
      continue
    }
    console.log(`  [${type}] ~ ${title}`)
    updated++
    if (!DRY) {
      await api(`/api/rows/list_items/${encodeURIComponent(cur.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ patch: { meta, status } })
      })
    }
  }
}

console.log(
  DRY
    ? `[dry-run] 将新增 ${added} 条、更新 ${updated} 条、跳过 ${skipped} 条（未写库）`
    : `同步完成：新增 ${added} 条、更新 ${updated} 条、跳过 ${skipped} 条`
)
