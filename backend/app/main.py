from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router
from app.core.config import settings
from app.core.database import create_database_indexes, mongo_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_database_indexes()
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

app.include_router(router)
