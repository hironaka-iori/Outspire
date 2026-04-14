CREATE TABLE IF NOT EXISTS registrations (
  device_id TEXT PRIMARY KEY,
  push_start_token TEXT NOT NULL,
  sandbox INTEGER NOT NULL DEFAULT 0,
  track TEXT NOT NULL,
  entry_year TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  resume_date TEXT,
  current_activity_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatch_jobs (
  day_key TEXT NOT NULL,
  time TEXT NOT NULL,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  token TEXT NOT NULL,
  sandbox INTEGER NOT NULL DEFAULT 0,
  push_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day_key, time, device_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_slot
ON dispatch_jobs(day_key, time);

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_device_day
ON dispatch_jobs(day_key, device_id);
