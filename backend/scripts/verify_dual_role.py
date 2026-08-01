"""
Offline verification of the dual employee/recruiter role mechanism.
Does not touch the real database — every collection AuthService talks to is
replaced with a tiny in-memory fake so the actual service/security code runs
for real, just against fake storage.
"""
import asyncio
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, ".")


class FakeCollection:
    def __init__(self):
        self.docs = []
        self._id_seq = 0

    async def find_one(self, query):
        for doc in self.docs:
            if self._matches(doc, query):
                return doc
        return None

    async def insert_one(self, doc):
        self._id_seq += 1
        doc = dict(doc)
        doc["_id"] = f"id{self._id_seq}"
        self.docs.append(doc)

        class Result:
            inserted_id = doc["_id"]

        return Result()

    async def replace_one(self, query, doc, upsert=False):
        for i, existing in enumerate(self.docs):
            if self._matches(existing, query):
                self.docs[i] = dict(doc)
                return
        if upsert:
            self.docs.append(dict(doc))

    async def update_one(self, query, update):
        for doc in self.docs:
            if self._matches(doc, query):
                if "$set" in update:
                    doc.update(update["$set"])
                return

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not self._matches(d, query)]
        return before - len(self.docs)

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if self._matches(doc, query):
                del self.docs[i]
                return

    async def count_documents(self, query):
        return sum(1 for d in self.docs if self._matches(d, query))

    @staticmethod
    def _matches(doc, query):
        for key, expected in query.items():
            if key == "$or":
                if not any(FakeCollection._matches(doc, sub) for sub in expected):
                    return False
                continue
            if doc.get(key) != expected:
                return False
        return True


class FakeDatabase:
    def __init__(self):
        self.users = FakeCollection()
        self.recruiters = FakeCollection()
        self.employees = FakeCollection()
        self.candidates = FakeCollection()
        self.super_admins = FakeCollection()
        self.pending_users = FakeCollection()
        self.refresh_tokens = FakeCollection()
        self.audit_logs = FakeCollection()
        self.failed_logins = FakeCollection()


async def main():
    # Patch the database *before* importing anything that binds `database` by reference.
    import app.core.database as db_module
    fake_db = FakeDatabase()
    db_module.database = fake_db

    import app.core.security as security_module
    security_module.database = fake_db

    from app.core.security import hash_password
    import app.services.auth_service as auth_service_module
    auth_service_module.database = fake_db

    from app.services.auth_service import AuthService
    from app.schemas.auth import LoginRequest
    from app.core.security import get_current_user, extract_bearer_token
    from jose import jwt
    from app.core.config import settings

    service = AuthService()
    now = datetime.now(UTC)

    async def fake_check_lock(email):
        return None

    async def fake_clear_failed(email):
        return None

    service._check_account_lock = fake_check_lock
    service._clear_failed_login = fake_clear_failed

    results = []

    def check(name, condition):
        results.append((name, condition))
        print(("PASS" if condition else "FAIL"), "-", name)

    # ---- Scenario 1: dual-role user (employee + recruiter) ----
    pw_hash = hash_password("Password123!")
    await fake_db.users.insert_one({
        "email": "dual@company.com", "password_hash": pw_hash, "role": "employee",
        "status": "active", "created_at": now, "updated_at": now,
    })
    dual_user_id = fake_db.users.docs[0]["_id"]
    await fake_db.employees.insert_one({
        "user_id": dual_user_id, "full_name": "Dana Dual", "email": "dual@company.com",
        "phone": "+923001234567", "role": "employee", "status": "active",
        "job_title": "Engineer", "department": "Platform",
    })
    await fake_db.recruiters.insert_one({
        "user_id": dual_user_id, "full_name": "Dana Dual", "email": "dual@company.com",
        "phone": "+923001234567", "role": "recruiter", "status": "active",
    })

    login_req = LoginRequest(email="dual@company.com", password="Password123!", role="employee", remember_me=False)
    login_resp = await service.login(login_req)
    check("dual-role login as employee lands on employee dashboard",
          login_resp["redirect_to"] == "/dashboard/employee" and login_resp["user"]["role"] == "employee")
    check("dual-role available_roles reports both, employee first",
          login_resp["user"]["available_roles"] == ["employee", "recruiter"])

    # get_current_user must resolve as employee for this token (the core bug fix)
    class FakeCurrentUserCtx:
        pass

    async def get_user_from_token(token):
        return await get_current_user(authorization=f"Bearer {token}")

    current = await get_user_from_token(login_resp["session"]["access_token"])
    check("token-based resolution honors JWT role (employee), not fixed priority",
          current.role == "employee")

    # Switch to recruiter
    switch_resp = await service.switch_role(current, "recruiter")
    check("switch_role returns recruiter session + redirect",
          switch_resp["user"]["role"] == "recruiter" and switch_resp["redirect_to"] == "/dashboard/recruiter")

    current_after_switch = await get_user_from_token(switch_resp["session"]["access_token"])
    check("post-switch token resolves as recruiter (not overridden back to employee)",
          current_after_switch.role == "recruiter")

    # Old (pre-switch) refresh token must be invalidated
    old_refresh_still_stored = any(
        d["token"] == login_resp["session"]["refresh_token"] for d in fake_db.refresh_tokens.docs
    )
    check("old refresh token revoked after switch", not old_refresh_still_stored)

    # Switching to an unrelated role must fail
    try:
        await service.switch_role(current_after_switch, "candidate")
        check("switch_role rejects non employee/recruiter target", False)
    except Exception as exc:
        check("switch_role rejects non employee/recruiter target", "400" in str(exc.status_code) if hasattr(exc, "status_code") else True)

    # ---- Scenario 2: pure recruiter (no employee profile) using the trimmed login screen ----
    await fake_db.users.insert_one({
        "email": "recruiter-only@company.com", "password_hash": pw_hash, "role": "recruiter",
        "status": "active", "created_at": now, "updated_at": now,
    })
    ro_user_id = fake_db.users.docs[-1]["_id"]
    await fake_db.recruiters.insert_one({
        "user_id": ro_user_id, "full_name": "Rana Recruiter", "email": "recruiter-only@company.com",
        "phone": "+923001234568", "role": "recruiter", "status": "active",
    })

    ro_login_req = LoginRequest(email="recruiter-only@company.com", password="Password123!", role="employee", remember_me=False)
    ro_resp = await service.login(ro_login_req)
    check("recruiter-only account signing in via Employee button falls back to recruiter dashboard",
          ro_resp["user"]["role"] == "recruiter" and ro_resp["redirect_to"] == "/dashboard/recruiter")
    check("recruiter-only account has no switch option (single role)",
          ro_resp["user"]["available_roles"] == ["recruiter"])

    # ---- Scenario 3: employee-only account (no recruiter profile) ----
    await fake_db.users.insert_one({
        "email": "employee-only@company.com", "password_hash": pw_hash, "role": "employee",
        "status": "active", "created_at": now, "updated_at": now,
    })
    eo_user_id = fake_db.users.docs[-1]["_id"]
    await fake_db.employees.insert_one({
        "user_id": eo_user_id, "full_name": "Eli Employee", "email": "employee-only@company.com",
        "phone": "+923001234569", "role": "employee", "status": "active",
    })
    eo_login_req = LoginRequest(email="employee-only@company.com", password="Password123!", role="employee", remember_me=False)
    eo_resp = await service.login(eo_login_req)
    check("employee-only account logs in as employee",
          eo_resp["user"]["role"] == "employee")
    check("employee-only account has no switch option (single role)",
          eo_resp["user"]["available_roles"] == ["employee"])

    eo_current = await get_user_from_token(eo_resp["session"]["access_token"])
    try:
        await service.switch_role(eo_current, "recruiter")
        check("employee-only account cannot switch to recruiter (no profile)", False)
    except Exception as exc:
        check("employee-only account cannot switch to recruiter (no profile)",
              getattr(exc, "status_code", None) == 403)

    print()
    total = len(results)
    passed = sum(1 for _, ok in results if ok)
    print(f"{passed}/{total} checks passed")
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
