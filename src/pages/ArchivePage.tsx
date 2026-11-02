import { useMemo, useState } from 'react'
import { useAppStore, usePrefs } from '../lib/store'
import { useEntries, useGrowth, useHealth, useListItems, useMilestones } from '../hooks/useTable'
import {
  addGrowthRecord,
  addHealthEvent,
  deleteHealthEvent,
  addListItem,
  setListItemStatus,
  deleteListItem,
  updateChild
} from '../lib/data'
import GrowthChart from '../components/GrowthChart'
import StatBlock from '../components/StatBlock'
import PeriodSummaryCard from '../components/PeriodSummaryCard'
import Modal from '../components/Modal'
import MilestonesPage from './MilestonesPage'
import { growthReference } from '../lib/growthRef'
import { LIST_TYPE_LABELS, HEALTH_EVENT_LABELS } from '../lib/constants'
import { fmtDate, fmtDuration, ageInMonths, ageLabel } from '../lib/format'
import type { Entry, HealthEventType, ListType, ParsedFacts } from '../lib/types'

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'milestones', label: '印记' },
  { key: 'growth', label: '生长' },
  { key: 'health', label: '健康' },
  { key: 'lists', label: '清单' },
  { key: 'stats', label: '统计' }
] as const

type TabKey = (typeof TABS)[number]['key']

const HEALTH_TYPES: HealthEventType[] = ['vaccine', 'illness', 'allergy', 'checkup', 'tooth']
const LIST_TYPES: ListType[] = ['book', 'game', 'animation', 'documentary', 'movie']

function perDayMin(entries: Entry[], pick: (f: ParsedFacts) => number | undefined) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d
  })
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const dayMap = new Map(days.map((d) => [key(d), 0]))
  for (const e of entries) {
    const f = (e.parsed ?? null) as ParsedFacts | null
    if (!f) continue
    const v = pick(f)
    if (!v) continue
    const k = key(new Date(e.occurred_at))
    if (dayMap.has(k)) dayMap.set(k, (dayMap.get(k) ?? 0) + v)
  }
  const wd = ['日', '一', '二', '三', '四', '五', '六']
  return days.map((d) => ({ label: wd[d.getDay()], min: dayMap.get(key(d)) ?? 0 }))
}

function totalMin(days: { min: number }[]): number {
  return days.reduce((a, b) => a + b.min, 0)
}

/** Fixed 7-day average: missing days count as zero, not as "no data". */
function avgMin(days: { min: number }[]): number {
  return totalMin(days) / 7
}

function recordedDays(days: { min: number }[]): number {
  return days.filter((d) => d.min > 0).length
}

/** Fractional age in months at a measurement date, so two readings in one month don't collide. */
function ageMonthsAt(birth: string | null | undefined, iso: string): number | null {
  if (!birth) return null
  const b = new Date(birth)
  const d = new Date(iso)
  if (isNaN(b.getTime()) || isNaN(d.getTime())) return null
  const raw = (d.getTime() - b.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)
  return Math.max(0, Math.round(raw * 10) / 10)
}

export default function ArchivePage() {
  const children = useAppStore((s) => s.children)
  const currentChildId = usePrefs((s) => s.currentChildId)
  const child = children.find((c) => c.id === currentChildId) ?? children[0]

  const [tab, setTab] = useState<TabKey>('overview')
  const [listTab, setListTab] = useState<ListType>('book')
  const [editChild, setEditChild] = useState(false)
  const [childForm, setChildForm] = useState({ name: '', birth_date: '', gender: '' })

  const childId = child?.id ?? null
  // Only the tab being looked at keeps polling; the rest load once on mount.
  const { entries, total: entryTotal } = useEntries(
    { childId, recorderId: null, category: null, search: '' },
    { poll: tab === 'overview' || tab === 'stats' }
  )
  const { rows: growth, loading: gl } = useGrowth(
    childId,
    tab === 'overview' || tab === 'growth' || tab === 'stats'
  )
  const { rows: health, loading: hl } = useHealth(childId, tab === 'health')
  const { rows: milestones } = useMilestones(tab === 'overview' || tab === 'milestones')

  const books = useListItems('book', tab === 'lists' && listTab === 'book')
  const games = useListItems('game', tab === 'lists' && listTab === 'game')
  const animations = useListItems('animation', tab === 'lists' && listTab === 'animation')
  const documentaries = useListItems('documentary', tab === 'lists' && listTab === 'documentary')
  const movies = useListItems('movie', tab === 'lists' && listTab === 'movie')
  const custom = useListItems('custom', tab === 'stats')
  const listByType: Record<ListType, ReturnType<typeof useListItems>> = {
    book: books,
    game: games,
    animation: animations,
    documentary: documentaries,
    movie: movies,
    custom: custom
  }
  const [listInput, setListInput] = useState('')

  const [growthForm, setGrowthForm] = useState({ measured_at: fmtDate(new Date().toISOString()), height: '', weight: '' })
  const [healthForm, setHealthForm] = useState({
    event_type: 'vaccine' as HealthEventType,
    title: '',
    occurred_at: fmtDate(new Date().toISOString()),
    note: ''
  })
  const [healthFilter, setHealthFilter] = useState<'all' | HealthEventType>('all')

  const months = ageInMonths(child?.birth_date ?? null)
  const sleepDays = useMemo(() => perDayMin(entries, (f) => f.sleep?.durationMin), [entries])
  const actDays = useMemo(() => perDayMin(entries, (f) => f.outdoor?.durationMin), [entries])

  const birthDate = child?.birth_date ?? null
  const sex = child?.gender === 'boy' || child?.gender === 'girl' ? child.gender : null
  const refMax = Math.min(60, Math.max(24, (months ?? 24) + 12))
  const heightRef = useMemo(
    () => (sex ? growthReference('height', sex, refMax) : undefined),
    [sex, refMax]
  )
  const weightRef = useMemo(
    () => (sex ? growthReference('weight', sex, refMax) : undefined),
    [sex, refMax]
  )
  const xMode: 'age' | 'date' = birthDate ? 'age' : 'date'
  const heightPoints = useMemo(
    () =>
      growth
        .filter((g) => g.height_cm != null)
        .map((g) => {
          const age = ageMonthsAt(birthDate, g.measured_at)
          return {
            x: age ?? new Date(g.measured_at).getTime(),
            label: g.measured_at.slice(5, 10),
            value: g.height_cm
          }
        }),
    [growth, birthDate]
  )
  const weightPoints = useMemo(
    () =>
      growth
        .filter((g) => g.weight_kg != null)
        .map((g) => {
          const age = ageMonthsAt(birthDate, g.measured_at)
          return {
            x: age ?? new Date(g.measured_at).getTime(),
            label: g.measured_at.slice(5, 10),
            value: g.weight_kg
          }
        }),
    [growth, birthDate]
  )

  const openEditChild = () => {
    setChildForm({
      name: child?.name ?? '',
      birth_date: child?.birth_date ?? '',
      gender: child?.gender ?? ''
    })
    setEditChild(true)
  }

  const saveChild = async () => {
    if (!child) return
    await updateChild(child.id, {
      name: childForm.name.trim() || child.name,
      birth_date: childForm.birth_date || null,
      gender: childForm.gender || null
    })
    setEditChild(false)
  }

  const healthList = health.filter((h) => (healthFilter === 'all' ? true : h.event_type === healthFilter))

  return (
    <div className="min-h-full px-4 pt-4 pb-28 space-y-4">
      <div className="flex gap-1 bg-black/[0.04] rounded-full p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`flex-1 h-9 rounded-full text-sm ${
              tab === t.key ? 'bg-white shadow-sm font-medium' : 'text-muted'
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: child?.avatar_color ? `${child.avatar_color}1A` : '#F1EDE4' }}
              >
                {child?.gender === 'boy' ? '👦' : child?.gender === 'girl' ? '👧' : '🧒'}
              </div>
              <div className="flex-1">
                <p className="text-lg font-bold">{child?.name ?? '宝贝'}</p>
                <p className="text-sm text-muted">
                  {child?.birth_date ? `${child.birth_date} 出生` : '未填出生日期'}
                  {months != null ? ` · ${ageLabel(months)}` : ''}
                </p>
              </div>
              <button className="btn-soft text-xs" onClick={openEditChild}>
                编辑
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-lg font-bold">{entryTotal}</p>
                <p className="text-xs text-muted">记录条数</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">
                  {milestones.filter((m) => m.status === 'done').length}/{milestones.length}
                </p>
                <p className="text-xs text-muted">印记完成</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">
                  {growth.length ? `${growth[growth.length - 1].height_cm ?? '–'}` : '–'}
                </p>
                <p className="text-xs text-muted">最新身高 cm</p>
              </div>
            </div>
          </div>
          <PeriodSummaryCard />
        </>
      )}

      {tab === 'milestones' && <MilestonesPage />}

      {tab === 'growth' && (
        <>
          <div className="card p-4 space-y-4">
            <p className="text-sm font-semibold">身高（cm）</p>
            <GrowthChart unit="cm" xMode={xMode} data={heightPoints} reference={heightRef} />
            {sex ? (
              <p className="text-[11px] text-muted leading-relaxed">
                虚线为 WHO 0–5 岁参考线（P3 / P50 / P97，按月龄线性插值），仅供观察，不作为诊断依据。
              </p>
            ) : (
              <p className="text-[11px] text-muted">在孩子信息里填写性别后，会显示 WHO 参考曲线。</p>
            )}
          </div>
          <div className="card p-4 space-y-4">
            <p className="text-sm font-semibold">体重（kg）</p>
            <GrowthChart unit="kg" xMode={xMode} data={weightPoints} reference={weightRef} />
          </div>
          <div className="card p-4 space-y-3">
            <p className="text-sm font-semibold">新增测量</p>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="date"
                className="h-11 rounded-xl border border-line bg-white px-2 text-sm outline-none focus:border-brand"
                value={growthForm.measured_at}
                onChange={(e) => setGrowthForm({ ...growthForm, measured_at: e.target.value })}
              />
              <input
                className="h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                type="number"
                placeholder="身高 cm"
                value={growthForm.height}
                onChange={(e) => setGrowthForm({ ...growthForm, height: e.target.value })}
              />
              <input
                className="h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                type="number"
                placeholder="体重 kg"
                value={growthForm.weight}
                onChange={(e) => setGrowthForm({ ...growthForm, weight: e.target.value })}
              />
            </div>
            <button
              className="btn-primary w-full"
              disabled={!growthForm.height && !growthForm.weight}
              onClick={() => {
                void addGrowthRecord({
                  measured_at: growthForm.measured_at,
                  height_cm: growthForm.height ? Number(growthForm.height) : null,
                  weight_kg: growthForm.weight ? Number(growthForm.weight) : null
                })
                setGrowthForm({ ...growthForm, height: '', weight: '' })
              }}
            >
              保存
            </button>
            {gl && <p className="text-xs text-muted">加载中…</p>}
          </div>
        </>
      )}

      {tab === 'health' && (
        <>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            <button
              className={`h-8 px-3 rounded-full text-xs whitespace-nowrap shrink-0 ${
                healthFilter === 'all' ? 'bg-ink text-white' : 'bg-white border border-line text-muted'
              }`}
              onClick={() => setHealthFilter('all')}
            >
              全部
            </button>
            {HEALTH_TYPES.map((t) => (
              <button
                key={t}
                className={`h-8 px-3 rounded-full text-xs whitespace-nowrap shrink-0 ${
                  healthFilter === t ? 'bg-ink text-white' : 'bg-white border border-line text-muted'
                }`}
                onClick={() => setHealthFilter(healthFilter === t ? 'all' : t)}
              >
                {HEALTH_EVENT_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="card p-4 space-y-3">
            <p className="text-sm font-semibold">新增健康记录</p>
            <select
              className="w-full h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none"
              value={healthForm.event_type}
              onChange={(e) => setHealthForm({ ...healthForm, event_type: e.target.value as HealthEventType })}
            >
              {HEALTH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {HEALTH_EVENT_LABELS[t]}
                </option>
              ))}
            </select>
            <input
              className="w-full h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
              placeholder="名称 / 内容，如：流感疫苗第 2 针"
              value={healthForm.title}
              onChange={(e) => setHealthForm({ ...healthForm, title: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                className="h-11 rounded-xl border border-line bg-white px-2 text-sm outline-none"
                value={healthForm.occurred_at}
                onChange={(e) => setHealthForm({ ...healthForm, occurred_at: e.target.value })}
              />
              <input
                className="h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                placeholder="备注"
                value={healthForm.note}
                onChange={(e) => setHealthForm({ ...healthForm, note: e.target.value })}
              />
            </div>
            <button
              className="btn-primary w-full"
              disabled={!healthForm.title.trim()}
              onClick={() => {
                void addHealthEvent({
                  event_type: healthForm.event_type,
                  title: healthForm.title.trim(),
                  occurred_at: healthForm.occurred_at || null,
                  note: healthForm.note.trim() || null
                })
                setHealthForm({ ...healthForm, title: '', note: '' })
              }}
            >
              保存
            </button>
          </div>

          {hl && <p className="text-xs text-muted">加载中…</p>}
          <div className="space-y-2">
            {healthList.map((h) => (
              <div key={h.id} className="card p-3.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {HEALTH_EVENT_LABELS[h.event_type]} · {h.title}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {fmtDate(h.occurred_at ?? h.created_at)}
                    {h.data?.note ? ` · ${h.data.note}` : ''}
                  </p>
                </div>
                <button
                  aria-label="删除"
                  className="w-9 h-9 text-muted shrink-0 touch-target"
                  onClick={() => void deleteHealthEvent(h.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'lists' && (
        <>
          <div className="flex gap-1 bg-black/[0.04] rounded-full p-1">
            {LIST_TYPES.map((t) => (
              <button
                key={t}
                className={`flex-1 h-9 rounded-full text-sm ${
                  listTab === t ? 'bg-white shadow-sm font-medium' : 'text-muted'
                }`}
                onClick={() => setListTab(t)}
              >
                {LIST_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="card p-4 space-y-3">
            <p className="text-sm font-semibold">添加到{LIST_TYPE_LABELS[listTab]}清单</p>
            <div className="flex gap-2">
              <input
                className="flex-1 h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                placeholder={`输入名称，如：${
                  listTab === 'book'
                    ? '《猜猜我有多爱你》'
                    : listTab === 'game'
                      ? '双人成行'
                      : listTab === 'documentary'
                        ? '我们的星球'
                        : listTab === 'movie'
                          ? '放牛班的春天'
                          : '小猪佩奇'
                }`}
                value={listInput}
                onChange={(e) => setListInput(e.target.value)}
              />
              <button
                className="btn-primary px-5"
                disabled={!listInput.trim()}
                onClick={() => {
                  void addListItem(listTab, listInput.trim())
                  setListInput('')
                }}
              >
                添加
              </button>
            </div>
            <p className="text-[11px] text-muted">AI 解析记录时也会自动把书名、游戏名等加入对应清单</p>
          </div>

          <div className="space-y-2">
            {listByType[listTab].rows.map((item) => (
              <div key={item.id} className="card p-3.5 flex items-center gap-3">
                <button
                  aria-label="切换状态"
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 touch-target ${
                    item.status === 'done' ? 'border-brand bg-brand text-white' : 'border-line bg-white'
                  }`}
                  onClick={() => void setListItemStatus(item.id, item.status === 'done' ? 'todo' : 'done')}
                >
                  {item.status === 'done' && '✓'}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${item.status === 'done' ? 'line-through text-muted' : ''}`}>{item.title}</p>
                  {item.meta && Object.keys(item.meta).length > 0 && (
                    <p className="text-xs text-muted">{Object.entries(item.meta).filter(([, v]) => v).map(([k, v]) => `${k}：${String(v)}`).join(' · ')}</p>
                  )}
                </div>
                <button
                  aria-label="删除"
                  className="w-9 h-9 text-muted shrink-0 touch-target"
                  onClick={() => void deleteListItem(item.id)}
                >
                  ✕
                </button>
              </div>
            ))}
            {listByType[listTab].loading && <p className="text-xs text-muted text-center py-4">加载中…</p>}
          </div>
        </>
      )}

      {tab === 'stats' && (
        <>
          <StatBlock
            title="最近 7 天睡眠"
            value={fmtDuration(avgMin(sleepDays))}
            sub={`记录${recordedDays(sleepDays)}天，合计${fmtDuration(totalMin(sleepDays))}`}
            days={sleepDays}
          />
          <StatBlock
            title="最近 7 天户外活动"
            value={fmtDuration(avgMin(actDays))}
            sub={`记录${recordedDays(actDays)}天，合计${fmtDuration(totalMin(actDays))}`}
            days={actDays}
          />
          <div className="card p-4 space-y-2">
            <p className="text-sm font-semibold">清单规模</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p>📚 童书 <span className="font-bold">{books.rows.length}</span> 本</p>
              <p>🎮 游戏 <span className="font-bold">{games.rows.length}</span> 个</p>
              <p>🎬 动画 <span className="font-bold">{animations.rows.length}</span> 部</p>
              <p>🎥 纪录片 <span className="font-bold">{documentaries.rows.length}</span> 部</p>
              <p>🍿 电影 <span className="font-bold">{movies.rows.length}</span> 部</p>
              <p>🗂 自定义 <span className="font-bold">{custom.rows.length}</span> 项</p>
            </div>
          </div>
          <div className="card p-4 space-y-2">
            <p className="text-sm font-semibold">最新生长数据</p>
            {growth.length === 0 ? (
              <p className="text-sm text-muted">还没有测量记录</p>
            ) : (
              growth
                .slice(-3)
                .reverse()
                .map((g) => (
                  <div key={g.id} className="flex justify-between text-sm">
                    <span className="text-muted">{fmtDate(g.measured_at)}</span>
                    <span>
                      {g.height_cm != null ? `${g.height_cm} cm` : '–'}
                      <span className="mx-2 text-line">|</span>
                      {g.weight_kg != null ? `${g.weight_kg} kg` : '–'}
                    </span>
                  </div>
                ))
            )}
          </div>
        </>
      )}

      <Modal open={editChild} onClose={() => setEditChild(false)} title="编辑孩子信息">
        <div className="space-y-4">
          <input
            className="w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
            placeholder="名字 / 小名"
            value={childForm.name}
            onChange={(e) => setChildForm({ ...childForm, name: e.target.value })}
          />
          <input
            type="date"
            className="w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none"
            value={childForm.birth_date}
            onChange={(e) => setChildForm({ ...childForm, birth_date: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-2">
            {[
              ['boy', '男孩'],
              ['girl', '女孩'],
              ['', '保密']
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`h-10 rounded-xl border text-sm ${
                  childForm.gender === v ? 'border-brand bg-brand/5 text-brand' : 'border-line bg-white text-ink'
                }`}
                onClick={() => setChildForm({ ...childForm, gender: v })}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="btn-primary w-full" onClick={() => void saveChild()}>
            保存
          </button>
        </div>
      </Modal>
    </div>
  )
}