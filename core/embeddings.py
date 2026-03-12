import os
from functools import lru_cache

from sentence_transformers import SentenceTransformer


DEFAULT_EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


def get_embedding_model_name() -> str:
    return os.getenv("RELEVECT_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL_NAME)


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    return SentenceTransformer(get_embedding_model_name(), local_files_only=True)


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    model = get_model()
    vectors = model.encode(
        texts,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return [vector.tolist() for vector in vectors]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        raise ValueError("Embedding dimensions must match")
    return sum(a * b for a, b in zip(left, right))
