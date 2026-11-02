import type { CategoryKey, HealthEventType, ListType } from './types'

export interface CategoryMeta {
  key: CategoryKey
  label: string
  emoji: string
  color: string
}

export const CATEGORIES: CategoryMeta[] = [
  { key: 'schedule', label: '日程', emoji: '🕐', color: '#E0A500' },
  { key: 'health', label: '健康', emoji: '🩺', color: '#2FA36B' },
  { key: 'habit', label: '习惯', emoji: '🔁', color: '#6E7BF2' },
  { key: 'development', label: '能力发展', emoji: '🌱', color: '#D9534F' },
  { key: 'learning', label: '学习', emoji: '📚', color: '#E07B39' },
  { key: 'entertainment', label: '玩乐', emoji: '🧸', color: '#9C6ADE' },
  { key: 'event', label: '大事记', emoji: '🎉', color: '#C14679' },
  { key: 'quotes', label: '语录', emoji: '💬', color: '#3F9C8F' },
  { key: 'newWords', label: '新词', emoji: '🗣', color: '#C77D3E' },
  { key: 'other', label: '其他', emoji: '📌', color: '#8A8F98' },
  { key: 'parent', label: '家长专区', emoji: '🧭', color: '#4A90E2' }
]

export const CATEGORY_MAP: Record<string, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c])
)

export const LIST_TYPE_LABELS: Record<ListType, string> = {
  book: '童书',
  game: '游戏',
  animation: '动画',
  documentary: '纪录片',
  movie: '电影',
  custom: '清单'
}

export const HEALTH_EVENT_LABELS: Record<HealthEventType, string> = {
  vaccine: '疫苗',
  illness: '生病',
  allergy: '过敏',
  checkup: '体检',
  tooth: '牙齿'
}

export const STATUS_LABELS: Record<string, string> = {
  todo: '未开始',
  doing: '进行中',
  done: '已完成'
}

export const APP_NAME = '小年轮'

export const DEFAULT_AI_CONFIG = {
  baseUrl: (import.meta.env.VITE_OPENAI_BASE_URL as string) || 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: (import.meta.env.VITE_CHAT_MODEL as string) || 'gpt-4o-mini',
  autoParse: true
}