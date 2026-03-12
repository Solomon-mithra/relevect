import importlib.util
from pathlib import Path

from fastapi.testclient import TestClient
import pytest


HAS_SENTENCE_TRANSFORMERS = importlib.util.find_spec("sentence_transformers") is not None


def test_week1_flow(tmp_path, monkeypatch):
    db_path = tmp_path / "relevect.db"
    monkeypatch.setenv("RELEVECT_DB_PATH", str(db_path))

    data_dir = tmp_path / "docs"
    data_dir.mkdir()
    (data_dir / "notes.md").write_text("# Notes\nhello", encoding="utf-8")
    (data_dir / "readme.txt").write_text("plain text", encoding="utf-8")
    (data_dir / "ignore.bin").write_bytes(b"\x00\x01")

    from api.main import app

    client = TestClient(app)

    # Health endpoint exists.
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    # Register folder.
    create = client.post("/folders", json={"path": str(data_dir)})
    assert create.status_code == 200
    folder_id = create.json()["id"]

    # Duplicate folder is rejected.
    dup = client.post("/folders", json={"path": str(data_dir)})
    assert dup.status_code == 409

    # Scan discovers supported files only.
    scan = client.post("/index/scan", json={"folder_id": folder_id})
    assert scan.status_code == 200
    assert scan.json()["discovered_files"] == 2

    status = client.get("/index/status")
    assert status.status_code == 200
    files = status.json()["files"]
    assert files["total"] == 2
    assert files["discovered"] == 2
    assert files["deleted"] == 0

    # Remove one file and rescan; file should be marked deleted.
    (data_dir / "readme.txt").unlink()
    rescan = client.post("/index/scan", json={"folder_id": folder_id})
    assert rescan.status_code == 200
    assert rescan.json()["marked_deleted_files"] == 1

    status2 = client.get("/index/status")
    assert status2.status_code == 200
    files2 = status2.json()["files"]
    assert files2["deleted"] == 1


def test_week2_manual_indexing_flow(tmp_path, monkeypatch):
    db_path = tmp_path / "relevect.db"
    monkeypatch.setenv("RELEVECT_DB_PATH", str(db_path))

    data_dir = tmp_path / "docs"
    data_dir.mkdir()
    markdown = data_dir / "project.md"
    markdown.write_text(
        "# Vision\nRelevect indexes local files for agents.\n\n"
        "# Plan\nWeek two adds parsing and chunking.\n",
        encoding="utf-8",
    )
    (data_dir / "notes.txt").write_text("plain text file for indexing", encoding="utf-8")

    from api.main import app

    client = TestClient(app)

    create = client.post("/folders", json={"path": str(data_dir)})
    assert create.status_code == 200

    scan = client.post("/index/scan", json={})
    assert scan.status_code == 200
    assert scan.json()["discovered_files"] == 2

    files_before = client.get("/files")
    assert files_before.status_code == 200
    all_files = files_before.json()["files"]
    assert len(all_files) == 2

    markdown_record = next(item for item in all_files if item["file_name"] == "project.md")
    assert markdown_record["status"] == "discovered"
    assert markdown_record["chunk_count"] == 0

    index = client.post("/index/file", json={"file_id": markdown_record["id"]})
    assert index.status_code == 200
    assert index.json()["parser_type"] == "markdown"
    assert index.json()["chunk_count"] >= 1

    files_after = client.get("/files")
    assert files_after.status_code == 200
    indexed_markdown = next(
        item for item in files_after.json()["files"] if item["file_name"] == "project.md"
    )
    assert indexed_markdown["status"] == "indexed"
    assert indexed_markdown["parser_type"] == "markdown"
    assert indexed_markdown["chunk_count"] >= 1

    status = client.get("/index/status")
    assert status.status_code == 200
    counts = status.json()["files"]
    assert counts["indexed"] == 1
    assert counts["chunks"] >= 1


@pytest.mark.skipif(not HAS_SENTENCE_TRANSFORMERS, reason="sentence-transformers not installed")
def test_week3_search_returns_relevant_chunk(tmp_path, monkeypatch):
    db_path = tmp_path / "relevect.db"
    monkeypatch.setenv("RELEVECT_DB_PATH", str(db_path))

    data_dir = tmp_path / "docs"
    data_dir.mkdir()
    (data_dir / "hamlet.md").write_text(
        "# Hamlet\nTo be or not to be, that is the question.\n"
        "Hamlet thinks about life and death.\n",
        encoding="utf-8",
    )
    (data_dir / "macbeth.md").write_text(
        "# Macbeth\nVaulting ambition drives Macbeth toward violence.\n",
        encoding="utf-8",
    )

    from api.main import app

    client = TestClient(app)

    create = client.post("/folders", json={"path": str(data_dir)})
    assert create.status_code == 200

    scan = client.post("/index/scan", json={})
    assert scan.status_code == 200

    files = client.get("/files")
    assert files.status_code == 200
    for file_record in files.json()["files"]:
        index = client.post("/index/file", json={"file_id": file_record["id"]})
        assert index.status_code == 200

    search = client.post(
        "/search",
        json={"query": "life and death question", "top_k": 2, "include_text": True},
    )
    assert search.status_code == 200

    payload = search.json()
    assert "all-MiniLM-L6-v2" in payload["embedding_model"]
    assert len(payload["results"]) >= 1

    top = payload["results"][0]
    assert top["file_name"] == "hamlet.md"
    assert "question" in top["snippet"].lower()
    assert top["score"] > 0
    assert 0.0 <= top["normalized_semantic_score"] <= 1.0
    assert 0.0 <= top["normalized_bm25_score"] <= 1.0
    assert top["metadata"]["heading"] == "Hamlet"


@pytest.mark.skipif(not HAS_SENTENCE_TRANSFORMERS, reason="sentence-transformers not installed")
def test_week3_phrase_query_beats_common_word_noise(tmp_path, monkeypatch):
    db_path = tmp_path / "relevect.db"
    monkeypatch.setenv("RELEVECT_DB_PATH", str(db_path))

    data_dir = tmp_path / "docs"
    data_dir.mkdir()
    (data_dir / "hamlet.md").write_text(
        "# Hamlet\nTo be or not to be, that is the question.\n",
        encoding="utf-8",
    )
    (data_dir / "twelfth-night.md").write_text(
        "# Twelfth Night\nIf music be the food of love, play on.\n"
        "To be merry and not be silent is common in this house.\n",
        encoding="utf-8",
    )

    from api.main import app

    client = TestClient(app)

    assert client.post("/folders", json={"path": str(data_dir)}).status_code == 200
    assert client.post("/index/scan", json={}).status_code == 200

    files = client.get("/files").json()["files"]
    for file_record in files:
        assert client.post("/index/file", json={"file_id": file_record["id"]}).status_code == 200

    response = client.post(
        "/search",
        json={"query": "To be or not to be", "top_k": 2, "include_text": True},
    )
    assert response.status_code == 200

    top = response.json()["results"][0]
    assert top["file_name"] == "hamlet.md"
    assert top["phrase_score"] == 1.0
    assert top["normalized_bm25_score"] >= 0.0


def test_phrase_score_handles_hyphenated_text():
    from core.retrieval import phrase_match_score

    text = "O, sir, I will not be so hard-hearted! I will give out divers schedules."
    assert phrase_match_score("hard hearted", text) == 1.0
    assert phrase_match_score("hard-hearted", text) == 1.0


@pytest.mark.skipif(not HAS_SENTENCE_TRANSFORMERS, reason="sentence-transformers not installed")
def test_week4_scan_marks_changed_files_pending_and_bulk_run_indexes_them(tmp_path, monkeypatch):
    db_path = tmp_path / "relevect.db"
    monkeypatch.setenv("RELEVECT_DB_PATH", str(db_path))

    data_dir = tmp_path / "docs"
    data_dir.mkdir()
    source = data_dir / "project.md"
    source.write_text("# Project\nInitial content for indexing.\n", encoding="utf-8")

    from api.main import app

    client = TestClient(app)

    assert client.post("/folders", json={"path": str(data_dir)}).status_code == 200
    assert client.post("/index/scan", json={}).status_code == 200

    file_record = client.get("/files").json()["files"][0]
    first_index = client.post("/index/file", json={"file_id": file_record["id"]})
    assert first_index.status_code == 200

    source.write_text("# Project\nUpdated content for indexing.\n", encoding="utf-8")
    rescan = client.post("/index/scan", json={})
    assert rescan.status_code == 200

    changed_file = client.get("/files").json()["files"][0]
    assert changed_file["status"] == "pending"

    bulk = client.post("/index/run")
    assert bulk.status_code == 200
    assert bulk.json()["processed"] == 1
    assert bulk.json()["failed"] == 0

    after = client.get("/files").json()["files"][0]
    assert after["status"] == "indexed"

    counts = client.get("/index/status").json()["files"]
    assert counts["pending"] == 0
    assert counts["indexed"] == 1
