"""IT provisioning kits — reusable standard setups (assets + licenses)."""

from __future__ import annotations

from datetime import UTC, datetime

from bson import ObjectId
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.it_provisioning import ItKitCreateRequest, ItKitUpdateRequest


def _kit_out(doc: dict) -> dict:
    return {
        "kit_id": str(doc["_id"]),
        "name": doc.get("name"),
        "description": doc.get("description"),
        "assets": doc.get("assets") or [],
        "licenses": doc.get("licenses") or [],
        "roles": doc.get("roles") or [],
        "is_default": bool(doc.get("is_default")),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


class ItKitService:
    async def list_kits(self, current_user: CurrentUser) -> dict:
        docs = await database.it_kits.find({}).sort("name", 1).to_list(length=200)
        return {"kits": [_kit_out(d) for d in docs], "count": len(docs)}

    async def get_kit(self, current_user: CurrentUser, kit_id: str) -> dict:
        return _kit_out(await self._find(kit_id))

    async def create_kit(self, current_user: CurrentUser, request: ItKitCreateRequest) -> dict:
        now = datetime.now(UTC)
        doc = {
            "name": request.name,
            "description": request.description,
            "assets": [a.model_dump() for a in request.assets],
            "licenses": [l.model_dump() for l in request.licenses],
            "roles": request.roles,
            "is_default": request.is_default,
            "created_by": current_user.id,
            "created_at": now,
            "updated_at": now,
        }
        try:
            result = await database.it_kits.insert_one(doc)
        except DuplicateKeyError as exc:
            raise HTTPException(
                status_code=409,
                detail=f"A kit named '{request.name}' already exists.",
            ) from exc
        doc["_id"] = result.inserted_id
        return _kit_out(doc)

    async def update_kit(self, current_user: CurrentUser, kit_id: str, request: ItKitUpdateRequest) -> dict:
        doc = await self._find(kit_id)
        updates: dict = {}
        if request.name is not None:
            updates["name"] = request.name
        if request.description is not None:
            updates["description"] = request.description
        if request.assets is not None:
            updates["assets"] = [a.model_dump() for a in request.assets]
        if request.licenses is not None:
            updates["licenses"] = [l.model_dump() for l in request.licenses]
        if request.roles is not None:
            updates["roles"] = request.roles
        if request.is_default is not None:
            updates["is_default"] = request.is_default
        updates["updated_at"] = datetime.now(UTC)
        try:
            await database.it_kits.update_one({"_id": doc["_id"]}, {"$set": updates})
        except DuplicateKeyError as exc:
            raise HTTPException(
                status_code=409,
                detail=f"A kit named '{updates.get('name') or doc.get('name')}' already exists.",
            ) from exc
        return _kit_out(await self._find(kit_id))

    async def delete_kit(self, current_user: CurrentUser, kit_id: str) -> dict:
        doc = await self._find(kit_id)
        await database.it_kits.delete_one({"_id": doc["_id"]})
        return {"message": f"IT kit '{doc.get('name')}' deleted.", "kit_id": kit_id}

    async def _find(self, kit_id: str) -> dict:
        if not kit_id or not ObjectId.is_valid(kit_id):
            raise HTTPException(status_code=404, detail="IT kit not found.")
        doc = await database.it_kits.find_one({"_id": ObjectId(kit_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="IT kit not found.")
        return doc


it_kit_service = ItKitService()
