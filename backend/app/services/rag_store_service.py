"""Phase 4 — AI Coach / AI Assistant retrieval layer (RAG).

Storage: MongoDB collection `kb_chunks`. No external vector DB is required —
this is intentional for the current scale of the product:

  - If `settings.ENABLE_EMBEDDINGS` is on and the BGE-M3 model loads (see
    embedding_service.py), every chunk gets a dense vector at ingest time and
    queries are answered with real cosine-similarity search (brute-force over
    the *role/owner-scoped* candidate set, which is small — tens to low
    thousands of chunks per scope, not the whole corpus).
  - If embeddings are disabled/unavailable, we fall back to MongoDB's native
    text index ($text search, BM25-like ranking). The system keeps working,
    just with lexical instead of semantic retrieval.

Swapping in a dedicated vector store (pgvector / Qdrant / Milvus) later only
means replacing `_vector_search` below — the ingestion schema and the rest of
the RAG pipeline (guardrails, prompt assembly) do not need to change.

Every chunk is tagged with:
  - namespace:   what kind of content it is ("policy", "role_ladder",
                 "profile", "course_note")
  - role_scope:  which roles are allowed to retrieve it, e.g. ["employee"],
                 ["recruiter"], or ["employee", "recruiter"]
  - owner_id:    set only for personal content (an employee's own resume /
                 skills / certificates) so it is never retrievable by anyone
                 else, including recruiters, through this pipeline.

This owner/role scoping is enforced in the MongoDB query itself (not just in
the prompt), so a retrieval bug can't leak another person's or role's data
into context.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

from app.core.config import settings
from app.core.database import database
from app.services.embedding_service import embeddings_available, generate_embedding


def chunk_text(text: str, *, chunk_chars: int | None = None, overlap: int | None = None) -> list[str]:
    """Simple char-window chunker with overlap. Splits on paragraph/sentence
    boundaries where possible so chunks stay coherent for retrieval."""
    text = (text or "").strip()
    if not text:
        return []
    size = chunk_chars or settings.RAG_CHUNK_CHARS
    overlap = overlap if overlap is not None else settings.RAG_CHUNK_OVERLAP
    if len(text) <= size:
        return [text]

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text]

    chunks: list[str] = []
    buf = ""
    for para in paragraphs:
        if len(buf) + len(para) + 2 <= size:
            buf = f"{buf}\n\n{para}" if buf else para
            continue
        if buf:
            chunks.append(buf)
        if len(para) <= size:
            buf = para
        else:
            # paragraph itself too long — hard-slice with overlap
            start = 0
            while start < len(para):
                end = start + size
                chunks.append(para[start:end])
                start = end - overlap if end - overlap > start else end
            buf = ""
    if buf:
        chunks.append(buf)
    return chunks


async def upsert_chunks(
    *,
    namespace: str,
    role_scope: list[str],
    source: str,
    title: str,
    text: str,
    owner_id: str | None = None,
    metadata: dict | None = None,
) -> int:
    """Chunk + embed (if available) + store. Replaces any prior chunks with
    the same (namespace, owner_id, title) so re-ingesting updates in place."""
    now = datetime.now(UTC)
    await database.kb_chunks.delete_many(
        {"namespace": namespace, "owner_id": owner_id, "title": title}
    )
    pieces = chunk_text(text)
    docs: list[dict[str, Any]] = []
    for idx, piece in enumerate(pieces):
        embedding = None
        model_name = None
        if embeddings_available():
            result = await generate_embedding(piece)
            if result:
                embedding = result["vector"]
                model_name = result["model"]
        docs.append(
            {
                "namespace": namespace,
                "role_scope": role_scope,
                "owner_id": owner_id,
                "source": source,
                "title": title,
                "chunk_index": idx,
                "text": piece,
                "embedding": embedding,
                "embedding_model": model_name,
                "metadata": metadata or {},
                "created_at": now,
                "updated_at": now,
            }
        )
    if docs:
        await database.kb_chunks.insert_many(docs)
    return len(docs)


async def delete_namespace_for_owner(namespace: str, owner_id: str) -> None:
    await database.kb_chunks.delete_many({"namespace": namespace, "owner_id": owner_id})


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _scope_filter(*, role: str, owner_id: str | None, namespaces: list[str] | None) -> dict:
    """A single query filter that is the actual RBAC/guardrail enforcement
    for retrieval: only chunks scoped to this role (or shared), and only this
    user's own personal/profile chunks."""
    role_or_shared = {"role_scope": role}
    owner_clause = {"$or": [{"owner_id": None}, {"owner_id": owner_id}]}
    query: dict[str, Any] = {"$and": [role_or_shared, owner_clause]}
    if namespaces:
        query["$and"].append({"namespace": {"$in": namespaces}})
    return query


async def search(
    query_text: str,
    *,
    role: str,
    owner_id: str | None,
    namespaces: list[str] | None = None,
    top_k: int | None = None,
) -> list[dict]:
    """Role/owner-scoped retrieval. Tries semantic search first, falls back
    to MongoDB text search. Returns chunk docs with a `score` field."""
    top_k = top_k or settings.RAG_TOP_K
    base_filter = _scope_filter(role=role, owner_id=owner_id, namespaces=namespaces)

    if embeddings_available():
        query_embedding = await generate_embedding(query_text)
        if query_embedding:
            candidates = await database.kb_chunks.find(
                {**base_filter, "embedding": {"$ne": None}}
            ).to_list(length=settings.RAG_CANDIDATE_LIMIT)
            if candidates:
                scored = [
                    {**c, "score": _cosine(query_embedding["vector"], c["embedding"])}
                    for c in candidates
                ]
                scored.sort(key=lambda c: c["score"], reverse=True)
                return scored[:top_k]

    # Lexical fallback ($text requires a text index — see database.py)
    try:
        cursor = database.kb_chunks.find(
            {**base_filter, "$text": {"$search": query_text}},
            {"score": {"$meta": "textScore"}},
        ).sort([("score", {"$meta": "textScore"})]).limit(top_k)
        results = await cursor.to_list(length=top_k)
        if results:
            return results
    except Exception:
        pass

    # Last resort: most-recent chunks in scope (keeps the assistant from
    # going completely context-free if search infra has an issue).
    fallback = await database.kb_chunks.find(base_filter).sort("updated_at", -1).to_list(length=top_k)
    for doc in fallback:
        doc["score"] = 0.0
    return fallback


def format_context(chunks: list[dict], *, max_chars: int | None = None) -> tuple[str, list[dict]]:
    """Builds the delimited context block for the LLM prompt plus a citation
    list for the response payload."""
    max_chars = max_chars or settings.RAG_MAX_CONTEXT_CHARS
    blocks: list[str] = []
    sources: list[dict] = []
    used = 0
    for i, chunk in enumerate(chunks, start=1):
        text = chunk.get("text") or ""
        if used + len(text) > max_chars and blocks:
            break
        blocks.append(f"[SOURCE {i} | {chunk.get('title')}]\n{text}")
        used += len(text)
        sources.append(
            {
                "title": chunk.get("title"),
                "namespace": chunk.get("namespace"),
                "source": chunk.get("source"),
                "score": round(float(chunk.get("score") or 0.0), 4),
            }
        )
    context = "\n\n---\n\n".join(blocks)
    return context, sources
