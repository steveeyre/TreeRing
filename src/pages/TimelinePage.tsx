import { useEffect, useMemo, useState } from 'react'
import { useEntries } from '../hooks/useTable'
import { usePendingSync } from '../hooks/usePendingSync'
import { useAppStore, usePrefs } from '../lib/store'
import EntryCard from '../components/EntryCard'
import Modal from '../components/Modal'
import Composer from '../components/Composer'
import LoadError from '../components/LoadError'
import RingMark from '../components/RingMark'
import { apiCommonTags, type CommonTag } from '../lib/api'
import { CATEGORIES, CATEGORY_MAP } from '../lib/constants'
import { fmtDate } from '../lib/format'
import type { CategoryKey, Entry } from '../lib/types'

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  if (ymd(d) === ymd(today)) return '今天'
  const yest = new Date(today.getTime() - 86400000)
  if (ymd(d) === ymd(yest)) return '昨天'
  const sameYear = d.getFullYear() === today.getFullYear()
  return `${sameYear ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`
}

type SheetKind = 'category' | 'tags' | null

function FilterTrigger({
  label,
  active,
  color,
  onClick
}: {
  label: string
  active: boolean
  color?: string
  onClick: () => void
}) {
  const cls = active
    ? color
      ? 'text-white'
      : 'bg-ink text-white'
    : 'bg-white border border-line text-muted'
  return (
    <button
      className={`h-8 px-3 rounded-full text-xs whitespace-nowrap flex items-center gap-1 ${cls}`}
      style={active && color ? { background: color } : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-70">▾</span>
    </button>
  )
}

function FilterOption({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`w-full h-11 px-3 rounded-xl text-sm text-left flex items-center justify-between ${
        active ? 'bg-black/5 font-medium' : ''
      }`}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      {active && <span className="text-brand">✓</span>}
    </button>
  )
}

export default function TimelinePage() {
  const members = useAppStore((s) => s.members)
  const children = useAppStore((s) => s.children)
  const currentChildId = usePrefs((s) => s.currentChildId)
  const childId = children.find((c) => c.id === currentChildId)?.id ?? children[0]?.id ?? null
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryKey | null>(null)
  const [filterRecorder, setFilterRecorder] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [tags, setTags] = useState<CommonTag[] | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  // Ids still animating out; they stay rendered until the collapse finishes.
  const [removed, setRemoved] = useState<string[]>([])
  const pendingSync = usePendingSync()

  const { entries, loading, loadingMore, hasMore, error, reload, loadMore } = useEntries({
    childId,
    recorderId: filterRecorder,
    category,
    search,
    tag
  })

  // Fetch the tag list only when the picker is opened, and reuse it afterwards.
  useEffect(() => {
    if (sheet !== 'tags' || tags) return
    let alive = true
    apiCommonTags(30)
      .then((list) => {
        if (alive) setTags(list)
      })
      .catch(() => {
        if (alive) setTags([])
      })
    return () => {
      alive = false
    }
  }, [sheet, tags])

  const categoryLabel = category ? `${CATEGORY_MAP[category].emoji} ${CATEGORY_MAP[category].label}` : '全部分类'

  const visible = useMemo(() => entries.filter((e) => !removed.includes(e.id)), [entries, removed])

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of visible) {
      const key = fmtDate(e.occurred_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return Array.from(map.entries())
  }, [visible])

  return (
    <div className="min-h-full pb-28">
      <div className="px-4 pt-3 pb-2 space-y-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">🔍</span>
          <input
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-line bg-white text-sm outline-none focus:border-brand"
            placeholder="搜索正文或标签…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5 -mx-4 px-4">
          <FilterTrigger
            label={categoryLabel}
            active={category !== null}
            color={category ? CATEGORY_MAP[category].color : undefined}
            onClick={() => setSheet('category')}
          />
          <FilterTrigger
            label={tag ? `#${tag}` : '常见标签'}
            active={tag !== null}
            onClick={() => setSheet('tags')}
          />
        </div>
        {members.length > 1 && (
          <div className="flex flex-wrap gap-1.5 -mx-4 px-4">
            <button
              className={`h-8 px-3 rounded-full text-xs whitespace-nowrap shrink-0 ${
                filterRecorder === null ? 'bg-ink text-white' : 'bg-white border border-line text-muted'
              }`}
              onClick={() => setFilterRecorder(null)}
            >
              全部记录人
            </button>
            {members.map((m) => (
              <button
                key={m.id}
                className={`h-8 px-3 rounded-full text-xs whitespace-nowrap shrink-0 ${
                  filterRecorder === m.id ? 'bg-ink text-white' : 'bg-white border border-line text-muted'
                }`}
                onClick={() => setFilterRecorder(filterRecorder === m.id ? null : m.id)}
              >
                {m.emoji} {m.name}
              </button>
            ))}
          </div>
        )}
        {pendingSync.count > 0 && (
          <button
            className="w-full h-9 rounded-xl bg-brass/10 text-brass text-xs"
            onClick={pendingSync.flush}
          >
            ⏳ {pendingSync.count} 条记录待同步 · 联网后自动上传，点此重试
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-center text-muted text-sm py-16">加载中…</p>
      ) : error && visible.length === 0 ? (
        <LoadError message={error} onRetry={reload} />
      ) : visible.length === 0 ? (
        <div className="text-center py-20 px-6 space-y-2">
          <RingMark size={40} className="text-brand/45 mx-auto" />
          <p className="text-muted text-sm">
            {search || category || filterRecorder || tag
              ? '没有符合条件的记录'
              : '还没有记录，点右下角 + 开始吧'}
          </p>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-5">
          {groups.map(([day, list]) => (
            <section key={day}>
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-xs font-semibold text-muted">{dayLabel(day)}</h3>
                <div className="flex-1 h-px bg-line" />
                <span className="text-[11px] text-muted">{list.length} 条</span>
              </div>
              <div className="space-y-3">
                {list.map((e) => (
                  <EntryCard
                    key={e.id}
                    entry={e}
                    onEdit={setEditing}
                    onDeleted={(id) => setRemoved((prev) => [...prev, id])}
                  />
                ))}
              </div>
            </section>
          ))}
          {hasMore && (
            <div className="pt-2 pb-6 text-center">
              <button className="btn-soft h-11 px-6" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? '加载中…' : '加载更早的记录'}
              </button>
            </div>
          )}
        </div>
      )}

      <Modal open={sheet === 'category'} onClose={() => setSheet(null)} title="筛选分类">
        <div className="space-y-1">
          <FilterOption label="全部分类" active={category === null} onClick={() => {
            setCategory(null)
            setSheet(null)
          }} />
          {CATEGORIES.map((c) => (
            <FilterOption
              key={c.key}
              label={`${c.emoji} ${c.label}`}
              active={category === c.key}
              onClick={() => {
                setCategory(c.key)
                setSheet(null)
              }}
            />
          ))}
        </div>
      </Modal>

      <Modal open={sheet === 'tags'} onClose={() => setSheet(null)} title="常见标签">
        {tags === null ? (
          <p className="text-center text-muted text-sm py-8">加载中…</p>
        ) : tags.length === 0 ? (
          <p className="text-center text-muted text-sm py-8">还没有标签，记录后会自动出现</p>
        ) : (
          <div className="space-y-1">
            <FilterOption
              label="全部标签"
              active={tag === null}
              onClick={() => {
                setTag(null)
                setSheet(null)
              }}
            />
            {tags.map((t) => (
              <FilterOption
                key={t.tag}
                label={`#${t.tag}`}
                active={tag === t.tag}
                onClick={() => {
                  setTag(t.tag)
                  setSheet(null)
                }}
              />
            ))}
          </div>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="编辑记录">
        {editing && <Composer editEntry={editing} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  )
}