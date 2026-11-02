import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAppStore, usePrefs } from '../lib/store'
import { createChild } from '../lib/data'
import { SEED_MEMBERS } from '../lib/seedData'
import RingMark from './RingMark'

export default function Onboarding() {
  const members = useAppStore((s) => s.members)
  const setCurrentChildId = usePrefs((s) => s.setCurrentChildId)
  const setCurrentRecorderId = usePrefs((s) => s.setCurrentRecorderId)

  const [recorderId, setRecorderId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [gender, setGender] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('请填写孩子的小名或称呼')
      return
    }
    setBusy(true)
    setError('')
    try {
      const child = await createChild({
        name: name.trim(),
        birth_date: birthDate || null,
        gender: gender || null
      })
      setCurrentChildId(child.id)
      if (recorderId) setCurrentRecorderId(recorderId)
      else setCurrentRecorderId(members[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
      setBusy(false)
    }
  }

  const recs = members.length ? members : SEED_MEMBERS.map((m, i) => ({ ...m, id: `seed-${i}` }))

  return (
    <div className="h-full overflow-y-auto safe-bottom">
      <div className="max-w-md mx-auto p-6 space-y-6">
        <div className="text-center space-y-2 pt-8">
          <RingMark size={52} className="text-brand mx-auto" />
          <h1 className="text-xl font-bold">欢迎使用小年轮</h1>
          <p className="text-sm text-muted">先做 2 个小设置，马上开始记录</p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 space-y-3">
            <p className="text-sm font-semibold">平时主要由谁来记录？</p>
            <div className="grid grid-cols-2 gap-3">
              {recs.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`h-14 rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-medium transition-colors touch-target ${
                    recorderId === m.id ? 'border-brand bg-brand/5 text-brand' : 'border-line bg-white text-ink'
                  }`}
                  onClick={() => setRecorderId(m.id)}
                >
                  <span className="text-xl">{m.emoji}</span>
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <p className="text-sm font-semibold">孩子的基本信息</p>
            <div>
              <label className="text-xs text-muted">名字 / 小名</label>
              <input
                className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
                placeholder="例如：豆豆"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted">出生日期（用于月龄统计）</label>
              <input
                className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-4 text-sm outline-none focus:border-brand"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted">性别</label>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {[
                  ['boy', '男孩'],
                  ['girl', '女孩'],
                  ['', '保密']
                ].map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={`h-10 rounded-xl border text-sm ${
                      gender === v ? 'border-brand bg-brand/5 text-brand' : 'border-line bg-white text-ink'
                    }`}
                    onClick={() => setGender(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-brand-600">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? '创建中…' : '完成，开始记录'}
          </button>
        </form>
      </div>
    </div>
  )
}