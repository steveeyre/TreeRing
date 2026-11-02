export type CategoryKey =
  | 'schedule'
  | 'health'
  | 'habit'
  | 'development'
  | 'learning'
  | 'entertainment'
  | 'event'
  | 'quotes'
  | 'newWords'
  | 'parent'
  | 'other'

export type ParseStatus = 'none' | 'pending' | 'running' | 'done' | 'failed'

export type Status = 'todo' | 'doing' | 'done'

export type ListType = 'book' | 'game' | 'animation' | 'documentary' | 'movie' | 'custom'

export type HealthEventType = 'vaccine' | 'illness' | 'allergy' | 'checkup' | 'tooth'

export interface Member {
  id: string
  user_id: string
  name: string
  emoji: string
  color: string
  sort_order: number
  created_at: string
}

export interface Child {
  id: string
  user_id: string
  name: string
  birth_date: string | null
  gender: string | null
  avatar_color: string
  created_at: string
}

export interface ParsedFacts {
  summary?: string
  sleep?: { start?: string; end?: string; durationMin?: number; bedtimeStory?: string; comfortToy?: string }
  meals?: { type?: string; time?: string; content?: string }[]
  outdoor?: { type?: string; durationMin?: number }
  growth?: { heightCm?: number; weightKg?: number }
  waterMl?: number
  teeth?: string
  books?: { title: string; author?: string }[]
  games?: { title: string; platform?: string }[]
  media?: { title: string; kind?: string }[]
  newWords?: string[]
  quotes?: string[]
  milestones?: { title: string }[]
  illness?: { name?: string; onset?: string; symptoms?: string; medication?: string; recovery?: string }
}

export interface ParsedResult {
  categories: CategoryKey[]
  tags: string[]
  facts: ParsedFacts
}

export interface Entry {
  id: string
  user_id: string
  child_id: string | null
  recorder_id: string | null
  body: string
  categories: CategoryKey[]
  tags: string[]
  occurred_at: string
  created_at: string
  updated_at: string
  parsed: ParsedFacts | null
  parse_status: ParseStatus
  ai_advice: string | null
  audio_path: string | null
  audio_duration_sec: number | null
  deleted_at?: string | null
  content_version?: number
  parsed_version?: number | null
  parse_attempts?: number
  parse_error?: string | null
  parse_token?: string | null
  parse_lease_until?: string | null
  manual_categories?: CategoryKey[] | null
  manual_tags?: string[] | null
  ai_categories?: CategoryKey[] | null
  ai_tags?: string[] | null
}

export interface Milestone {
  id: string
  user_id: string
  child_id: string | null
  title: string
  description: string | null
  age_min_months: number | null
  age_max_months: number | null
  category: string | null
  status: Status
  completed_at: string | null
  note: string | null
  sort_order: number
  created_at: string
}

export interface ListItem {
  id: string
  user_id: string
  child_id: string | null
  list_type: ListType
  title: string
  meta: Record<string, unknown> | null
  status: Status
  source_entry_id: string | null
  created_at: string
  normalized_title?: string | null
  origin?: string | null
}

export interface GrowthRecord {
  id: string
  user_id: string
  child_id: string | null
  measured_at: string
  height_cm: number | null
  weight_kg: number | null
  head_cm: number | null
  created_at: string
  deleted_at?: string | null
  source_entry_id?: string | null
  source_fact_key?: string | null
  manual_override?: boolean
}

export interface HealthEvent {
  id: string
  user_id: string
  child_id: string | null
  event_type: HealthEventType
  title: string
  data: Record<string, unknown> | null
  occurred_at: string | null
  note: string | null
  created_at: string
  deleted_at?: string | null
  source_entry_id?: string | null
  source_fact_key?: string | null
  manual_override?: boolean
}

export interface AIConfig {
  baseUrl: string
  apiKey: string
  chatModel: string
  autoParse: boolean
}