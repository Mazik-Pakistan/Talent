from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.dashboard import router as dashboard_router
from app.api.employees import router as employees_router
from app.api.invitations import router as invitations_router
from app.api.onboarding import router as onboarding_router
from app.api.rbac import router as rbac_router
from app.core.config import settings
from app.core.database import create_database_indexes, mongo_client
from app.core.rbac_seed import seed_rbac_collections

UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_database_indexes()
    await seed_rbac_collections()
    yield
    mongo_client.close()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(invitations_router)
app.include_router(onboarding_router)
app.include_router(rbac_router)
app.include_router(dashboard_router)
app.include_router(employees_router)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_ROOT)), name="uploads")