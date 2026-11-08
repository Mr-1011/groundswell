-- Groundswell SQLite schema. Create: sqlite3 db/groundswell.sqlite < db/schema.sql
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
  raw          TEXT -- JSON
);

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
  fips    TEXT PRIMARY KEY, -- 5-digit
  name    TEXT NOT NULL,
  state   TEXT NOT NULL REFERENCES states(code),
  score   REAL CHECK (score BETWEEN 0 AND 1),
  label   TEXT CHECK (label IN ('low', 'medium', 'high')),
  summary TEXT,
  updated TEXT
);

CREATE TABLE IF NOT EXISTS reasons (
  fips   TEXT NOT NULL REFERENCES counties(fips),
  reason TEXT NOT NULL,
  weight REAL NOT NULL
);

-- News, social posts, quotes and facts per county.
CREATE TABLE IF NOT EXISTS items (
  id                INTEGER PRIMARY KEY,
  fips              TEXT NOT NULL REFERENCES counties(fips),
  kind              TEXT NOT NULL CHECK (kind IN ('news', 'social', 'quote', 'fact')),
  url               TEXT NOT NULL,
  title             TEXT, -- news
  text              TEXT, -- social, quote, fact
  source            TEXT, -- news outlet, or quote speaker
  platform          TEXT, -- social
  date              TEXT,
  stance            TEXT CHECK (stance IN ('oppose', 'support', 'neutral')),
  topic             TEXT,
  document_id       INTEGER REFERENCES documents(id),
  extractor_version TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  developer  TEXT,
  fips       TEXT,
  state      TEXT,
  lat        REAL,
  lon        REAL,
  status     TEXT NOT NULL CHECK (status IN ('operating', 'planned', 'approved', 'rejected', 'withdrawn', 'moratorium')),
  size_mw    REAL,
  date       TEXT,
  source_url TEXT NOT NULL
);

-- Learning loop: accuracy per backtest round.
CREATE TABLE IF NOT EXISTS rounds (
  round    INTEGER PRIMARY KEY,
  accuracy REAL NOT NULL,
  n        INTEGER NOT NULL
);
