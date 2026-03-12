# Relevect - Local Context Engine for AI Agents

Week 4 baseline implemented:

- SQLite metadata schema (`folders`, `files`, `index_jobs`, `chunks`)
- FastAPI service startup DB initialization
- Folder registration and listing
- Recursive file discovery for `.pdf`, `.md`, `.txt`
- Scan endpoint with deleted-file marking
- Manual file indexing endpoint
- Parser pipeline for `.txt`, `.md`, and `.pdf`
- Chunk creation with snippets and heading/page metadata
- Local sentence-transformers embeddings for chunks and queries
- Hybrid retrieval endpoint over indexed chunks with normalized semantic and lexical scores
- Pending-file detection after scans
- Bulk indexing pipeline for discovered/changed files
- Index status endpoint with file counters + recent jobs

## Run

```bash
uvicorn api.main:app --reload
```

Default DB path: `./data/relevect.db`

Override with:

```bash
export RELEVECT_DB_PATH=/absolute/path/relevect.db
```

## Current API

- `GET /health`
- `POST /folders`
- `GET /folders`
- `POST /index/scan`
- `POST /index/file`
- `POST /index/run`
- `POST /search`
- `GET /index/status`
- `GET /files`

## Learning notes

- Metadata is intentionally in SQLite first, so behavior is easy to inspect.
- `discover_files()` in `core/discovery.py` is simple and deterministic on purpose.
- `parse_document()` in `core/parser.py` converts file types into a common internal shape.
- `chunk_document()` in `core/chunking.py` turns parsed sections into stable chunk records.
- `core/embeddings.py` now uses a local `sentence-transformers` model (`all-MiniLM-L6-v2` by default).
- `core/retrieval.py` adds BM25-style lexical ranking, exact-phrase boosts, and score normalization so one signal does not dominate purely because of numeric scale.
- `POST /index/run` is the first real pipeline endpoint: it processes all discovered, changed, failed, or model-stale files without manual per-file calls.
- `index_jobs` gives a basic operational trail for scans before we add a queue/watcher.

## Desktop

A Tauri desktop shell is scaffolded in [desktop/README.md](/Users/solomonmithra/Documents/Work/Relevect/desktop/README.md).
