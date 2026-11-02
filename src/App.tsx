import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useAppStore } from './lib/store'
import { startOutbox } from './lib/api'
import AuthScreen from './components/AuthScreen'
import Onboarding from './components/Onboarding'
import Shell from './components/Shell'
import Composer from './components/Composer'
import RingMark from './components/RingMark'

function Splash({ hint }: { hint?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4">
      <RingMark size={48} className="text-brand" />
      <div className="text-sm text-muted">{hint || '小年轮 · 正在加载'}</div>
    </div>
  )
}

export default function App() {
  useAuth()
  useEffect(() => {
    startOutbox()
  }, [])
  const session = useAppStore((s) => s.session)
  const authLoaded = useAppStore((s) => s.authLoaded)
  const children = useAppStore((s) => s.children)
  const booted = useAppStore((s) => s.booted)
  const hasCachedShell = useAppStore((s) => s.members.length > 0 || s.children.length > 0)

  // Backend is Workers + D1 on same origin (/api/*); no Supabase env gate.

  // Warm start: cached members/children let us paint the shell before network returns.
  if (!authLoaded && hasCachedShell) {
    return (
      <Routes>
        <Route path="/new" element={<Composer standalone />} />
        <Route path="*" element={<Shell warmStart />} />
      </Routes>
    )
  }

  if (!authLoaded) return <Splash />
  if (!session) return <AuthScreen />
  if (!booted && !hasCachedShell) return <Splash hint="小年轮 · 同步数据…" />
  if (children.length === 0) {
    // Still booting with cache empty vs truly no children
    if (!booted) return <Splash hint="小年轮 · 同步数据…" />
    return <Onboarding />
  }

  return (
    <Routes>
      <Route path="/new" element={<Composer standalone />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  )
}
