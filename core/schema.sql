PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  extension TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime REAL NOT NULL,
  content_hash TEXT,
  parser_type TEXT,
  status TEXT NOT NULL,
  last_indexed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_hash TEXT,
  text TEXT NOT NULL,
  snippet TEXT,
  token_count INTEGER,
  page_number INTEGER,
  heading TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  embedding TEXT,
  embedding_model TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);

CREATE TABLE IF NOT EXISTS index_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_percent REAL NOT NULL DEFAULT 0,
  current_stage TEXT,
  detail TEXT,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON index_jobs(status);
