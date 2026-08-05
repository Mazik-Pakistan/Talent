from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin_tickets import router as admin_tickets_router
from app.api.agent import router as agent_router
from app.api.auth import router as auth_router
from app.api.dashboard import router as dashboard_router
from app.api.documents import router as documents_router
from app.api.employees import router as employees_router
from app.api.invitations import router as invitations_router
from app.api.it_provisioning import router as it_provisioning_router
from app.api.it_service_requests import router as it_service_requests_router
from app.api.learning import router as learning_router
from app.api.messages import router as messages_router
from app.api.offers import router as offers_router
from app.api.onboarding import router as onboarding_router
from app.api.rbac import router as rbac_router
from app.api.super_admin import router as super_admin_router
from app.api.talent import router as talent_router
from app.api.tickets import router as tickets_router
from app.api.universities import router as universities_router
from app.core.config import settings
from app.core.database import create_database_indexes, mongo_client
from app.core.rbac_seed import seed_rbac_collections
from app.services.employee_id_migration import migrate_employee_ids_to_emp_format
from app.services.org_taxonomy_service import seed_org_taxonomy
from app.services.organization_service import create_default_organization_if_needed
from app.services import coursera_service
from app.services.university_seed_service import seed_universities


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_database_indexes()
    await migrate_employee_ids_to_emp_format()
    await seed_rbac_collections()
    await seed_org_taxonomy()
    await seed_universities()
    # Multi-tenancy: ensure at least one organization exists for recruiter binds.
    await create_default_organization_if_needed()

    # Hydrate the Coursera catalog cache from its last Mongo snapshot so the
    # process never starts "cold" — the first employee to open the Coursera
    # tab gets an instant response instead of waiting on a full live fetch.
    await coursera_service.load_persisted_cache()

    coursera_service.start_background_refresh()

    yield

    coursera_service.stop_background_refresh()
    mongo_client.close()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(invitations_router)
app.include_router(it_provisioning_router)
app.include_router(it_service_requests_router)
app.include_router(onboarding_router)
app.include_router(universities_router)
app.include_router(rbac_router)
app.include_router(super_admin_router)
app.include_router(dashboard_router)
app.include_router(employees_router)
app.include_router(offers_router)
app.include_router(documents_router)
app.include_router(learning_router)
app.include_router(talent_router)
app.include_router(messages_router)
app.include_router(agent_router)
app.include_router(tickets_router)
app.include_router(admin_tickets_router)