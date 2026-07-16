from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.rbac import CurrentUser
from app.core.security import require_roles
from app.services.profile_image_service import profile_image_service

router = APIRouter(prefix="/api/profile", tags=["Profile"])

RequireProfileUser = Annotated[CurrentUser, Depends(require_roles("recruiter", "candidate", "employee", "super_admin"))]


@router.get("/image")
async def get_profile_image(current_user: RequireProfileUser):
    return {"profileImage": await profile_image_service.get_profile_image(current_user)}


@router.post("/image")
async def upload_profile_image(
    current_user: RequireProfileUser,
    file: UploadFile = File(...),
):
    return await profile_image_service.upload_profile_image(current_user, file)


@router.delete("/image")
async def delete_profile_image(current_user: RequireProfileUser):
    return await profile_image_service.delete_profile_image(current_user)
