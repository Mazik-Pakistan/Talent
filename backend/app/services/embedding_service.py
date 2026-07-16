"""BGE-M3 embeddings — generated now (Phase 2) only for resumes, so Phase 3's
AI matching/search can consume them without re-processing every document.

This is intentionally narrow in scope for Phase 2: we do NOT build search or
matching here, we only produce and store the vector alongside the resume
document. Disabled by default (settings.ENABLE_EMBEDDINGS) since it pulls in
a large model download the first time it runs.

Install:
    pip install FlagEmbedding
"""

from __future__ import annotations

import threading

from app.core.config import settings

_MODEL_LOCK = threading.Lock()
_MODEL = None
_MODEL_IMPORT_ERROR: str | None = None


def _get_model():
    global _MODEL, _MODEL_IMPORT_ERROR
    if _MODEL is not None or _MODEL_IMPORT_ERROR is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None or _MODEL_IMPORT_ERROR is not None:
            return _MODEL
        try:
            from FlagEmbedding import BGEM3FlagModel  # noqa: PLC0415

            _MODEL = BGEM3FlagModel(settings.EMBEDDING_MODEL, use_fp16=True)
        except Exception as exc:  # pragma: no cover - depends on optional install
            _MODEL_IMPORT_ERROR = str(exc)
            _MODEL = None
    return _MODEL


def embeddings_available() -> bool:
    return settings.ENABLE_EMBEDDINGS and _get_model() is not None


async def generate_embedding(text: str) -> dict | None:
    """Returns {"vector": [...], "model": "BAAI/bge-m3", "dim": N} or None if disabled/unavailable."""
    if not settings.ENABLE_EMBEDDINGS or not text or not text.strip():
        return None

    import asyncio

    def _run() -> dict | None:
        model = _get_model()
        if model is None:
            return None
        try:
            output = model.encode([text], return_dense=True, return_sparse=False, return_colbert_vecs=False)
            dense_vec = output["dense_vecs"][0]
            vector = dense_vec.tolist() if hasattr(dense_vec, "tolist") else list(dense_vec)
            return {"vector": vector, "model": settings.EMBEDDING_MODEL, "dim": len(vector)}
        except Exception:
            return None

    return await asyncio.to_thread(_run)
