from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from core.chunking import chunk_document
from core.db import (
    count_files,
    create_folder,
    create_index_job,
    finish_index_job,
    get_file_by_id,
    get_file_by_path,
    get_folder_by_path,
    init_db,
    latest_jobs,
    list_files,
    list_files_needing_indexing,
    list_folders,
    mark_missing_files_deleted,
    sync_discovered_file,
    replace_chunks_for_file,
    search_chunks,
    update_file_after_index,
    update_file_failure,
)
from core.discovery import discover_files
from core.embeddings import embed_text, embed_texts, get_embedding_model_name
from core.parser import parse_document


app = FastAPI(title="Relevect API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:1420",
        "http://localhost:1420",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Keep DB initialization eager so the app works in both server mode and tests.
init_db()


@app.on_event("startup")
def startup() -> None:
    init_db()


class FolderCreateRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a local folder")


class ScanRequest(BaseModel):
    folder_id: str | None = Field(
        None,
        description="Optional folder ID. If omitted, scans all active folders.",
    )


class IndexFileRequest(BaseModel):
    file_id: str | None = Field(None, description="Known file ID from the metadata store")
    path: str | None = Field(None, description="Absolute path to a discovered file")


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Text query to search over indexed chunks")
    top_k: int = Field(5, ge=1, le=20)
    include_text: bool = Field(True, description="Include full chunk text in results")
    min_score: float | None = Field(None, description="Optional minimum cosine score")


def _index_file_record(record_id: str) -> dict[str, Any]:
    record = get_file_by_id(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="File not found in metadata store")
    if record.status == "deleted":
        raise HTTPException(status_code=400, detail="Cannot index a deleted file")

    job_id = create_index_job(job_type="index_file", status="running", file_id=record.id)

    try:
        document = parse_document(record.path)
        chunks = chunk_document(document)
        embeddings = embed_texts([str(chunk["text"]) for chunk in chunks])
        model_name = get_embedding_model_name()
        for chunk, embedding in zip(chunks, embeddings):
            chunk["embedding"] = embedding
            chunk["embedding_model"] = model_name
        stored_chunks = replace_chunks_for_file(record.id, chunks)
        update_file_after_index(
            file_id=record.id,
            status="indexed",
            parser_type=document.parser_type,
            content_hash=document.content_hash,
            last_error=None,
        )
        finish_index_job(job_id, status="completed")
        return {
            "job_id": job_id,
            "file_id": record.id,
            "path": record.path,
            "parser_type": document.parser_type,
            "chunk_count": stored_chunks,
            "status": "indexed",
        }
    except Exception as exc:
        update_file_failure(record.id, str(exc))
        finish_index_job(job_id, status="failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Indexing failed: {exc}")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/folders")
def add_folder(req: FolderCreateRequest) -> dict[str, Any]:
    candidate = Path(req.path).expanduser().resolve()

    if not candidate.exists() or not candidate.is_dir():
        raise HTTPException(status_code=400, detail="Path does not exist or is not a directory")

    normalized = str(candidate)
    existing = get_folder_by_path(normalized)
    if existing:
        raise HTTPException(status_code=409, detail="Folder already registered")

    created = create_folder(normalized)
    return {
        "id": created.id,
        "path": created.path,
        "is_active": created.is_active,
        "created_at": created.created_at,
    }


@app.get("/folders")
def get_folders() -> dict[str, Any]:
    items = list_folders(active_only=False)
    return {
        "folders": [
            {
                "id": f.id,
                "path": f.path,
                "is_active": f.is_active,
                "created_at": f.created_at,
                "updated_at": f.updated_at,
            }
            for f in items
        ]
    }


@app.post("/index/scan")
def index_scan(req: ScanRequest) -> dict[str, Any]:
    folders = list_folders(active_only=True)
    if req.folder_id is not None:
        folders = [f for f in folders if f.id == req.folder_id]

    if not folders:
        raise HTTPException(status_code=404, detail="No active folders to scan")

    job_id = create_index_job(job_type="scan", status="running")

    try:
        total_discovered = 0
        total_deleted = 0

        for folder in folders:
            discovered = discover_files(folder.path)
            seen_paths: set[str] = set()

            for item in discovered:
                sync_discovered_file(
                    folder_id=folder.id,
                    path=item.path,
                    file_name=item.file_name,
                    extension=item.extension,
                    size_bytes=item.size_bytes,
                    mtime=item.mtime,
                    status="discovered",
                )
                seen_paths.add(item.path)

            total_discovered += len(discovered)
            total_deleted += mark_missing_files_deleted(folder.id, seen_paths)

        finish_index_job(job_id, status="completed")

        return {
            "job_id": job_id,
            "scanned_folders": len(folders),
            "discovered_files": total_discovered,
            "marked_deleted_files": total_deleted,
        }
    except Exception as exc:  # pragma: no cover - safety catch for API response shape
        finish_index_job(job_id, status="failed", error=str(exc))
        raise HTTPException(status_code=500, detail="Scan failed")


@app.post("/index/file")
def index_file(req: IndexFileRequest) -> dict[str, Any]:
    if not req.file_id and not req.path:
        raise HTTPException(status_code=400, detail="Provide either file_id or path")

    record = get_file_by_id(req.file_id) if req.file_id else None
    if record is None and req.path:
        record = get_file_by_path(str(Path(req.path).expanduser().resolve()))
    if record is None:
        raise HTTPException(status_code=404, detail="File not found in metadata store")
    return _index_file_record(record.id)


@app.post("/index/run")
def index_run() -> dict[str, Any]:
    pending_files = list_files_needing_indexing(get_embedding_model_name())
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for record in pending_files:
        try:
            results.append(_index_file_record(record.id))
        except HTTPException as exc:
            failures.append(
                {
                    "file_id": record.id,
                    "path": record.path,
                    "detail": exc.detail,
                }
            )

    return {
        "processed": len(results),
        "failed": len(failures),
        "results": results,
        "failures": failures,
    }


@app.get("/files")
def get_files() -> dict[str, Any]:
    return {"files": list_files()}


@app.post("/search")
def search(req: SearchRequest) -> dict[str, Any]:
    query_embedding = embed_text(req.query)
    model_name = get_embedding_model_name()
    results = search_chunks(
        req.query,
        query_embedding,
        embedding_model=model_name,
        top_k=req.top_k,
        min_score=req.min_score,
    )

    if not req.include_text:
        results = [
            {
                **result,
                "text": None,
            }
            for result in results
        ]

    return {
        "query": req.query,
        "embedding_model": model_name,
        "results": results,
    }


@app.get("/index/status")
def index_status() -> dict[str, Any]:
    return {
        "files": count_files(),
        "recent_jobs": latest_jobs(limit=10),
    }
