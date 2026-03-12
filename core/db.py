import os
import json
import sqlite3
import uuid
from collections.abc import Sequence
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from core.embeddings import cosine_similarity
from core.retrieval import (
    bm25_score,
    lexical_overlap_score,
    normalize_cosine_scores,
    normalize_series,
    phrase_match_score,
    tokenize,
)


DEFAULT_DB_PATH = "./data/relevect.db"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db_path() -> str:
    return os.getenv("RELEVECT_DB_PATH", DEFAULT_DB_PATH)


def _ensure_parent_dir(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    table_row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='folders'"
    ).fetchone()
    if table_row is not None:
        _run_migrations(conn)
        return

    schema_path = Path(__file__).with_name("schema.sql")
    conn.executescript(schema_path.read_text(encoding="utf-8"))
    _run_migrations(conn)


@contextmanager
def get_conn() -> Iterable[sqlite3.Connection]:
    db_path = get_db_path()
    _ensure_parent_dir(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_schema(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        _ensure_schema(conn)


def _column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row["name"] == column_name for row in rows)


def _run_migrations(conn: sqlite3.Connection) -> None:
    # Older Week 2 databases do not have the embedding column yet.
    if not _column_exists(conn, "chunks", "embedding"):
        conn.execute("ALTER TABLE chunks ADD COLUMN embedding TEXT")


@dataclass(frozen=True)
class Folder:
    id: str
    path: str
    is_active: bool
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class FileRecord:
    id: str
    folder_id: str
    path: str
    file_name: str
    extension: str
    size_bytes: int
    mtime: float
    content_hash: Optional[str]
    parser_type: Optional[str]
    status: str
    last_indexed_at: Optional[str]
    last_error: Optional[str]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class FileSyncResult:
    file_id: str
    status: str
    was_new: bool
    needs_indexing: bool


def _row_to_folder(row: sqlite3.Row) -> Folder:
    return Folder(
        id=row["id"],
        path=row["path"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_file(row: sqlite3.Row) -> FileRecord:
    return FileRecord(
        id=row["id"],
        folder_id=row["folder_id"],
        path=row["path"],
        file_name=row["file_name"],
        extension=row["extension"],
        size_bytes=int(row["size_bytes"]),
        mtime=float(row["mtime"]),
        content_hash=row["content_hash"],
        parser_type=row["parser_type"],
        status=row["status"],
        last_indexed_at=row["last_indexed_at"],
        last_error=row["last_error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def create_folder(path: str) -> Folder:
    ts = now_iso()
    folder_id = str(uuid.uuid4())

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO folders (id, path, is_active, created_at, updated_at)
            VALUES (?, ?, 1, ?, ?)
            """,
            (folder_id, path, ts, ts),
        )
        row = conn.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()

    return _row_to_folder(row)


def get_folder_by_path(path: str) -> Optional[Folder]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM folders WHERE path = ?", (path,)).fetchone()
    return _row_to_folder(row) if row else None


def list_folders(active_only: bool = False) -> list[Folder]:
    sql = "SELECT * FROM folders"
    params: tuple[object, ...] = ()
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY created_at ASC"

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    return [_row_to_folder(r) for r in rows]


def get_file_by_id(file_id: str) -> Optional[FileRecord]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    return _row_to_file(row) if row else None


def get_file_by_path(path: str) -> Optional[FileRecord]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM files WHERE path = ?", (path,)).fetchone()
    return _row_to_file(row) if row else None


def list_files() -> list[dict[str, object]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                f.id,
                f.folder_id,
                f.path,
                f.file_name,
                f.extension,
                f.size_bytes,
                f.mtime,
                f.status,
                f.parser_type,
                f.content_hash,
                f.last_indexed_at,
                f.last_error,
                COUNT(c.id) AS chunk_count,
                MIN(c.embedding_model) AS embedding_model
            FROM files f
            LEFT JOIN chunks c ON c.file_id = f.id
            GROUP BY f.id
            ORDER BY f.created_at ASC
            """
        ).fetchall()

    return [dict(r) for r in rows]


def sync_discovered_file(
    *,
    folder_id: str,
    path: str,
    file_name: str,
    extension: str,
    size_bytes: int,
    mtime: float,
    status: str = "discovered",
) -> FileSyncResult:
    ts = now_iso()

    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM files WHERE path = ?", (path,)).fetchone()

        if existing is None:
            file_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO files (
                    id, folder_id, path, file_name, extension, size_bytes, mtime,
                    status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    file_id,
                    folder_id,
                    path,
                    file_name,
                    extension,
                    size_bytes,
                    mtime,
                    status,
                    ts,
                    ts,
                ),
            )
            return FileSyncResult(
                file_id=file_id,
                status=status,
                was_new=True,
                needs_indexing=True,
            )

        existing_status = existing["status"]
        existing_size = int(existing["size_bytes"])
        existing_mtime = float(existing["mtime"])
        changed = (existing_size != size_bytes) or (existing_mtime != mtime)

        if existing_status == "deleted":
            next_status = "discovered"
            needs_indexing = True
        elif changed and existing_status == "indexed":
            next_status = "pending"
            needs_indexing = True
        elif changed:
            next_status = "discovered"
            needs_indexing = True
        else:
            next_status = existing_status
            needs_indexing = existing_status in {"discovered", "pending", "failed"}

        conn.execute(
            """
            UPDATE files
            SET
                folder_id = ?,
                file_name = ?,
                extension = ?,
                size_bytes = ?,
                mtime = ?,
                status = ?,
                updated_at = ?
            WHERE path = ?
            """,
            (
                folder_id,
                file_name,
                extension,
                size_bytes,
                mtime,
                next_status,
                ts,
                path,
            ),
        )

        return FileSyncResult(
            file_id=existing["id"],
            status=next_status,
            was_new=False,
            needs_indexing=needs_indexing,
        )


def upsert_file(
    *,
    folder_id: str,
    path: str,
    file_name: str,
    extension: str,
    size_bytes: int,
    mtime: float,
    status: str = "discovered",
) -> None:
    sync_discovered_file(
        folder_id=folder_id,
        path=path,
        file_name=file_name,
        extension=extension,
        size_bytes=size_bytes,
        mtime=mtime,
        status=status,
    )


def update_file_after_index(
    *,
    file_id: str,
    status: str,
    parser_type: Optional[str] = None,
    content_hash: Optional[str] = None,
    last_error: Optional[str] = None,
) -> None:
    ts = now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE files
            SET
                status = ?,
                parser_type = ?,
                content_hash = ?,
                last_indexed_at = ?,
                last_error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (status, parser_type, content_hash, ts, last_error, ts, file_id),
        )


def update_file_failure(file_id: str, error: str) -> None:
    ts = now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE files
            SET status = 'failed', last_error = ?, updated_at = ?
            WHERE id = ?
            """,
            (error, ts, file_id),
        )


def mark_missing_files_deleted(folder_id: str, seen_paths: set[str]) -> int:
    ts = now_iso()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT path FROM files WHERE folder_id = ? AND status != 'deleted'",
            (folder_id,),
        ).fetchall()
        existing_paths = {r["path"] for r in rows}
        deleted = existing_paths - seen_paths
        for p in deleted:
            conn.execute(
                "UPDATE files SET status='deleted', updated_at=? WHERE folder_id=? AND path=?",
                (ts, folder_id, p),
            )
    return len(deleted)


def count_files() -> dict[str, int]:
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM files").fetchone()["c"]
        discovered = conn.execute(
            "SELECT COUNT(*) AS c FROM files WHERE status = 'discovered'"
        ).fetchone()["c"]
        pending = conn.execute(
            "SELECT COUNT(*) AS c FROM files WHERE status = 'pending'"
        ).fetchone()["c"]
        indexed = conn.execute(
            "SELECT COUNT(*) AS c FROM files WHERE status = 'indexed'"
        ).fetchone()["c"]
        failed = conn.execute(
            "SELECT COUNT(*) AS c FROM files WHERE status = 'failed'"
        ).fetchone()["c"]
        deleted = conn.execute(
            "SELECT COUNT(*) AS c FROM files WHERE status = 'deleted'"
        ).fetchone()["c"]
        chunks = conn.execute("SELECT COUNT(*) AS c FROM chunks").fetchone()["c"]
    return {
        "total": int(total),
        "discovered": int(discovered),
        "pending": int(pending),
        "indexed": int(indexed),
        "failed": int(failed),
        "deleted": int(deleted),
        "chunks": int(chunks),
    }


def create_index_job(job_type: str, status: str, file_id: Optional[str] = None) -> str:
    job_id = str(uuid.uuid4())
    ts = now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO index_jobs (id, file_id, job_type, status, started_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (job_id, file_id, job_type, status, ts, ts),
        )
    return job_id


def finish_index_job(job_id: str, status: str, error: Optional[str] = None) -> None:
    ts = now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE index_jobs
            SET status = ?, finished_at = ?, error = ?
            WHERE id = ?
            """,
            (status, ts, error, job_id),
        )


def latest_jobs(limit: int = 10) -> list[dict[str, object]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, file_id, job_type, status, started_at, finished_at, error
            FROM index_jobs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [dict(r) for r in rows]


def list_files_needing_indexing(embedding_model: str) -> list[FileRecord]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT f.*
            FROM files f
            WHERE
                f.status IN ('discovered', 'pending', 'failed')
                OR (
                    f.status = 'indexed'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM chunks c
                        WHERE c.file_id = f.id AND c.embedding_model = ?
                    )
                )
            ORDER BY f.created_at ASC
            """,
            (embedding_model,),
        ).fetchall()
    return [_row_to_file(row) for row in rows]


def replace_chunks_for_file(
    file_id: str,
    chunks: Sequence[dict[str, object]],
) -> int:
    with get_conn() as conn:
        conn.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
        for chunk in chunks:
            conn.execute(
                """
                INSERT INTO chunks (
                    id, file_id, chunk_index, chunk_hash, text, snippet, token_count,
                    page_number, heading, start_offset, end_offset, embedding, embedding_model,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk["id"],
                    file_id,
                    chunk["chunk_index"],
                    chunk["chunk_hash"],
                    chunk["text"],
                    chunk["snippet"],
                    chunk["token_count"],
                    chunk["page_number"],
                    chunk["heading"],
                    chunk["start_offset"],
                    chunk["end_offset"],
                    json.dumps(chunk["embedding"]),
                    chunk["embedding_model"],
                    chunk["created_at"],
                ),
            )
    return len(chunks)


def search_chunks(
    query_text: str,
    query_embedding: list[float],
    *,
    embedding_model: str,
    top_k: int = 5,
    min_score: float | None = None,
) -> list[dict[str, object]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                c.id AS chunk_id,
                c.file_id,
                f.path,
                f.file_name,
                c.text,
                c.snippet,
                c.chunk_index,
                c.page_number,
                c.heading,
                f.last_indexed_at,
                c.embedding_model,
                c.embedding
            FROM chunks c
            JOIN files f ON f.id = c.file_id
            WHERE
                f.status = 'indexed'
                AND c.embedding IS NOT NULL
                AND c.embedding_model = ?
            """
            ,
            (embedding_model,),
        ).fetchall()

    query_tokens = tokenize(query_text)
    corpus_tokens: list[list[str]] = []
    document_frequency: Counter[str] = Counter()

    for row in rows:
        tokens = tokenize(row["text"])
        corpus_tokens.append(tokens)
        document_frequency.update(set(tokens))

    average_doc_length = (
        sum(len(tokens) for tokens in corpus_tokens) / len(corpus_tokens) if corpus_tokens else 0.0
    )

    raw_candidates: list[dict[str, object]] = []
    for row, text_tokens in zip(rows, corpus_tokens):
        embedding = json.loads(row["embedding"])
        semantic_score = cosine_similarity(query_embedding, embedding)
        bm25 = bm25_score(
            query_tokens,
            text_tokens,
            document_frequency=document_frequency,
            corpus_size=len(corpus_tokens),
            average_doc_length=average_doc_length,
        )
        overlap = lexical_overlap_score(query_tokens, text_tokens)
        phrase = phrase_match_score(query_text, row["text"])
        raw_candidates.append(
            {
                "chunk_id": row["chunk_id"],
                "file_id": row["file_id"],
                "path": row["path"],
                "file_name": row["file_name"],
                "semantic_score": semantic_score,
                "bm25_score": bm25,
                "overlap_score": overlap,
                "phrase_score": phrase,
                "snippet": row["snippet"],
                "text": row["text"],
                "metadata": {
                    "chunk_index": row["chunk_index"],
                    "page": row["page_number"],
                    "heading": row["heading"],
                    "last_indexed_at": row["last_indexed_at"],
                },
            }
        )

    normalized_semantic = normalize_cosine_scores(
        [candidate["semantic_score"] for candidate in raw_candidates]
    )
    normalized_bm25 = normalize_series([candidate["bm25_score"] for candidate in raw_candidates])

    scored: list[dict[str, object]] = []
    for candidate, semantic_norm, bm25_norm in zip(
        raw_candidates, normalized_semantic, normalized_bm25
    ):
        score = (
            (semantic_norm * 0.5)
            + (bm25_norm * 0.3)
            + (candidate["overlap_score"] * 0.1)
            + (candidate["phrase_score"] * 0.1)
        )
        if min_score is not None and score < min_score:
            continue
        candidate["normalized_semantic_score"] = semantic_norm
        candidate["normalized_bm25_score"] = bm25_norm
        candidate["score"] = score
        scored.append(candidate)

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:top_k]
