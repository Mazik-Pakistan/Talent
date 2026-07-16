from __future__ import annotations

from pathlib import Path

from bson import ObjectId
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.services import storage_service
from app.services.cloudinary_service import cloudinary_service

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


class ProfileImageService:
    async def get_profile_image_by_user_id(self, user_id: str | None) -> dict | None:
        if not user_id:
            return None
        query = {"_id": ObjectId(user_id)} if ObjectId.is_valid(user_id) else {"user_id": user_id}
        user = await database.users.find_one(query)
        return user.get("profileImage") if user else None

    async def get_profile_image(self, current_user: CurrentUser) -> dict | None:
        user = await self._get_user_doc(current_user)
        return user.get("profileImage") if user else None

    async def get_profile_images_by_user_ids(self, user_ids: list[str]) -> dict[str, dict | None]:
        object_ids = [ObjectId(user_id) for user_id in user_ids if ObjectId.is_valid(user_id)]
        if not object_ids:
            return {}
        docs = await database.users.find({"_id": {"$in": object_ids}}).to_list(length=len(object_ids))
        return {
            str(doc["_id"]): doc.get("profileImage")
            for doc in docs
            if doc.get("profileImage")
        }

    async def upload_profile_image(self, current_user: CurrentUser, file: UploadFile) -> dict:
        original = file.filename or "profile-image"
        ext = Path(original).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported image format. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
            )

        content = await file.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded image is empty.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image is too large (max 5 MB).")

        user = await self._get_user_doc(current_user)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

        previous = user.get("profileImage") or {}
        uploaded = await cloudinary_service.upload_bytes(
            content=content,
            filename=original,
            folder=f"{settings.CLOUDINARY_FOLDER}/profile-images",
            public_id_prefix=f"{current_user.role}/{current_user.id}",
            resource_type="image",
        )
        next_image = {
            "public_id": uploaded["public_id"],
            "secure_url": uploaded["secure_url"],
        }

        result = await database.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"profileImage": next_image, "updated_at": uploaded["uploaded_at"]}},
        )
        if result.modified_count == 0 and result.matched_count == 0:
            await storage_service.delete_file(uploaded["public_id"], resource_type="image")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not update profile image.")

        if previous.get("public_id") and previous.get("public_id") != next_image["public_id"]:
            deleted = await storage_service.delete_file(previous["public_id"], resource_type="image")
            if not deleted:
                await database.users.update_one(
                    {"_id": user["_id"]},
                    {"$set": {"profileImage": previous, "updated_at": uploaded["uploaded_at"]}},
                )
                await storage_service.delete_file(uploaded["public_id"], resource_type="image")
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not replace the previous image.")

        return {"profileImage": next_image}

    async def delete_profile_image(self, current_user: CurrentUser) -> dict:
        if current_user.role not in {"recruiter", "super_admin"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Deleting profile images is only allowed for recruiter and super admin accounts.",
            )

        user = await self._get_user_doc(current_user)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

        previous = user.get("profileImage") or {}
        if not previous.get("public_id"):
            return {"profileImage": None}

        result = await database.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"profileImage": None}},
        )
        if result.modified_count == 0 and result.matched_count == 0:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not remove profile image.")

        deleted = await storage_service.delete_file(previous["public_id"], resource_type="image")
        if not deleted:
            await database.users.update_one(
                {"_id": user["_id"]},
                {"$set": {"profileImage": previous}},
            )
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not remove the previous image.")

        return {"profileImage": None}

    async def _get_user_doc(self, current_user: CurrentUser) -> dict | None:
        query = {}
        if ObjectId.is_valid(current_user.id):
            query["_id"] = ObjectId(current_user.id)
        else:
            query["email"] = current_user.email
        return await database.users.find_one(query)


profile_image_service = ProfileImageService()
