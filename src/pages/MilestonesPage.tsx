import { useMemo, useState } from 'react'
import { useMilestones } from '../hooks/useTable'
import { useAppStore, usePrefs } from '../lib/store'
import { addMilestone, updateMilestone, setMilestoneStatus, deleteMilestone, importMilestones } from '../lib/data'
import { parseMilestonesText } from '../lib/importer'
import { ageInMonths, milestoneAgeLabel } from '../lib/format'
import Modal from '../components/Modal'
import MilestoneShareCard from '../components/MilestoneShareCard'
import type { Milestone } from '../lib/types'
import footprintsMd from '../../footprints.md?raw'

const FILTERS: { key: 'all' | 'todo' | 'done'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '未完成' },
  { key: 'done', label: '已完成' }
]

const MILESTONE_COLORS = ['#3F6B51', '#A9762F', '#8E4A38', '#5C7A99', '#7A6A9B']

const STAGES = [
  { key: 'all', label: '全部月龄', min: 0, max: Number.POSITIVE_INFINITY },
  { key: '0-12', label: '0-1 岁', min: 0, max: 12 },
  { key: '12-24', label: '1-2 岁', min: 12, max: 24 },
  { key: '24-36', label: '2-3 岁', min: 24, max: 36 },
  { key: '36-48', label: '3-4 岁', min: 36, max: 48 },
  { key: '48-72', label: '4-6 岁', min: 48, max: 72 },
  { key: '72+', label: '6 岁以上', min: 72, max: Number.POSITIVE_INFINITY }
]

function inStage(m: Milestone, min: number, max: number): boolean {
  const lo = m.age_min_months ?? 0
  const hi = m.age_max_months ?? Number.POSITIVE_INFINITY
  return lo < max && hi > min
}

export default function MilestonesPage() {
  const { rows, loading, reload } = useMilestones()
  const children = useAppStore((s) => s.children)
  const currentChildId = usePrefs((s) => s.currentChildId)
  const child = children.find((c) => c.id === currentChildId) ?? children[0]
  const months = ageInMonths(child?.birth_date ?? null)
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all')
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('all')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [shareItem, setShareItem] = useState<Milestone | null>(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    age_min: '',
    age_max: '',
    category: ''
  })
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const done = rows.filter((r) => r.status === 'done').length
  const activeStage = STAGES.find((s) => s.key === stage) ?? STAGES[0]
  const term = search.trim().toLowerCase()
  const list = rows
    .filter((r) => (filter === 'all' ? true : r.status === filter))
    .filter((r) => inStage(r, activeStage.min, activeStage.max))
    .filter((r) =>
      term
        ? `${r.title} ${r.description ?? ''} ${r.category ?? ''}`.toLowerCase().includes(term)
        : true
    )
    .slice()
    .sort((a, b) => {
      const am = a.age_min_months ?? Number.POSITIVE_INFINITY
      const bm = b.age_min_months ?? Number.POSITIVE_INFINITY
      if (am !== bm) return am - bm
      return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title, 'zh-Hans-CN')
    })

  const recommended = useMemo(() => {
    const todo = rows
      .filter((r) => r.status !== 'done')
      .filter((m) => {
        if (months == null) return true
        // Only nudge things the child is roughly ready for: current age ±6 months.
        const lo = m.age_min_months ?? 0
        const hi = m.age_max_months ?? Number.POSITIVE_INFINITY
        return lo <= months + 6 && hi >= Math.max(0, months - 6)
      })
    if (months == null) return todo.slice(0, 5)
    const scored = todo.map((m) => {
      const min = m.age_min_months
      const max = m.age_max_months
      let score = 1000
      if (min != null && max != null) {
        if (months >= min && months <= max) score = 0
        else if (months < min) score = min - months
        else score = months - max
      } else if (min != null) {
        score = months >= min ? 0 : min - months
      } else if (max != null) {
        score = months <= max ? 0 : months - max
      }
      return { m, score }
    })
    scored.sort((a, b) => a.score - b.score)
    return scored.slice(0, 5).map((s) => s.m)
  }, [rows, months])

  const resetForm = () => setForm({ title: '', description: '', age_min: '', age_max: '', category: '' })

  const openAdd = () => {
    setEditing(null)
    resetForm()
    setAdding(true)
  }

  const openEdit = (m: Milestone) => {
    setEditing(m)
    setForm({
      title: m.title,
      description: m.description ?? '',
      age_min: m.age_min_months != null ? String(m.age_min_months) : '',
      age_max: m.age_max_months != null ? String(m.age_max_months) : '',
      category: m.category ?? ''
    })
    setAdding(true)
  }

  const submit = async () => {
    if (!form.title.trim()) return
    setBusy(true)
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        age_min_months: form.age_min ? Number(form.age_min) : null,
        age_max_months: form.age_max ? Number(form.age_max) : null,
        category: form.category.trim() || undefined
      }
      if (editing) await updateMilestone(editing.id, payload)
      else await addMilestone(payload)
      resetForm()
      setEditing(null)
      setAdding(false)
    } finally {
      setBusy(false)
    }
  }

  const importBuiltin = async () => {
    setImporting(true)
    setImportMsg(null)
    try {
      const items = parseMilestonesText(footprintsMd, 'footprints.md')
      if (items.length === 0) {
        setImportMsg('清单解析为空，请检查 footprints.md')
        return
      }
      const count = await importMilestones(items)
      await reload()
      setImportMsg(count > 0 ? `已导入 ${count} 条印记（共 ${items.length} 条，重复已跳过）` : '这些印记都已存在，无需重复导入')
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const colorFor = (i: number) => MILESTONE_COLORS[i % MILESTONE_COLORS.length]

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">印记进度</p>
          <p className="text-2xl font-bold">
            {done}
            <span className="text-base text-muted font-normal"> / {rows.length}</span>
          </p>
        </div>
        <div className="h-14 w-14 rounded-full relative">
          <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#DDE2D6" strokeWidth="4" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="#3F6B51"
              strokeWidth="4"
              strokeDasharray={`${rows.length ? (done / rows.length) * 97 : 0} 97`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
            {rows.length ? Math.round((done / rows.length) * 100) : 0}%
          </span>
        </div>
      </div>

      {!loading && recommended.length > 0 && filter !== 'done' && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">按月龄推荐</p>
            {months != null && <p className="text-[11px] text-muted">当前约 {months} 个月</p>}
          </div>
          <p className="text-[11px] text-muted">优先陪孩子完成这些未完成的印记</p>
          <div className="space-y-2">
            {recommended.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="text-lg">✨</span>
                <p className="flex-1 text-sm">{m.title}</p>
                <button
                  className="btn-soft text-xs h-8 px-2 shrink-0"
                  onClick={async () => {
                    await setMilestoneStatus(m.id, 'done')
                    setShareItem({ ...m, status: 'done', completed_at: new Date().toISOString() })
                  }}
                >
                  完成
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`h-9 px-4 rounded-full text-sm ${
              filter === f.key ? 'bg-ink text-white' : 'bg-white border border-line text-muted'
            }`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">🔍</span>
        <input
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-line bg-white text-sm outline-none focus:border-brand"
          placeholder="搜索印记名称、描述或分类…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
        {STAGES.map((s) => (
          <button
            key={s.key}
            className={`h-8 px-3 rounded-full text-xs whitespace-nowrap shrink-0 ${
              stage === s.key ? 'bg-ink text-white' : 'bg-white border border-line text-muted'
            }`}
            onClick={() => setStage(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-muted text-sm py-10">加载中…</p>
      ) : list.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <div className="text-4xl">🏅</div>
          <p className="text-muted text-sm">
            {filter === 'all' ? '还没有印记，点“添加印记”收录想陪孩子做的事' : '这个分类下暂无内容'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((m: Milestone, i) => {
            const color = colorFor(i)
            const isDone = m.status === 'done'
            return (
              <div key={m.id} className={`card p-4 space-y-2 ${isDone ? 'opacity-70' : ''}`}>
                <div className="flex items-start gap-3">
                  <button
                    aria-label={isDone ? '标记未完成' : '标记完成'}
                    className={`mt-0.5 w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 touch-target ${
                      isDone ? 'border-brand bg-brand text-white' : 'border-line bg-white'
                    }`}
                    onClick={async () => {
                      if (!isDone) {
                        await setMilestoneStatus(m.id, 'done')
                        setShareItem({ ...m, status: 'done', completed_at: new Date().toISOString() })
                      } else {
                        await setMilestoneStatus(m.id, 'todo')
                      }
                    }}
                  >
                    {isDone && '✓'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${isDone ? 'line-through text-muted' : ''}`}>{m.title}</p>
                    <p className="text-xs text-muted mt-0.5">
                      <span style={{ color }}>●</span> 适宜 {milestoneAgeLabel(m.age_min_months, m.age_max_months)}
                      {m.category ? ` · ${m.category}` : ''}
                    </p>
                    {m.description && <p className="text-sm text-muted mt-1 leading-relaxed">{m.description}</p>}
                  </div>
                  <button
                    aria-label="编辑印记"
                    className="w-8 h-8 text-muted shrink-0 touch-target"
                    onClick={() => openEdit(m)}
                  >
                    ✏️
                  </button>
                  <button
                    aria-label="删除印记"
                    className="w-8 h-8 text-muted shrink-0 touch-target"
                    onClick={() => void deleteMilestone(m.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-2">
        <button
          className="btn-primary w-full h-11"
          aria-label="添加印记"
          onClick={openAdd}
        >
          ＋ 添加印记
        </button>
        <button
          className="btn-soft w-full h-11"
          aria-label="导入内置印记清单"
          onClick={() => void importBuiltin()}
          disabled={importing}
        >
          {importing ? '导入中…' : '导入内置印记清单'}
        </button>
        {importMsg && <p className="text-xs text-muted text-center">{importMsg}</p>}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title={editing ? '编辑印记' : '添加印记'}>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted">名称</label>
            <input
              className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
              placeholder="例如：一起去坐摩天轮"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-muted">描述（可选）</label>
            <textarea
              className="mt-1 w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-brand resize-none"
              rows={2}
              placeholder="为什么想和孩子做这件事…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted">适宜年龄下限（月）</label>
              <input
                className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
                type="number"
                placeholder="如 36"
                value={form.age_min}
                onChange={(e) => setForm({ ...form, age_min: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted">上限（月，可选）</label>
              <input
                className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
                type="number"
                placeholder="如 72"
                value={form.age_max}
                onChange={(e) => setForm({ ...form, age_max: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">分类（可选）</label>
            <input
              className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
              placeholder="例如：户外 / 阅读 / 手工"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <button className="btn-primary w-full" onClick={() => void submit()} disabled={busy || !form.title.trim()}>
            {editing ? '保存' : '添加'}
          </button>
        </div>
      </Modal>

      <MilestoneShareCard
        milestone={shareItem}
        childName={child?.name}
        open={!!shareItem}
        onClose={() => setShareItem(null)}
      />
    </div>
  )
}