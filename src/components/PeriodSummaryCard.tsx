import { useCallback, useMemo, useState } from 'react'
import { apiListRows, type RowQuery } from '../lib/api'
import { useAppStore, usePrefs, getAI } from '../lib/store'
import { chatCompletion } from '../lib/ai'
import { ageInMonths, fmtDuration } from '../lib/format'
import type { Entry, ParsedFacts } from '../lib/types'

type RangeKey = 'week' | 'month'

function summarize(entries: Entry[]) {
  let sleepMins = 0
  let outdoorMins = 0
  const books = new Set<string>()
  const quotes: string[] = []
  const newWords: string[] = []
  const cats: Record<string, number> = {}
  for (const e of entries) {
    for (const c of e.categories ?? []) cats[c] = (cats[c] ?? 0) + 1
    const f = (e.parsed ?? null) as ParsedFacts | null
    if (!f) continue
    if (f.sleep?.durationMin) sleepMins += f.sleep.durationMin
    if (f.outdoor?.durationMin) outdoorMins += f.outdoor.durationMin
    for (const b of f.books ?? []) if (b.title) books.add(b.title)
    for (const q of f.quotes ?? []) if (q) quotes.push(q)
    for (const w of f.newWords ?? []) if (w) newWords.push(w)
  }
  const topCats = Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k)
  return {
    count: entries.length,
    sleepMins,
    outdoorMins,
    bookCount: books.size,
    books: Array.from(books).slice(0, 6),
    quotes: quotes.slice(0, 3),
    newWords: newWords.slice(0, 8),
    topCats
  }
}

export default function PeriodSummaryCard() {
  const session = useAppStore((s) => s.session)
  const children = useAppStore((s) => s.children)
  const currentChildId = usePrefs((s) => s.currentChildId)
  const child = children.find((c) => c.id === currentChildId) ?? children[0]
  const [range, setRange] = useState<RangeKey>('week')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')

  const load = useCallback(async () => {
    const uid = session?.user.id
    if (!uid) return
    setLoading(true)
    setError(null)
    try {
      const days = range === 'week' ? 7 : 30
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - (days - 1))
      const query: RowQuery = {
        isNull: ['deleted_at'],
        gte: { occurred_at: start.toISOString() },
        order: [{ col: 'occurred_at', desc: true }],
        limit: 500
      }
      if (child?.id) query.eq = { child_id: child.id }
      const data = await apiListRows<Entry>('entries', query)
      setEntries(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [session?.user.id, child?.id, range])

  const stats = useMemo(() => (entries ? summarize(entries) : null), [entries])
  const ageMonths = ageInMonths(child?.birth_date ?? null)
  const rangeLabel = range === 'week' ? '近 7 天' : '近 30 天'
  const catLabel: Record<string, string> = {
    schedule: '日程',
    health: '健康',
    habit: '习惯',
    development: '发展',
    learning: '学习',
    entertainment: '娱乐',
    event: '大事记',
    parent: '家长',
    other: '其他'
  }

  const askAi = async () => {
    if (!entries?.length) return
    const ai = getAI()
    if (!ai.apiKey) {
      setAiError('请先在设置中配置 AI')
      return
    }
    setAiBusy(true)
    setAiError('')
    try {
      const sample = entries
        .slice(0, 40)
        .map((e) => {
          const f = (e.parsed ?? null) as ParsedFacts | null
          const bits = [e.body.slice(0, 80)]
          if (f?.summary) bits.push(f.summary)
          if (f?.quotes?.length) bits.push(`语录：${f.quotes.join('；')}`)
          return `- ${bits.join(' | ')}`
        })
        .join('\n')
      const text = await chatCompletion([
        {
          role: 'system',
          content:
            '你是温暖的育儿助手。根据家长记录写一段简短小结（120-180字中文）：先肯定家长的付出，再概括孩子近况（作息/活动/阅读/亮点），最后给一条轻量建议。不要诊断疾病，不要编造记录中没有的事实。'
        },
        {
          role: 'user',
          content: `孩子：${child?.name ?? '宝宝'}${
            ageMonths != null ? `，约 ${ageMonths} 个月` : ''
          }\n${rangeLabel}共 ${entries.length} 条记录：\n${sample}`
        }
      ])
      setAiText(text)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI 小结失败')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">成长小结</p>
          <p className="text-[11px] text-muted">
            {child?.name ?? '宝宝'}
            {ageMonths != null ? ` · 约 ${ageMonths} 个月` : ''} · {rangeLabel}
          </p>
        </div>
        <div className="flex rounded-full border border-line overflow-hidden text-xs">
          {(
            [
              ['week', '周'],
              ['month', '月']
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`h-8 px-3 ${range === k ? 'bg-ink text-white' : 'bg-white text-muted'}`}
              onClick={() => {
                setRange(k)
                setEntries(null)
                setAiText('')
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {entries == null && !loading && !error && (
        <button className="btn-soft w-full h-11 text-sm" onClick={() => void load()}>
          生成{rangeLabel}小结
        </button>
      )}
      {loading && <p className="text-sm text-muted">统计中…</p>}
      {error && (
        <p className="text-xs text-brand-600">
          {error}{' '}
          <button className="underline" onClick={() => void load()}>
            重试
          </button>
        </p>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-black/[0.03] py-2">
              <p className="text-lg font-bold">{stats.count}</p>
              <p className="text-[11px] text-muted">条记录</p>
            </div>
            <div className="rounded-xl bg-black/[0.03] py-2">
              <p className="text-lg font-bold">{stats.bookCount}</p>
              <p className="text-[11px] text-muted">本绘本/书</p>
            </div>
            {stats.sleepMins > 0 && (
              <div className="rounded-xl bg-black/[0.03] py-2">
                <p className="text-sm font-semibold">{fmtDuration(stats.sleepMins)}</p>
                <p className="text-[11px] text-muted">累计睡眠记录</p>
              </div>
            )}
            {stats.outdoorMins > 0 && (
              <div className="rounded-xl bg-black/[0.03] py-2">
                <p className="text-sm font-semibold">{fmtDuration(stats.outdoorMins)}</p>
                <p className="text-[11px] text-muted">累计户外</p>
              </div>
            )}
          </div>
          {stats.topCats.length > 0 && (
            <p className="text-xs text-muted">主要关注：{stats.topCats.map((c) => catLabel[c] ?? c).join(' · ')}</p>
          )}
          {stats.quotes.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted">💬 语录摘录</p>
              {stats.quotes.map((q) => (
                <p key={q} className="text-sm leading-relaxed border-l-2 border-brand/40 pl-2">
                  {q}
                </p>
              ))}
            </div>
          )}
          {stats.newWords.length > 0 && (
            <p className="text-xs text-muted">🗣 新词：{stats.newWords.join('、')}</p>
          )}
          {stats.books.length > 0 && (
            <p className="text-xs text-muted">📚 {stats.books.join('、')}</p>
          )}

          {!aiText && (
            <button className="btn-primary w-full h-11 text-sm" disabled={aiBusy} onClick={() => void askAi()}>
              {aiBusy ? 'AI 总结中…' : '✨ AI 温暖小结'}
            </button>
          )}
          {aiError && <p className="text-xs text-brand-600">{aiError}</p>}
          {aiText && (
            <div className="rounded-xl bg-brand/5 p-3 text-sm leading-relaxed whitespace-pre-wrap">{aiText}</div>
          )}
          <button className="text-xs text-muted underline" onClick={() => void load()}>
            刷新数据
          </button>
        </>
      )}
    </div>
  )
}
