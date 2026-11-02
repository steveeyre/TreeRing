import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ApiSession } from './api'
import type { AIConfig, Child, Member } from './types'
import { DEFAULT_AI_CONFIG } from './constants'

interface AppState {
  session: ApiSession | null
  authLoaded: boolean
  members: Member[]
  children: Child[]
  booted: boolean
  setSession: (s: ApiSession | null) => void
  setAuthLoaded: (b: boolean) => void
  setMembers: (m: Member[]) => void
  setChildren: (c: Child[]) => void
  setBooted: (b: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  session: null,
  authLoaded: false,
  members: [],
  children: [],
  booted: false,
  setSession: (s) => set({ session: s }),
  setAuthLoaded: (b) => set({ authLoaded: b }),
  setMembers: (m) => set({ members: m }),
  setChildren: (c) => set({ children: c }),
  setBooted: (b) => set({ booted: b })
}))

interface PrefsState extends AIConfig {
  currentChildId: string | null
  currentRecorderId: string | null
  dailyRemind: boolean
  lastBackupAt: string | null
  hideShareName: boolean
  setAi: (patch: Partial<AIConfig>) => void
  setCurrentChildId: (id: string | null) => void
  setCurrentRecorderId: (id: string | null) => void
  setDailyRemind: (b: boolean) => void
  setLastBackupAt: (iso: string | null) => void
  setHideShareName: (b: boolean) => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AI_CONFIG,
      currentChildId: null,
      currentRecorderId: null,
      dailyRemind: true,
      lastBackupAt: null,
      hideShareName: false,
      setAi: (patch) => set(patch),
      setCurrentChildId: (id) => set({ currentChildId: id }),
      setCurrentRecorderId: (id) => set({ currentRecorderId: id }),
      setDailyRemind: (b) => set({ dailyRemind: b }),
      setLastBackupAt: (iso) => set({ lastBackupAt: iso }),
      setHideShareName: (b) => set({ hideShareName: b })
    }),
    { name: 'mengya-prefs' }
  )
)

export function getAI(): AIConfig {
  const s = usePrefs.getState()
  return {
    baseUrl: s.baseUrl,
    apiKey: s.apiKey,
    chatModel: s.chatModel,
    autoParse: s.autoParse
  }
}