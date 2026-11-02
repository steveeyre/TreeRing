const pad = (n: number) => String(n).padStart(2, '0')

export function relTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24 && d.getDate() === new Date().getDate()) return `${hr} 小时前`
  return fmtDateTime(iso)
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameYear = d.getFullYear() === now.getFullYear()
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return `${sameYear ? '' : d.getFullYear() + '年'}${md} ${hm}`
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtDuration(min: number): string {
  if (!min) return '0 分钟'
  if (min < 60) return `${Math.round(min)} 分钟`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

export function ageInMonths(birthDate: string | null, now: Date = new Date()): number | null {
  if (!birthDate) return null
  const b = new Date(birthDate)
  if (isNaN(b.getTime())) return null
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months--
  return Math.max(0, months)
}

export function ageLabel(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} 个月`
  if (m === 0) return `${y} 岁`
  return `${y} 岁 ${m} 个月`
}

export function milestoneAgeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return '不限'
  if (min != null && max != null) return `${ageLabel(min)}–${ageLabel(max)}`
  if (min != null) return `${ageLabel(min)}+`
  return `≤ ${ageLabel(max as number)}`
}

export function clampText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}