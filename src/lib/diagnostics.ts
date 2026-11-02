import { apiBootstrap, apiHealth, apiMe, readStoredSession } from './api'
import { getAI, useAppStore } from './store'

export type DiagStatus = 'pending' | 'ok' | 'fail' | 'skip'

export interface DiagItem {
  key: 'page' | 'auth' | 'db' | 'ai'
  label: string
  status: DiagStatus
  detail: string
  ms?: number
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const t0 = performance.now()
  try {
    const value = await fn()
    return { value, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - t0) }
  }
}

/** Layered connectivity check: page origin → Worker auth/db → optional AI endpoint. */
export async function runConnectivityDiagnostics(): Promise<DiagItem[]> {
  const items: DiagItem[] = [
    {
      key: 'page',
      label: '页面入口（当前域名）',
      status: 'ok',
      detail: `${location.origin} · 已加载应用壳`
    },
    {
      key: 'auth',
      label: '登录会话（Workers）',
      status: 'pending',
      detail: '检查中…'
    },
    {
      key: 'db',
      label: '数据服务（D1）',
      status: 'pending',
      detail: '检查中…'
    },
    {
      key: 'ai',
      label: 'AI 端点',
      status: 'pending',
      detail: '检查中…'
    }
  ]

  const health = await timed(() => apiHealth())
  const auth = await timed(async () => {
    const stored = readStoredSession()
    if (!stored) return null
    const user = await apiMe()
    return user.email
  })
  const authIdx = 1
  if (health.error && auth.error) {
    items[authIdx] = {
      ...items[authIdx],
      status: 'fail',
      detail: `${auth.error}（/api/health 也不可达：${health.error}）`,
      ms: auth.ms
    }
  } else if (auth.error) {
    items[authIdx] = { ...items[authIdx], status: 'fail', detail: auth.error, ms: auth.ms }
  } else {
    items[authIdx] = {
      ...items[authIdx],
      status: 'ok',
      detail: auth.value ? `已登录：${auth.value}` : '未登录（会话接口可达）',
      ms: auth.ms
    }
  }

  const db = await timed(async () => {
    const stored = readStoredSession()
    if (!stored) {
      // Not logged in: health check proves Worker+D1 binding is up.
      const h = await apiHealth()
      return `worker 可达（${h.time}），登录后可读业务数据`
    }
    const { members, children } = await apiBootstrap()
    return `bootstrap 可读：成员 ${members.length} · 孩子 ${children.length}`
  })
  const dbIdx = 2
  if (db.error) {
    items[dbIdx] = { ...items[dbIdx], status: 'fail', detail: db.error, ms: db.ms }
  } else {
    items[dbIdx] = {
      ...items[dbIdx],
      status: 'ok',
      detail: `${db.value} · ${db.ms}ms`,
      ms: db.ms
    }
  }

  const ai = getAI()
  const aiIdx = 3
  if (!ai.apiKey || !ai.baseUrl) {
    items[aiIdx] = {
      ...items[aiIdx],
      status: 'skip',
      detail: '未配置 API Key / Base URL（记录功能不受影响）'
    }
  } else {
    const r = await timed(async () => {
      const base = ai.baseUrl.replace(/\/+$/, '')
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${ai.apiKey}` },
        signal: AbortSignal.timeout(12000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.status
    })
    if (r.error) {
      items[aiIdx] = {
        ...items[aiIdx],
        status: 'fail',
        detail: `${r.error} · ${r.ms}ms（不影响文字记录与档案）`,
        ms: r.ms
      }
    } else {
      items[aiIdx] = {
        ...items[aiIdx],
        status: 'ok',
        detail: `可达 · ${r.ms}ms`,
        ms: r.ms
      }
    }
  }

  // Touch store so tree-shaking keeps useAppStore import useful if needed later.
  void useAppStore.getState().session
  return items
}
