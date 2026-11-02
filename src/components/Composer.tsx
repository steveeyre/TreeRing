import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore, usePrefs } from '../lib/store'
import { saveEntry, updateEntryContent, requestAdvice } from '../lib/data'
import { clearDraft, isDraftMeaningful, loadDraft, saveDraft } from '../lib/draftStore'
import { CATEGORIES } from '../lib/constants'
import { QUICK_TEMPLATES } from '../lib/templates'
import RecorderSwitcher from './RecorderSwitcher'
import VoiceRecorder from './VoiceRecorder'
import type { VoiceResult } from './VoiceRecorder'
import type { CategoryKey, Entry } from '../lib/types'

export default function Composer({
  standalone = false,
  editEntry = null,
  onClose
}: {
  standalone?: boolean
  editEntry?: Entry | null
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const children = useAppStore((s) => s.children)
  const currentChildId = usePrefs((s) => s.currentChildId)
  const recorderId = usePrefs((s) => s.currentRecorderId)

  const [body, setBody] = useState(editEntry?.body ?? '')
  const [audio, setAudio] = useState<{ blob: Blob; ext: string; durationSec: number } | null>(null)
  // Edit form only shows/edits MANUAL tags; AI tags are merged back on save.
  const [cats, setCats] = useState<CategoryKey[]>(editEntry?.manual_categories ?? editEntry?.categories ?? [])
  const [tags, setTags] = useState((editEntry?.manual_tags ?? editEntry?.tags ?? []).join('，'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [advice, setAdvice] = useState(editEntry?.ai_advice ?? '')
  const [adviceLoading, setAdviceLoading] = useState(false)
  const [adviceOpen, setAdviceOpen] = useState(false)
  const baseContentVersion = useRef<number>(editEntry?.content_version ?? 1)

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const savedId = useRef<string | null>(editEntry?.id ?? null)
  // A saved entry must never be written back into the draft store by a timer that was
  // scheduled just before saving.
  const savedOnce = useRef(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const skipDraftInit = useRef(false)

  useEffect(() => {
    if (standalone) setTimeout(() => bodyRef.current?.focus(), 150)
  }, [standalone])

  // Restore local draft for NEW entries only (never overwrite an existing server entry being edited).
  useEffect(() => {
    if (editEntry) return
    const uid = useAppStore.getState().session?.user.id
    if (!uid) return
    let alive = true
    void (async () => {
      try {
        const d = await loadDraft(uid)
        if (!alive || !d || !isDraftMeaningful(d)) return
        skipDraftInit.current = true
        setBody(d.body)
        // Categories are a deliberate per-entry choice; never inherit them from a draft,
        // otherwise a new entry opens with a chip already selected.
        setTags(d.tags ?? '')
        if (d.audio) setAudio(d.audio)
        if (d.childId) usePrefs.getState().setCurrentChildId(d.childId)
        if (d.recorderId) usePrefs.getState().setCurrentRecorderId(d.recorderId)
        setDraftRestored(true)
      } catch {
        // Quota / private mode — do not claim draft is protected.
        setDraftNote('本机草稿不可用（浏览器限制或存储已满），请尽快点保存。')
      }
    })()
    return () => {
      alive = false
    }
  }, [editEntry])

  // Persist draft (debounced) while composing a new entry.
  useEffect(() => {
    if (editEntry) return
    const uid = useAppStore.getState().session?.user.id
    if (!uid) return
    if (skipDraftInit.current) {
      skipDraftInit.current = false
      return
    }
    if (!body.trim() && !audio && !cats.length && !tags.trim()) return
    const timer = setTimeout(() => {
      if (savedOnce.current) return
      void saveDraft(uid, {
        body,
        categories: cats,
        tags,
        childId: currentChildId,
        recorderId,
        audio: audio ?? undefined,
        updatedAt: new Date().toISOString()
      }).catch(() => {
        setDraftNote('本机草稿保存失败（可能是存储空间不足），请尽快点保存到云端。')
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [body, cats, tags, audio, editEntry, currentChildId, recorderId])

  const close = () => {
    if (onClose) onClose()
    else navigate('/')
  }

  const parseTags = () =>
    tags
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)

  const ensureSaved = async (): Promise<string | null> => {
    if (!body.trim()) return null
    // savedId is pre-seeded with the entry being edited, so it only short-circuits new entries;
    // an edit must always go through updateEntryContent.
    if (savedId.current && !editEntry) return savedId.current
    if (editEntry) {
      const updated = await updateEntryContent(
        editEntry.id,
        {
          body: body.trim(),
          categories: cats,
          tags: parseTags(),
          child_id: currentChildId,
          recorder_id: recorderId
        },
        baseContentVersion.current
      )
      baseContentVersion.current = updated.content_version ?? baseContentVersion.current
      savedId.current = editEntry.id
      return editEntry.id
    }
    const entry = await saveEntry({
      body: body.trim(),
      childId: currentChildId,
      recorderId,
      categories: cats,
      tags: parseTags(),
      audio: audio ?? undefined
    })
    savedId.current = entry.id
    savedOnce.current = true
    return entry.id
  }

  const onSave = async () => {
    if (audio && !body.trim()) {
      setError('录音记录需填写文字简介')
      return
    }
    if (!body.trim()) {
      setError('写点什么，或者录一段语音～')
      return
    }
    setSaving(true)
    setError('')
    try {
      await ensureSaved()
      if (!editEntry) {
        const uid = useAppStore.getState().session?.user.id
        if (uid) await clearDraft(uid).catch(() => {})
      }
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请检查网络')
    } finally {
      setSaving(false)
    }
  }

  const onAdvice = async () => {
    setAdviceLoading(true)
    setError('')
    try {
      const target = await ensureSaved()
      if (!target) {
        setError('先写点内容，再问 AI 吧～')
        return
      }
      const t = await requestAdvice(target)
      setAdvice(t)
      setAdviceOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 请求失败，请到设置检查 API 配置')
    } finally {
      setAdviceLoading(false)
    }
  }

  const handleVoice = (r: VoiceResult) => {
    setAudio({ blob: r.blob, ext: r.ext, durationSec: r.durationSec })
  }

  const form = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <RecorderSwitcher />
        {children.length > 1 && (
          <select
            className="h-9 rounded-xl border border-line bg-white px-2 text-sm outline-none"
            value={currentChildId ?? ''}
            onChange={(e) => usePrefs.getState().setCurrentChildId(e.target.value || null)}
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <p className="text-xs text-muted mb-2">快捷模板</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              className="h-9 px-3 rounded-full bg-white border border-line text-sm touch-target"
              onClick={() => {
                setBody((prev) => (prev.trim() ? `${prev}\n${t.body}` : t.body))
                if (t.categories) {
                  setCats((prev) => Array.from(new Set([...prev, ...(t.categories as CategoryKey[])])))
                }
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        ref={bodyRef}
        className="w-full min-h-[120px] rounded-2xl border border-line bg-white p-4 text-base leading-relaxed outline-none focus:border-brand resize-y"
        placeholder="记录此刻…例如：晚上 9 点睡了，讲了《猜猜我有多爱你》，陪睡玩偶是小熊。"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <VoiceRecorder onResult={handleVoice} />

      {audio && (
        <p className="text-xs text-muted">
          🎙 已附加一段录音（保存时一起上传）。{!body.trim() && '保存前请填一句文字简介。'}
        </p>
      )}

      <div>
        <p className="text-xs text-muted mb-2">分类（可选，AI 也会自动识别）</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = cats.includes(c.key)
            return (
              <button
                key={c.key}
                type="button"
                className={`h-9 px-3 rounded-full text-sm flex items-center gap-1 touch-target ${
                  on ? 'text-white' : 'bg-white border border-line text-ink'
                }`}
                style={on ? { background: c.color } : undefined}
                onClick={() =>
                  setCats((prev) => (prev.includes(c.key) ? prev.filter((x) => x !== c.key) : [...prev, c.key]))
                }
              >
                {c.emoji} {c.label}
              </button>
            )
          })}
        </div>
      </div>

      <input
        className="w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
        placeholder="标签，可选，AI 也会自动识别。用逗号分隔，例如：睡眠，亲子阅读。"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />

      {advice && (
        <div className="border border-line rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3.5 h-11 text-sm font-medium bg-black/[0.02]"
            onClick={() => setAdviceOpen(!adviceOpen)}
          >
            <span>✨ AI 建议（已保存本条记录）</span>
            <span className="text-muted text-xs">{adviceOpen ? '收起' : '展开'}</span>
          </button>
          {adviceOpen && (
            <div className="p-3.5 bg-brand/5 text-sm leading-relaxed whitespace-pre-wrap">{advice}</div>
          )}
        </div>
      )}
      {draftRestored && (
        <p className="text-xs text-brand">已从本机草稿恢复未保存的内容</p>
      )}
      {draftNote && <p className="text-xs text-muted">{draftNote}</p>}
      {adviceLoading && <p className="text-xs text-muted px-1">AI 正在思考…</p>}
      {error && <p className="text-xs text-brand-600 px-1">{error}</p>}
    </div>
  )

  const buttons = (
    <div className="flex gap-2 shrink-0">
      <button className="btn-soft flex-1" onClick={() => void onAdvice()} disabled={saving || adviceLoading}>
        ✨ AI 建议
      </button>
      <button className="btn-primary flex-1" onClick={() => void onSave()} disabled={saving || adviceLoading}>
        {saving ? '保存中…' : editEntry ? '保存修改' : '记 录'}
      </button>
    </div>
  )

  if (standalone) {
    return (
      <div className="h-full flex flex-col max-w-md mx-auto safe-top">
        <header className="flex items-center justify-between px-2 h-12 shrink-0">
          <button className="px-2 h-11 text-muted" onClick={close}>
            ← 取消
          </button>
          <span className="font-semibold">{editEntry ? '编辑记录' : '记录成长'}</span>
          <span className="w-12" />
        </header>
        <div className="flex-1 overflow-y-auto p-4">{form}</div>
        <div className="p-4 border-t border-line bg-paper safe-bottom">{buttons}</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {form}
      {buttons}
    </div>
  )
}