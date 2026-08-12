from __future__ import annotations

import asyncio
import os
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app.services.dashboard_service as dashboard_module
import app.services.organization_service as organization_module
import app.services.people_history as history_module
from app.core.rbac import CurrentUser
from app.services.dashboard_service import DashboardService
from app.services.employee_service import EmployeeService


def _run(coro):
    return asyncio.run(coro)


def _matches_value(actual, condition, *, exists: bool) -> bool:
    if not isinstance(condition, dict):
        return condition in actual if isinstance(actual, list) else actual == condition
    for operator, expected in condition.items():
        if operator == "$in":
            values = actual if isinstance(actual, list) else [actual]
            if not any(value in expected for value in values):
                return False
        elif operator == "$ne":
            if actual == expected:
                return False
        elif operator == "$exists":
            if exists != expected:
                return False
        elif operator == "$size":
            if not isinstance(actual, list) or len(actual) != expected:
                return False
        elif operator == "$gte":
            if actual is None or actual < expected:
                return False
        else:
            raise AssertionError(f"Unsupported test operator: {operator}")
    return True


def _matches(doc: dict, query: dict) -> bool:
    if "$and" in query and not all(_matches(doc, clause) for clause in query["$and"]):
        return False
    if "$or" in query and not any(_matches(doc, clause) for clause in query["$or"]):
        return False
    for key, condition in query.items():
        if key in {"$and", "$or"}:
            continue
        if not _matches_value(doc.get(key), condition, exists=key in doc):
            return False
    return True


class _Cursor:
    def __init__(self, docs: list[dict]):
        self.docs = docs

    def sort(self, *_args):
        return self

    def limit(self, length: int):
        self.docs = self.docs[:length]
        return self

    async def to_list(self, length: int | None = None):
        return list(self.docs if length is None else self.docs[:length])


class _Collection:
    def __init__(self, docs: list[dict] | None = None):
        self.docs = docs or []

    async def find_one(self, query: dict, _projection: dict | None = None):
        return next((doc for doc in self.docs if _matches(doc, query)), None)

    def find(self, query: dict, _projection: dict | None = None):
        return _Cursor([doc for doc in self.docs if _matches(doc, query)])


class _Database:
    def __init__(self):
        self.recruiters = _Collection(
            [
                {"user_id": "rec-1", "organization_id": "org-1"},
                {"user_id": "rec-2", "organization_id": "org-1"},
                {"user_id": "rec-9", "organization_id": "org-9"},
            ]
        )
        self.candidates = _Collection()
        self.employees = _Collection()
        self.invitations = _Collection()
        self.users = _Collection()
        self.announcements = _Collection()


def _user(user_id: str, role: str, org_id: str | None = None) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email=f"{user_id}@example.com",
        full_name=user_id,
        role=role,
        access_token="token",
        organization_id=org_id,
    )


def _patch_database(monkeypatch, db: _Database) -> None:
    monkeypatch.setattr(history_module, "database", db)
    monkeypatch.setattr(organization_module, "database", db)
    monkeypatch.setattr(dashboard_module, "database", db)


def test_person_history_does_not_expose_cross_org_active_employee(monkeypatch):
    db = _Database()
    db.employees.docs = [
        {
            "employee_id": "EMP-SECRET",
            "user_id": "other-user",
            "full_name": "Other Organization Employee",
            "email": "shared@example.com",
            "status": "active",
            "organization_id": "org-9",
            # Even inconsistent ownership metadata must not override an explicit tenant.
            "recruiter_id": "rec-1",
        }
    ]
    _patch_database(monkeypatch, db)

    result = _run(
        EmployeeService().lookup_person_history(
            _user("rec-2", "recruiter", "org-1"), "shared@example.com"
        )
    )

    assert result["active_conflict"] is None
    assert result["matches"] == []
    assert "EMP-SECRET" not in str(result)
    assert "Other Organization Employee" not in str(result)


def test_person_history_keeps_same_org_legacy_employee_visible(monkeypatch):
    db = _Database()
    db.employees.docs = [
        {
            "employee_id": "EMP-LEGACY",
            "full_name": "Same Organization Employee",
            "email": "legacy@example.com",
            "status": "active",
            "recruiter_id": "rec-1",
        }
    ]
    _patch_database(monkeypatch, db)

    result = _run(
        EmployeeService().lookup_person_history(
            _user("rec-2", "recruiter", "org-1"), "legacy@example.com"
        )
    )

    assert result["active_conflict"]["id"] == "EMP-LEGACY"


def test_recruiter_announcements_are_limited_to_organization(monkeypatch):
    db = _Database()
    now = datetime.now(UTC)
    db.announcements.docs = [
        {"_id": "a1", "title": "Org 1", "audience": "both", "organization_id": "org-1", "created_by": "rec-1", "created_at": now},
        {"_id": "a2", "title": "Org 1 legacy", "audience": "both", "created_by": "rec-2", "created_at": now},
        {"_id": "a9", "title": "Org 9", "audience": "both", "organization_id": "org-9", "created_by": "rec-9", "created_at": now},
        {"_id": "a-conflict", "title": "Explicit Org 9", "audience": "both", "organization_id": "org-9", "created_by": "rec-1", "created_at": now},
    ]
    _patch_database(monkeypatch, db)

    result = _run(
        DashboardService().list_announcements(
            _user("rec-1", "recruiter", "org-1")
        )
    )

    assert {item["title"] for item in result["announcements"]} == {"Org 1", "Org 1 legacy"}


def test_employee_announcements_are_limited_to_organization(monkeypatch):
    db = _Database()
    now = datetime.now(UTC)
    db.employees.docs = [
        {
            "user_id": "employee-1",
            "email": "employee-1@example.com",
            "status": "active",
            "organization_id": "org-1",
            "recruiter_id": "rec-1",
            "created_at": now - timedelta(days=1),
        }
    ]
    db.announcements.docs = [
        {"_id": "a1", "title": "Visible", "audience": "employees", "organization_id": "org-1", "created_by": "rec-1", "created_at": now},
        {"_id": "a9", "title": "Hidden", "audience": "employees", "organization_id": "org-9", "created_by": "rec-9", "created_at": now},
    ]
    _patch_database(monkeypatch, db)

    result = _run(
        DashboardService().list_announcements(
            _user("employee-1", "employee", "org-1")
        )
    )

    assert [item["title"] for item in result["announcements"]] == ["Visible"]
