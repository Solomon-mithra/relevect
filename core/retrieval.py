import math
import re
from collections import Counter


TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.lower())


def normalize_text(text: str) -> str:
    return " ".join(tokenize(text))


def phrase_match_score(query: str, text: str) -> float:
    normalized_query = normalize_text(query)
    normalized_text = normalize_text(text)
    if not normalized_query or not normalized_text:
        return 0.0
    if normalized_query in normalized_text:
        return 1.0
    return 0.0


def lexical_overlap_score(query_tokens: list[str], text_tokens: list[str]) -> float:
    if not query_tokens or not text_tokens:
        return 0.0
    query_counts = Counter(query_tokens)
    text_counts = Counter(text_tokens)
    overlap = sum(min(query_counts[token], text_counts[token]) for token in query_counts)
    return overlap / max(len(query_tokens), 1)


def bm25_score(
    query_tokens: list[str],
    document_tokens: list[str],
    *,
    document_frequency: Counter[str],
    corpus_size: int,
    average_doc_length: float,
    k1: float = 1.5,
    b: float = 0.75,
) -> float:
    if not query_tokens or not document_tokens or corpus_size == 0 or average_doc_length == 0:
        return 0.0

    score = 0.0
    term_counts = Counter(document_tokens)
    doc_len = len(document_tokens)

    for token in query_tokens:
        term_frequency = term_counts[token]
        if term_frequency == 0:
            continue
        df = document_frequency[token]
        idf = math.log(1 + ((corpus_size - df + 0.5) / (df + 0.5)))
        numerator = term_frequency * (k1 + 1)
        denominator = term_frequency + k1 * (1 - b + b * (doc_len / average_doc_length))
        score += idf * (numerator / denominator)

    return score


def normalize_series(values: list[float], *, default: float = 0.0) -> list[float]:
    if not values:
        return []

    minimum = min(values)
    maximum = max(values)
    if math.isclose(minimum, maximum):
        return [default for _ in values]

    scale = maximum - minimum
    return [(value - minimum) / scale for value in values]


def normalize_cosine_scores(values: list[float]) -> list[float]:
    if not values:
        return []

    minimum = min(values)
    maximum = max(values)
    if math.isclose(minimum, maximum):
        return [max(0.0, min(1.0, (value + 1.0) / 2.0)) for value in values]

    return normalize_series(values)
