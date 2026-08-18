const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, "app.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Recruiter',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  jd TEXT NOT NULL,              -- JSON blob: structured JD
  weights TEXT NOT NULL,         -- JSON blob: scoring weights
  export_columns TEXT NOT NULL,  -- JSON blob: array of column keys
  screening_rules TEXT NOT NULL DEFAULT '{}', -- JSON blob: job-hopper / seniority rule config
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  linkedin_url TEXT,
  resume_filename TEXT,
  resume_text TEXT,
  linkedin_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  ai TEXT,                        -- JSON blob: full AI evaluation result
  qa_score REAL,
  qa_recommendation TEXT,
  qa_comments TEXT,
  qa_status TEXT NOT NULL DEFAULT 'Not Reviewed',
  qa_history TEXT NOT NULL DEFAULT '[]',  -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_candidates_project ON candidates(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_candidate ON notes(candidate_id);
`);

module.exports = db;
