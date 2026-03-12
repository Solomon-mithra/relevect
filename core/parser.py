import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - depends on local environment
    PdfReader = None


@dataclass(frozen=True)
class ParsedSection:
    text: str
    heading: Optional[str] = None
    page_number: Optional[int] = None


@dataclass(frozen=True)
class ParsedDocument:
    path: str
    file_name: str
    parser_type: str
    raw_text: str
    content_hash: str
    sections: list[ParsedSection]


def _sha256_bytes(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()


def _read_bytes(path: Path) -> bytes:
    return path.read_bytes()


def _parse_txt(path: Path, raw_bytes: bytes) -> ParsedDocument:
    text = raw_bytes.decode("utf-8", errors="replace")
    return ParsedDocument(
        path=str(path),
        file_name=path.name,
        parser_type="text",
        raw_text=text,
        content_hash=_sha256_bytes(raw_bytes),
        sections=[ParsedSection(text=text)],
    )


def _parse_markdown(path: Path, raw_bytes: bytes) -> ParsedDocument:
    text = raw_bytes.decode("utf-8", errors="replace")
    lines = text.splitlines()
    sections: list[ParsedSection] = []
    current_heading: Optional[str] = None
    current_lines: list[str] = []

    def flush_section() -> None:
        nonlocal current_lines
        section_text = "\n".join(current_lines).strip()
        if section_text:
            sections.append(ParsedSection(text=section_text, heading=current_heading))
        current_lines = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            flush_section()
            current_heading = stripped.lstrip("#").strip() or None
            continue
        current_lines.append(line)

    flush_section()

    if not sections:
        sections = [ParsedSection(text=text)]

    return ParsedDocument(
        path=str(path),
        file_name=path.name,
        parser_type="markdown",
        raw_text=text,
        content_hash=_sha256_bytes(raw_bytes),
        sections=sections,
    )


def _parse_pdf(path: Path, raw_bytes: bytes) -> ParsedDocument:
    if PdfReader is None:
        raise RuntimeError("PDF parsing requires pypdf to be installed")

    reader = PdfReader(str(path))
    sections: list[ParsedSection] = []
    all_pages: list[str] = []

    for idx, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if not text:
            continue
        sections.append(ParsedSection(text=text, page_number=idx))
        all_pages.append(f"[Page {idx}]\n{text}")

    return ParsedDocument(
        path=str(path),
        file_name=path.name,
        parser_type="pdf",
        raw_text="\n\n".join(all_pages),
        content_hash=_sha256_bytes(raw_bytes),
        sections=sections,
    )


def parse_document(path_str: str) -> ParsedDocument:
    path = Path(path_str).expanduser().resolve()
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"File does not exist: {path}")

    raw_bytes = _read_bytes(path)
    suffix = path.suffix.lower()

    if suffix == ".txt":
        return _parse_txt(path, raw_bytes)
    if suffix == ".md":
        return _parse_markdown(path, raw_bytes)
    if suffix == ".pdf":
        return _parse_pdf(path, raw_bytes)

    raise ValueError(f"Unsupported file type: {suffix}")
