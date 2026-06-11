"""Memory tools — store and recall facts across runs.

spaceId is always injected from AgentContext. Entity IDs come from prior
tool calls and are validated against the space at the storage layer.

recall_memory has two modes:
  - keyed:    pass entity_id (and optionally entity_type) → loads memories
              for that specific contact/deal/space, ordered by importance.
  - semantic: pass query → pgvector cosine similarity search across the
              workspace, optionally filtered by entity_type. Use when you
              know the topic but not the entity.
"""

from __future__ import annotations

from typing import Any

from agents import RunContextWrapper, function_tool

from memory.store import load_memories, save_memory, search_similar
from security.context import AgentContext
from tools.base import idempotent_tool

_VALID_TYPES = {"fact", "observation", "preference", "reminder"}
_VALID_ENTITIES = {"contact", "deal", "space"}


@function_tool(strict_mode=False)
async def recall_memory(
    ctx: RunContextWrapper[AgentContext],
    entity_id: str | None = None,
    entity_type: str | None = None,
    query: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Recall memories by entity (keyed) or by topic (semantic pgvector search)."""
    # Keyed: pass entity_id (+optional entity_type, default contact); ordered by importance.
    # Semantic: pass query; pgvector cosine across workspace, narrowable by entity_type.
    # entity_type: contact|deal|space (use 'space' for workspace-level keyed).
    # limit: 1-50.
    space_id = ctx.context.space_id

    if entity_type and entity_type not in _VALID_ENTITIES:
        return [{"error": f"entity_type must be one of {_VALID_ENTITIES}"}]

    capped = max(1, min(50, limit))

    # Semantic path
    if query and query.strip():
        rows = await search_similar(
            space_id=space_id,
            query=query.strip(),
            limit=capped,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        return [
            {
                "fact": r.get("content"),
                "type": r.get("memoryType"),
                "importance": r.get("importance"),
                "similarity": round(r.get("similarity", 0.0), 3) if r.get("similarity") is not None else None,
                "entityType": r.get("entityType"),
                "entityId": r.get("entityId"),
                "storedAt": r.get("createdAt"),
            }
            for r in rows
        ]

    # Keyed path
    target_id = entity_id or (space_id if entity_type == "space" else None)
    if not target_id:
        return [{"error": "Pass either entity_id or query (or set entity_type='space')"}]

    memories = await load_memories(
        space_id=space_id,
        entity_id=target_id,
        entity_type=entity_type or "contact",
        limit=capped,
    )

    return [
        {
            "fact": m["content"],
            "type": m.get("memoryType"),
            "importance": m.get("importance"),
            "storedAt": m.get("createdAt"),
        }
        for m in memories
    ]


@function_tool(strict_mode=False)
@idempotent_tool
async def store_memory(
    ctx: RunContextWrapper[AgentContext],
    entity_type: str,
    entity_id: str,
    content: str,
    memory_type: str = "fact",
    importance: float = 0.5,
) -> dict[str, Any]:
    """Store a memory for future runs; auto-embedded for semantic recall."""
    # entity_type: contact|deal|space. memory_type: fact|observation|preference|reminder.
    # importance: 0.0-1.0 (default 0.5). Bar: would a realtor want this in 6 months?
    space_id = ctx.context.space_id

    if entity_type not in _VALID_ENTITIES:
        return {"error": f"entity_type must be one of {_VALID_ENTITIES}"}
    if memory_type not in _VALID_TYPES:
        return {"error": f"memory_type must be one of {_VALID_TYPES}"}
    if not content or len(content.strip()) < 5:
        return {"error": "content must be a meaningful statement (5+ chars)"}

    memory = await save_memory(
        space_id=space_id,
        entity_type=entity_type,
        entity_id=entity_id,
        memory_type=memory_type,
        content=content.strip(),
        importance=max(0.0, min(1.0, importance)),
    )
    return {"stored": True, "id": memory.get("id", ""), "memoryType": memory_type}
