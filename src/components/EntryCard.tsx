import { useRef, useState } from 'react'
import { deleteEntry, retryParse } from '../lib/data'
import { CATEGORY_MAP } from '../lib/constants'
import { relTime, fmtDuration } from '../lib/format'
import { useAppStore } from '../lib/store'
import AIAdvice from './AIAdvice'
import SocialCard from './SocialCard'
import AudioAttachment from './AudioAttachment'
import type { Entry, ParsedFacts } from '../lib/types'

function factSummary(f: ParsedFacts | null): string[] {
  if (!f) return []
  const parts: string[] = []
  if (f.sleep) parts.push(`睡眠 ${fmtDuration(f.sleep.durationMin ?? 0)}`)
  if (f.outdoor?.durationMin || f.outdoor?.type) {
    const d = f.outdoor.durationMin ? ` ${fmtDuration(f.outdoor.durationMin)}` : ''
    parts.push(`活动 ${f.outdoor.type ?? ''}${d}`.trim())
  }
  if (f.meals?.length) parts.push(`饮食 ${f.meals.map((m) => m.content ?? m.type ?? '').filter(Boolean).join('、')}`)
  if (f.growth) {
    if (f.growth.heightCm) parts.push(`身高 ${f.growth.heightCm} cm`)
    if (f.growth.weightKg) parts.push(`体重 ${f.growth.weightKg} kg`)
  }
  if (f.books?.length) parts.push(`阅读 ${f.books.map((b) => b.title).join('、')}`)
  if (f.games?.length) parts.push(`游戏 ${f.games.map((g) => g.title).join('、')}`)
  if (f.media?.length) parts.push(`影视 ${f.media.map((m) => m.title).join('、')}`)
  if (f.illness?.name) parts.push(`生病：${f.illness.name}`)
  if (f.teeth) parts.push('牙齿记录')
  return parts
}

export default function EntryCard({
  entry,
  onEdit,
  onDeleted
}: {
  entry: Entry
  onEdit: (e: Entry) => void
  onDeleted?: (id: string) => void
}) {
  const members = useAppStore((s) => s.members)
  const children = useAppStore((s) => s.children)
  const member = members.find((m) => m.id === entry.recorder_id)
  const child = children.find((c) => c.id === entry.child_id)
  const [shareOpen, setShareOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [delError, setDelError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const cats = entry.categories ?? []
  const facts = factSummary((entry.parsed ?? null) as ParsedFacts | null)
  const parseStale =
    entry.parse_status === 'done' &&
    entry.content_version != null &&
    entry.parsed_version != null &&
    entry.parsed_version !== entry.content_version
  const showParseUi =
    entry.parse_status === 'pending' ||
    entry.parse_status === 'running' ||
    entry.parse_status === 'failed' ||
    parseStale

  const doDelete = async () => {
    if (!confirmDel) {
      setConfirmDel(true)
      setTimeout(() => setConfirmDel(false), 3000)
      return
    }
    try {
      await deleteEntry(entry.id)
      // Freeze the current height first, then animate to 0 so the cards below slide up.
      const el = rootRef.current
      if (el) el.style.maxHeight = `${el.offsetHeight}px`
      setLeaving(true)
      requestAnimationFrame(() => {
        if (rootRef.current) rootRef.current.style.maxHeight = '0px'
      })
      setTimeout(() => onDeleted?.(entry.id), 300)
    } catch (e) {
      setDelError(e instanceof Error ? e.message : '删除失败')
      setConfirmDel(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="card p-4 space-y-3"
      style={{
        overflow: leaving ? 'hidden' : undefined,
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(-6px) scale(0.97)' : 'none',
        marginTop: leaving ? 0 : undefined,
        transition: 'opacity 220ms ease, transform 260ms ease, max-height 300ms ease'
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0 border"
          style={{ background: member?.color ? `${member.color}1A` : '#F1EDE4', borderColor: member?.color ?? '#E4DED2' }}
        >
          {member?.emoji ?? '👤'}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {member?.name ?? '家人'}
              {child ? <span className="text-xs text-muted ml-1.5">· {child.name}</span> : null}
            </span>
            <span className="text-xs text-muted shrink-0">{relTime(entry.occurred_at)}</span>
          </div>
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{entry.body}</p>
          {facts.length > 0 && (
            <p className="text-xs text-muted leading-relaxed">{facts.join(' · ')}</p>
          )}
          {cats.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cats.map((c) => {
                const m = CATEGORY_MAP[c]
                if (!m) return null
                return (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ color: m.color, background: `${m.color}14`, border: `1px solid ${m.color}30` }}
                  >
                    {m.emoji} {m.label}
                  </span>
                )
              })}
            </div>
          )}
          {entry.tags.length > 0 && (
            <p className="text-xs text-muted font-mono">{entry.tags.map((t) => `#${t}`).join(' ')}</p>
          )}
          {showParseUi && (
            <div className="flex items-center gap-2 text-xs">
              {entry.parse_status === 'running' && <span className="text-muted">AI 解析中…</span>}
              {entry.parse_status === 'pending' && <span className="text-muted">等待 AI 解析</span>}
              {entry.parse_status === 'failed' && (
                <>
                  <span className="text-brand-600">AI 解析失败{entry.parse_error ? `：${entry.parse_error}` : ''}</span>
                  <button
                    className="btn-soft h-8 px-2 text-xs"
                    onClick={() => void retryParse(entry.id)}
                  >
                    重试
                  </button>
                </>
              )}
              {parseStale && (
                <>
                  <span className="text-muted">AI 摘要可能已过期（正文已修改）</span>
                  <button
                    className="btn-soft h-8 px-2 text-xs"
                    onClick={() => void retryParse(entry.id)}
                  >
                    重新解析
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {entry.audio_path && (
        <AudioAttachment path={entry.audio_path} durationSec={entry.audio_duration_sec} />
      )}

      <AIAdvice entry={entry} />

      <div className="flex items-center gap-2 pt-1 border-t border-line/60">
        <button className="btn-soft text-xs flex-1" onClick={() => setShareOpen(true)}>
          📤 分享
        </button>
        <button className="btn-soft text-xs flex-1" onClick={() => onEdit(entry)}>
          ✏️ 编辑
        </button>
        <button
          className={`text-xs flex-1 h-9 rounded-full transition-colors touch-target ${
            confirmDel ? 'bg-brand-600 text-white' : 'text-muted hover:bg-black/5'
          }`}
          onClick={() => void doDelete()}
        >
          {confirmDel ? '确认删除?' : '🗑 删除'}
        </button>
      </div>
      {delError && <p className="text-xs text-brand-600">{delError}</p>}

      <SocialCard entry={entry} member={member} child={child} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  )
}