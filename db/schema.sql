-- Groundswell SQLite schema. Created on first use by agent/db/client.ts (idempotent), or: sqlite3 db/groundswell.sqlite < db/schema.sql
-- Rule: nothing without a source. Every content row carries a URL.
PRAGMA foreign_keys = ON;

-- Raw documents, same shape every source adapter returns (agent/sources/types.ts).
CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY,
  url          TEXT NOT NULL UNIQUE,
  title        TEXT,
  text         TEXT,
  published_at TEXT,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  platform     TEXT NOT NULL,
  region_fips  TEXT,
  source       TEXT,              -- adapter name
  query        TEXT,              -- search query that found it
  extracted_at TEXT,
  raw          TEXT -- JSON
);
CREATE INDEX IF NOT EXISTS documents_region ON documents(region_fips);

CREATE TABLE IF NOT EXISTS states (
  code             TEXT PRIMARY KEY, -- 2-letter
  name             TEXT NOT NULL,
  score            REAL CHECK (score BETWEEN 0 AND 1),
  moratoria        INTEGER NOT NULL DEFAULT 0,
  top_reasons      TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  midterm_2026     TEXT,
  pres_2024_margin REAL, -- R minus D, percentage points
  summary          TEXT
);

CREATE TABLE IF NOT EXISTS counties (
  fips       TEXT PRIMARY KEY, -- 5-digit
  name       TEXT NOT NULL,
  state      TEXT NOT NULL REFERENCES states(code),
  score      REAL CHECK (score BETWEEN 0 AND 1),
  label      TEXT CHECK (label IN ('low', 'medium', 'high')),
  summary    TEXT,
  prediction TEXT CHECK (prediction IN ('blocked', 'approved')),
  confidence REAL,
  basis      TEXT CHECK (basis IN ('evidence', 'predicted', 'baseline')), -- predicted: no local sources, score from the nearest evidence-scored counties
  predicted_from TEXT NOT NULL DEFAULT '[]', -- JSON array of county fips the prediction leans on, most influential first
  updated    TEXT
);

CREATE TABLE IF NOT EXISTS reasons (
  fips   TEXT NOT NULL REFERENCES counties(fips),
  reason TEXT NOT NULL,
  weight REAL NOT NULL
);

-- News, social posts, quotes, facts and groups. fips is NULL for state-level items.
CREATE TABLE IF NOT EXISTS items (
  id                INTEGER PRIMARY KEY,
  fips              TEXT REFERENCES counties(fips),
  state             TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('news', 'social', 'quote', 'fact', 'group')),
  url               TEXT NOT NULL,
  title             TEXT, -- news
  text              TEXT, -- social, quote, fact, group
  source            TEXT, -- news outlet, or quote speaker
  platform          TEXT, -- social
  date              TEXT,
  stance            TEXT CHECK (stance IN ('oppose', 'support', 'neutral')),
  topic             TEXT,
  emotion           TEXT, -- dominant emotion of the community voice: anger, fear, distrust, frustration, sadness, hope, pride, none
  document_id       INTEGER REFERENCES documents(id),
  extractor_version TEXT
);
CREATE INDEX IF NOT EXISTS items_fips ON items(fips);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  developer   TEXT,
  fips        TEXT,
  state       TEXT,
  lat         REAL,
  lon         REAL,
  geo_precision TEXT CHECK (geo_precision IN ('address', 'road', 'place')), -- how exact lat/lon is; place = town or community centroid
  status      TEXT NOT NULL CHECK (status IN ('operating', 'planned', 'approved', 'rejected', 'withdrawn', 'moratorium')),
  size_mw     REAL,
  acres       REAL,
  date        TEXT,
  vote        TEXT,
  notes       TEXT,
  source_url  TEXT NOT NULL,
  document_id INTEGER REFERENCES documents(id)
);
CREATE INDEX IF NOT EXISTS projects_fips ON projects(fips);

-- Planner task queue (agent/tools/tasks.ts).
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('state-scan', 'county', 'case-research')),
  region_fips TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  note        TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created     TEXT NOT NULL DEFAULT (datetime('now')),
  updated     TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);

-- Learning loop: one prediction per case per round (agent/loop/backtest.ts).
CREATE TABLE IF NOT EXISTS predictions (
  round            INTEGER NOT NULL,
  case_id          TEXT NOT NULL,
  split            TEXT NOT NULL CHECK (split IN ('train', 'holdout')),
  predicted_blocked INTEGER NOT NULL,
  actual_blocked   INTEGER NOT NULL,
  confidence       REAL,
  score            REAL,
  summary          TEXT,
  correct          INTEGER NOT NULL,
  PRIMARY KEY (round, case_id)
);

-- Self-improvement: communication patterns (hashtags, phrases, emotional frames) found in one county's posts and
-- quotes; researchers check them in the counties researched afterwards (agent/tools/trends.ts).
CREATE TABLE IF NOT EXISTS trends (
  id          INTEGER PRIMARY KEY,
  pattern     TEXT NOT NULL UNIQUE, -- lower-case
  kind        TEXT NOT NULL CHECK (kind IN ('hashtag', 'phrase', 'frame')),
  emotion     TEXT,
  description TEXT,
  example_url TEXT NOT NULL,
  regions     TEXT NOT NULL DEFAULT '[]', -- JSON array of county FIPS where it was seen
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  updated     TEXT
);

-- Learning loop: accuracy per backtest round on the held-out cases.
CREATE TABLE IF NOT EXISTS rounds (
  round          INTEGER PRIMARY KEY,
  accuracy       REAL NOT NULL,
  n              INTEGER NOT NULL,
  train_accuracy REAL
);
