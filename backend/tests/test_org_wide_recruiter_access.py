"""Regression tests for org-wide recruiter access to employees.

These tests cover the intended policy:
- recruiters can manage employees across their organization, even if another
  recruiter originally created the employee or assignment
- cross-organization access remains blocked
- recruiter-specific messaging is intentionally out of scope
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app.services.learning_service as learning_module
from app.core.rbac import CurrentUser
from app.services.learning_service import LearningService
from app.services.talent_service import TalentService


def _run(coro):
    return asyncio.run(coro)


def _recruiter(user_id: str, org_id: str) -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email=f"{user_id}@example.com",
        full_name=user_id,
        role="recruiter",
        access_token="token",
        organization_id=org_id,
    )


class _FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, length: int | None = None):
        if length is None:
            return list(self._docs)
        return list(self._docs[:length])


class _FakeCollection:
    def __init__(self, docs: list[dict]):
        self.docs = docs
        self.last_query = None

    def find(self, query: dict, _projection: dict | None = None):
        self.last_query = query
        docs = self.docs

        employee_filter = query.get("employee_id")
        if isinstance(employee_filter, dict) and "$in" in employee_filter:
            allowed = set(employee_filter["$in"])
            docs = [doc for doc in docs if doc.get("employee_id") in allowed]
        elif isinstance(employee_filter, str):
            docs = [doc for doc in docs if doc.get("employee_id") == employee_filter]

        org_id = query.get("organization_id")
        if org_id is not None:
            docs = [doc for doc in docs if doc.get("organization_id") == org_id]

        status = query.get("status")
        if isinstance(status, str):
            docs = [doc for doc in docs if doc.get("status") == status]

        return _FakeCursor(docs)


class _FakeDatabase:
    def __init__(self, employees: list[dict], assignments: list[dict]):
        self.employees = _FakeCollection(employees)
        self.learning_assignments = _FakeCollection(assignments)


def test_talent_service_allows_same_org_employee_from_other_recruiter():
    service = TalentService()
    current_user = _recruiter("rec-2", "org-1")
    employee = {"employee_id": "EMP-1", "organization_id": "org-1", "recruiter_id": "rec-1"}

    assert _run(service._assert_recruiter_owns(current_user, employee)) is None


def test_talent_service_blocks_cross_org_employee():
    service = TalentService()
    current_user = _recruiter("rec-2", "org-1")
    employee = {"employee_id": "EMP-9", "organization_id": "org-9", "recruiter_id": "rec-1"}

    with pytest.raises(HTTPException) as exc:
        _run(service._assert_recruiter_owns(current_user, employee))
    assert exc.value.status_code == 403


def test_learning_assignments_list_uses_org_visible_employees(monkeypatch):
    service = LearningService()
    current_user = _recruiter("rec-2", "org-1")
    fake_db = _FakeDatabase(
        employees=[
            {"employee_id": "EMP-1", "organization_id": "org-1", "status": "active"},
            {"employee_id": "EMP-2", "organization_id": "org-1", "status": "active"},
            {"employee_id": "EMP-3", "organization_id": "org-9", "status": "active"},
        ],
        assignments=[
            {"_id": "a1", "employee_id": "EMP-1", "organization_id": "org-1", "course_uid": "c1", "course_title": "Course 1", "created_at": 3},
            {"_id": "a2", "employee_id": "EMP-2", "organization_id": "org-1", "course_uid": "c2", "course_title": "Course 2", "created_at": 2},
            {"_id": "a3", "employee_id": "EMP-3", "organization_id": "org-9", "course_uid": "c3", "course_title": "Course 3", "created_at": 1},
        ],
    )
    monkeypatch.setattr(learning_module, "database", fake_db)

    result = _run(
        service.list_assignments(
            current_user,
            employee_id=None,
            status_filter=None,
            mandatory_only=None,
        )
    )

    assert [item["employee_id"] for item in result["assignments"]] == ["EMP-1", "EMP-2"]
    assert fake_db.learning_assignments.last_query == {"employee_id": {"$in": ["EMP-1", "EMP-2"]}}


def test_learning_assignments_reject_cross_org_employee_filter(monkeypatch):
    service = LearningService()
    current_user = _recruiter("rec-2", "org-1")
    fake_db = _FakeDatabase(
        employees=[{"employee_id": "EMP-1", "organization_id": "org-1", "status": "active"}],
        assignments=[],
    )
    monkeypatch.setattr(learning_module, "database", fake_db)

    with pytest.raises(HTTPException) as exc:
        _run(
            service.list_assignments(
                current_user,
                employee_id="EMP-9",
                status_filter=None,
                mandatory_only=None,
            )
        )
    assert exc.value.status_code == 403
