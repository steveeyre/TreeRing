import { useState } from 'react'
import { requestAdvice } from '../lib/data'
import type { Entry } from '../lib/types'

function AdviceBody({ text }: { text: string }) {
  return (
    <div className="bg-brand/5 border border-brand/15 rounded-xl p-3.5 text-sm leading-relaxed whitespace-pre-wrap">
      {text}
    </div>
  )
}

export default function AIAdvice({ entry }: { entry: Entry }) {
  const [text, setText] = useState(entry.ai_advice)
  const [open, setOpen] = useState(!!entry.ai_advice)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const request = async () => {
    setLoading(true)
    setError('')
    try {
      const t = await requestAdvice(entry.id)
      setText(t)
      setOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败')
    } finally {
      setLoading(false)
    }
  }

  if (!text && !loading && !error) {
    return (
      <div className="flex items-center gap-2">
        <button className="btn-soft text-sm" onClick={() => void request()}>
          ✨ AI 建议
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {text && (
        <div className="border border-line rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-3.5 h-11 text-sm font-medium bg-black/[0.02]"
            onClick={() => setOpen(!open)}
          >
            <span>✨ AI 建议</span>
            <span className="text-muted text-xs">{open ? '收起' : '展开'}</span>
          </button>
          {open && (
            <div className="p-3.5">
              <AdviceBody text={text} />
            </div>
          )}
        </div>
      )}
      {loading && <p className="text-xs text-muted px-1">AI 正在思考…</p>}
      {error && <p className="text-xs text-brand-600 px-1">{error}</p>}
      {(text || error) && (
        <button className="btn-soft text-xs" onClick={() => void request()} disabled={loading}>
          重新生成
        </button>
      )}
    </div>
  )
}