import { lazy, Suspense } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore, usePrefs } from '../lib/store'
import useDailyReminder from '../hooks/useDailyReminder'
import RingMark from './RingMark'

const TimelinePage = lazy(() => import('../pages/TimelinePage'))
const ArchivePage = lazy(() => import('../pages/ArchivePage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))

const TABS = [
  { to: '/archive', label: '档案' },
  { to: '/', label: '记录' },
  { to: '/settings', label: '设置' }
]

export default function Shell({ warmStart = false }: { warmStart?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const children = useAppStore((s) => s.children)
  const currentChildId = usePrefs((s) => s.currentChildId)
  const setCurrentChildId = usePrefs((s) => s.setCurrentChildId)
  const child = children.find((c) => c.id === currentChildId) ?? children[0]
  const page = location.pathname
  const reminder = useDailyReminder()

  return (
    <div className="relative h-full flex flex-col max-w-md mx-auto safe-top">
      <header className="flex items-center gap-2 px-4 h-14 border-b border-line bg-paper/90 backdrop-blur z-10 shrink-0">
        <RingMark size={21} className="text-brand shrink-0" />
        <span className="serif text-[17px] text-ink leading-none">小年轮</span>
        {warmStart && (
          <span className="flex items-center gap-1 text-[10px] text-muted ml-1">
            <span className="w-1 h-1 rounded-full bg-brass" />
            离线缓存
          </span>
        )}
        {children.length > 1 ? (
          <select
            className="ml-auto h-9 max-w-[6.5rem] truncate rounded-md bg-transparent text-[13px] text-ink/80 outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            value={child?.id ?? ''}
            onChange={(e) => setCurrentChildId(e.target.value || null)}
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="ml-auto text-[13px] text-ink/70 truncate max-w-[8rem]">
            {child?.name ?? ''}
          </span>
        )}
      </header>

      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="py-16 text-center text-sm text-muted">加载中…</div>}>
          {reminder.show && (
            <div className="mx-4 mt-3 rounded-lg border border-brass/30 bg-brass/[0.06] px-3.5 py-3 flex items-center gap-3">
              <span className="serif text-[13px] text-brass shrink-0">提醒</span>
              <p className="flex-1 text-[13px] text-ink leading-relaxed">已经 21:15 了，今天还没有记录哦</p>
              <button
                className="btn-primary text-xs shrink-0"
                onClick={() => {
                  reminder.dismiss()
                  navigate('/new')
                }}
              >
                去记录
              </button>
              <button
                aria-label="关闭提醒"
                className="w-8 h-8 text-muted shrink-0 touch-target"
                onClick={reminder.dismiss}
              >
                ✕
              </button>
            </div>
          )}
          {page === '/' && <TimelinePage />}
          {page === '/archive' && <ArchivePage />}
          {page === '/settings' && <SettingsPage />}
        </Suspense>
      </main>

      <button
        aria-label="新建记录"
        className="absolute right-4 bottom-[5.5rem] w-14 h-14 rounded-full bg-ink text-paper shadow-[0_8px_20px_rgba(38,48,42,0.26)] active:scale-95 transition-transform z-20"
        onClick={() => navigate('/new')}
      >
        <span className="absolute inset-0 flex items-center justify-center text-[26px] font-light leading-none">
          +
        </span>
      </button>

      <nav className="shrink-0 border-t border-line bg-white/95 safe-bottom">
        <div className="grid grid-cols-3 max-w-md mx-auto">
          {TABS.map((t) => {
            const active = page === t.to
            return (
              <button
                key={t.to}
                className="relative h-14 flex items-center justify-center transition-colors"
                onClick={() => navigate(t.to)}
              >
                <span
                  className={`absolute top-0 left-1/2 -translate-x-1/2 h-[2px] bg-brand transition-all ${
                    active ? 'w-7 opacity-100' : 'w-0 opacity-0'
                  }`}
                />
                <span className={`text-[13px] ${active ? 'text-ink font-medium' : 'text-muted'}`}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
