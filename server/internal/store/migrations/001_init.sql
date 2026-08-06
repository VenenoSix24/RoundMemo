-- 001_init.sql — 初始内容模型（对应开发文档 §5 数据模型）
-- 两处对文档的修正：
-- 1) 会话与 grant 多对多 → session_grants 关联表，撤销 sessions.group_ids（见 docs/decisions/0001）。
-- 2) 新增 admin_sessions 承载 Owner 管理会话：文档 §12.3 要求可吊销的 Bearer 管理会话，
--    复用访客 sessions 会污染其 group 派生逻辑。

CREATE TABLE owner (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE albums (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  cover_photo_id INTEGER,
  sort_key TEXT NOT NULL DEFAULT 'shot_at',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  shot_at INTEGER,
  gps_lat REAL,
  gps_lng REAL,
  device_make TEXT,
  device_model TEXT,
  title TEXT,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_photos_album ON photos(album_id);
CREATE INDEX idx_photos_shot ON photos(shot_at);

CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE group_albums (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  PRIMARY KEY(group_id, album_id)
);

CREATE TABLE grants (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  numeric_code TEXT NOT NULL UNIQUE,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  session_ttl_days INTEGER NOT NULL DEFAULT 30,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_grants_token ON grants(token);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE session_grants (
  session_id TEXT NOT NULL REFERENCES sessions(sid) ON DELETE CASCADE,
  grant_id INTEGER NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  PRIMARY KEY(session_id, grant_id)
);

CREATE TABLE admin_sessions (
  sid TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE storage_backends (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
