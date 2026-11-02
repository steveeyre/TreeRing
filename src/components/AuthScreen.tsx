import { useState } from 'react'
import type { FormEvent } from 'react'
import { signIn, signUp } from '../lib/data'
import RingMark from './RingMark'

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await signIn(email.trim(), password)
      else await signUp(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center px-7 safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <RingMark size={44} className="text-brand" />
          <h1 className="serif text-[30px] leading-none mt-4 text-ink">小年轮</h1>
          <p className="text-[13px] text-muted mt-2">把一天一天，记成一圈一圈。</p>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <label className="block">
            <span className="text-[11px] text-muted">邮箱</span>
            <input
              className="field mt-1 h-10"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="text-[11px] text-muted">密码</span>
            <input
              className="field mt-1 h-10"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          {error && <p className="text-xs text-rust leading-relaxed">{error}</p>}

          <button className="btn-primary w-full h-11" disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{mode === 'login' ? '还没有账号？' : '已有账号？'}</span>
            <button
              type="button"
              className="text-brand font-medium"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setError('')
              }}
            >
              {mode === 'login' ? '注册一个' : '去登录'}
            </button>
          </div>

          <p className="text-[11px] text-muted leading-relaxed pt-6 border-t border-line">
            爸爸和妈妈使用同一个账号即可协同记录。
          </p>
        </form>
      </div>
    </div>
  )
}
