-- Mengya on Cloudflare D1 — auth + business tables
-- Apply: wrangler d1 execute mengya-db --file=workers/schema.sql --remote
-- Old Supabase project is gone (NXDOMAIN); this schema is the new source of truth.
-- Auth model: single shared account (email+password), Bearer token sessions.
-- No PRAGMA here: D1 rejects journal_mode changes (SQLITE_AUTH) and manages journaling itself.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#E60012',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS members_user_idx ON members (user_id);

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '宝宝',
  birth_date TEXT,
  gender TEXT,
  avatar_color TEXT NOT NULL DEFAULT '#F5B800',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS children_user_idx ON children (user_id);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id TEXT REFERENCES children (id) ON DELETE SET NULL,
  recorder_id TEXT REFERENCES members (id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  manual_categories TEXT NOT NULL DEFAULT '[]',
  manual_tags TEXT NOT NULL DEFAULT '[]',
  ai_categories TEXT NOT NULL DEFAULT '[]',
  ai_tags TEXT NOT NULL DEFAULT '[]',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  parsed TEXT,
  parse_status TEXT NOT NULL DEFAULT 'none',
  parse_attempts INTEGER NOT NULL DEFAULT 0,
  parse_token TEXT,
  parse_lease_until TEXT,
  parse_error TEXT,
  parsed_version INTEGER,
  content_version INTEGER NOT NULL DEFAULT 1,
  ai_advice TEXT,
  transcript TEXT,
  audio_path TEXT,
  audio_duration_sec REAL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS entries_user_idx ON entries (user_id);
CREATE INDEX IF NOT EXISTS entries_occurred_idx ON entries (user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id TEXT REFERENCES children (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  age_min_months INTEGER,
  age_max_months INTEGER,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  completed_at TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS milestones_user_idx ON milestones (user_id);

CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id TEXT REFERENCES children (id) ON DELETE SET NULL,
  list_type TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT,
  origin TEXT,
  meta TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  source_entry_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS list_items_user_idx ON list_items (user_id);

CREATE TABLE IF NOT EXISTS growth_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id TEXT REFERENCES children (id) ON DELETE SET NULL,
  measured_at TEXT NOT NULL,
  height_cm REAL,
  weight_kg REAL,
  head_cm REAL,
  source_entry_id TEXT,
  source_fact_key TEXT,
  manual_override INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS growth_user_idx ON growth_records (user_id);

CREATE TABLE IF NOT EXISTS health_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id TEXT REFERENCES children (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT,
  occurred_at TEXT,
  note TEXT,
  source_entry_id TEXT,
  source_fact_key TEXT,
  manual_override INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS health_events_user_idx ON health_events (user_id);
