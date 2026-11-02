const KEY = 'mengya-bootstrap-cache-v1'

export interface BootstrapCache {
  members: unknown[]
  children: unknown[]
  savedAt: string
}

export function readBootstrapCache(): BootstrapCache | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BootstrapCache
    if (!Array.isArray(parsed.members) || !Array.isArray(parsed.children)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeBootstrapCache(members: unknown[], children: unknown[]): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ members, children, savedAt: new Date().toISOString() })
    )
  } catch {
    /* quota — ignore */
  }
}

export function clearBootstrapCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
