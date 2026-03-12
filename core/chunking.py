import hashlib
import re
from datetime import datetime, timezone
from typing import Optional

from core.parser import ParsedDocument, ParsedSection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_snippet(text: str, limit: int = 180) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    return compact[:limit]


def _split_words(text: str) -> list[str]:
    return text.split()


def _window_words(words: list[str], chunk_words: int, overlap_words: int) -> list[tuple[int, int]]:
    if not words:
        return []

    windows: list[tuple[int, int]] = []
    start = 0
    step = max(1, chunk_words - overlap_words)

    while start < len(words):
        end = min(len(words), start + chunk_words)
        windows.append((start, end))
        if end == len(words):
            break
        start += step

    return windows


def _make_chunk(
    *,
    file_hash: str,
    chunk_index: int,
    text: str,
    heading: Optional[str],
    page_number: Optional[int],
    start_word: int,
    end_word: int,
) -> dict[str, object]:
    chunk_hash = hashlib.sha256(
        f"{file_hash}:{chunk_index}:{heading}:{page_number}:{text}".encode("utf-8")
    ).hexdigest()
    return {
        "id": chunk_hash,
        "chunk_index": chunk_index,
        "chunk_hash": chunk_hash,
        "text": text,
        "snippet": _normalize_snippet(text),
        "token_count": len(text.split()),
        "page_number": page_number,
        "heading": heading,
        "start_offset": start_word,
        "end_offset": end_word,
        "embedding_model": None,
        "created_at": _now_iso(),
    }


def _chunk_section(
    section: ParsedSection,
    *,
    file_hash: str,
    chunk_index_start: int,
    chunk_words: int,
    overlap_words: int,
) -> list[dict[str, object]]:
    words = _split_words(section.text)
    if not words:
        return []

    chunks: list[dict[str, object]] = []
    windows = _window_words(words, chunk_words=chunk_words, overlap_words=overlap_words)

    for offset, (start_word, end_word) in enumerate(windows):
        text = " ".join(words[start_word:end_word]).strip()
        if not text:
            continue
        chunks.append(
            _make_chunk(
                file_hash=file_hash,
                chunk_index=chunk_index_start + offset,
                text=text,
                heading=section.heading,
                page_number=section.page_number,
                start_word=start_word,
                end_word=end_word,
            )
        )

    return chunks


def chunk_document(
    document: ParsedDocument,
    *,
    chunk_words: int = 220,
    overlap_words: int = 40,
) -> list[dict[str, object]]:
    chunks: list[dict[str, object]] = []
    next_chunk_index = 0

    for section in document.sections:
        section_chunks = _chunk_section(
            section,
            file_hash=document.content_hash,
            chunk_index_start=next_chunk_index,
            chunk_words=chunk_words,
            overlap_words=overlap_words,
        )
        chunks.extend(section_chunks)
        next_chunk_index += len(section_chunks)

    if chunks:
        return chunks

    text = document.raw_text.strip()
    if not text:
        return []

    return [
        _make_chunk(
            file_hash=document.content_hash,
            chunk_index=0,
            text=text,
            heading=None,
            page_number=None,
            start_word=0,
            end_word=len(text.split()),
        )
    ]
