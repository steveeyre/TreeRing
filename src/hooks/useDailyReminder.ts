import { useCallback, useEffect, useRef, useState } from 'react'
import { apiListRows } from '../lib/api'
import { useAppStore, usePrefs } from '../lib/store'

const REMIND_TIME_MIN = 21 * 60 + 15 // 21:15

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function hasEntryToday(): Promise<boolean> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  const rows = await apiListRows<{ id: string }>('entries', {
    isNull: ['deleted_at'],
    gte: { occurred_at: start },
    lt: { occurred_at: end },
    limit: 1
  })
  return rows.length > 0
}

export default function useDailyReminder() {
  const dailyRemind = usePrefs((s) => s.dailyRemind)
  const [show, setShow] = useState(false)
  const checking = useRef(false)

  const check = useCallback(async () => {
    const uid = useAppStore.getState().session?.user.id
    if (!uid || !dailyRemind) return
    if (checking.current) return
    const now = new Date()
    const min = now.getHours() * 60 + now.getMinutes()
    if (min < REMIND_TIME_MIN) return
    const key = `mengya-reminded-${localDateKey(now)}`
    if (localStorage.getItem(key)) return
    checking.current = true
    try {
      const has = await hasEntryToday()
      if (has) {
        localStorage.setItem(key, '1')
        return
      }
      localStorage.setItem(key, '1')
      setShow(true)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification('小年轮', {
            body: '今天还没有记录，要不要记一笔？',
            tag: 'mengya-daily-remind'
          })
          n.onclick = () => window.focus()
        } catch {
          /* 通知仅作锦上添花 */
        }
      }
    } finally {
      checking.current = false
    }
  }, [dailyRemind])

  useEffect(() => {
    check()
    const onFocus = () => void check()
    const onVis = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [check])

  return { show, dismiss: () => setShow(false) }
}
