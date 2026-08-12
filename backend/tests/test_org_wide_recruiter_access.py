"""Regression tests for org-wide recruiter access to employees.

These tests cover the intended policy:
- recruiters can manage employees across their organization, even if another
  recruiter originally created the employee or assignment
- legacy employees missing organization_id are still visible if their
  recruiter belongs to the same organization
- cross-organization access remains blocked
- messaging stays recruiter-specific: employees talk only to their assigned recruiter
"""

from __future__ import annotations

import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app.services.learning_service as learning_module
import app.services.message_service as message_module
import app.services.organization_service as org_module
from app.core.rbac import CurrentUser
from app.services.learning_service import LearningService
from app.services.message_service import MessageService
from app.services.organization_service import recruiter_can_access, recruiter_can_access_record
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


def _matches(doc: dict, query: dict) -> bool:
    if not query:
        return True
    if "$and" in query:
        rest = {k: v for k, v in query.items() if k != "$and"}
        return _matches(doc, rest) and all(_matches(doc, part) for part in query["$and"])
    if "$or" in query:
        rest = {k: v for k, v in query.items() if k != "$or"}
        return _matches(doc, rest) and any(_matches(doc, part) for part in query["$or"])
    for key, value in query.items():
        actual = doc.get(key)
        if isinstance(value, dict) and "$in" in value:
            allowed = {str(item) for item in value["$in"]}
            if str(actual) not in allowed:
                return False
        elif isinstance(value, dict) and "$exists" in value:
            if (key in doc) != bool(value["$exists"]):
                return False
        elif str(actual) != str(value):
            return False
    return True


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
        return _FakeCursor([doc for doc in self.docs if _matches(doc, query)])

    async def find_one(self, query: dict):
        for doc in self.docs:
            if _matches(doc, query):
                return doc
        return None


class _FakeDatabase:
    def __init__(self, employees: list[dict], assignments: list[dict], recruiters: list[dict], threads: list[dict] | None = None):
        self.employees = _FakeCollection(employees)
        self.learning_assignments = _FakeCollection(assignments)
        self.recruiters = _FakeCollection(recruiters)
        self.hr_threads = _FakeCollection(threads or [])


ORG_RECRUITERS = [
    {"user_id": "rec-1", "organization_id": "org-1"},
    {"user_id": "rec-2", "organization_id": "org-1"},
    {"user_id": "rec-9", "organization_id": "org-9"},
]


@pytest.fixture
def fake_db(monkeypatch):
    db = _FakeDatabase(
        employees=[
            {"employee_id": "EMP-1", "organization_id": "org-1", "status": "active", "recruiter_id": "rec-1"},
            {"employee_id": "EMP-HASSAN", "status": "active", "recruiter_id": "rec-1"},
            {"employee_id": "EMP-2", "organization_id": "org-1", "status": "active", "recruiter_id": "rec-2"},
            {"employee_id": "EMP-3", "organization_id": "org-9", "status": "active", "recruiter_id": "rec-9"},
        ],
        assignments=[
            {"_id": "a1", "employee_id": "EMP-1", "organization_id": "org-1", "course_uid": "c1", "course_title": "Course 1", "created_at": 3},
            {"_id": "a2", "employee_id": "EMP-HASSAN", "course_uid": "c2", "course_title": "Course 2", "created_at": 2},
            {"_id": "a3", "employee_id": "EMP-3", "organization_id": "org-9", "course_uid": "c3", "course_title": "Course 3", "created_at": 1},
        ],
        recruiters=ORG_RECRUITERS,
        threads=[
            {"_id": "t1", "recruiter_id": "rec-1", "employee_id": "EMP-HASSAN", "employee_user_id": "hassan"},
            {"_id": "t2", "recruiter_id": "rec-2", "employee_id": "EMP-2", "employee_user_id": "emp-2"},
        ],
    )
    monkeypatch.setattr(learning_module, "database", db)
    monkeypatch.setattr(org_module, "database", db)
    monkeypatch.setattr(message_module, "database", db)
    return db


def test_talent_service_allows_same_org_employee_from_other_recruiter():
    service = TalentService()
    current_user = _recruiter("rec-2", "org-1")
    employee = {"employee_id": "EMP-1", "organization_id": "org-1", "recruiter_id": "rec-1"}

    assert _run(service._assert_recruiter_owns(current_user, employee)) is None


def test_talent_service_allows_legacy_employee_owned_by_other_recruiter(fake_db):
    service = TalentService()
    current_user = _recruiter("rec-2", "org-1")
    employee = {"employee_id": "EMP-HASSAN", "recruiter_id": "rec-1"}

    assert _run(service._assert_recruiter_owns(current_user, employee)) is None


def test_talent_service_blocks_cross_org_employee(fake_db):
    service = TalentService()
    current_user = _recruiter("rec-2", "org-1")
    employee = {"employee_id": "EMP-9", "organization_id": "org-9", "recruiter_id": "rec-9"}

    with pytest.raises(HTTPException) as exc:
        _run(service._assert_recruiter_owns(current_user, employee))
    assert exc.value.status_code == 403


def test_learning_can_assign_to_legacy_employee_from_other_recruiter(fake_db):
    service = LearningService()
    current_user = _recruiter("rec-2", "org-1")
    employee = {"employee_id": "EMP-HASSAN", "recruiter_id": "rec-1", "status": "active"}

    assert _run(service._assert_recruiter_owns(current_user, employee)) is None


def test_learning_assignments_list_includes_legacy_same_org_employees(fake_db):
    service = LearningService()
    current_user = _recruiter("rec-2", "org-1")

    result = _run(
        service.list_assignments(
            current_user,
            employee_id=None,
            status_filter=None,
            mandatory_only=None,
        )
    )

    assert [item["employee_id"] for item in result["assignments"]] == ["EMP-1", "EMP-HASSAN"]


def test_learning_assignments_reject_cross_org_employee_filter(fake_db):
    service = LearningService()
    current_user = _recruiter("rec-2", "org-1")

    with pytest.raises(HTTPException) as exc:
        _run(
            service.list_assignments(
                current_user,
                employee_id="EMP-3",
                status_filter=None,
                mandatory_only=None,
            )
        )
    assert exc.value.status_code == 403


def test_recruiter_can_access_matches_org_id_as_string():
    current_user = _recruiter("rec-2", "org-1")
    employee = {"organization_id": "org-1", "recruiter_id": "rec-1"}
    assert recruiter_can_access(current_user, employee) is True


def test_recruiter_can_access_record_allows_legacy_same_org_employee(fake_db):
    current_user = _recruiter("rec-2", "org-1")
    employee = {"recruiter_id": "rec-1"}
    assert _run(recruiter_can_access_record(current_user, employee)) is True
    outsider = {"recruiter_id": "rec-9"}
    assert _run(recruiter_can_access_record(current_user, outsider)) is False


def test_recruiter_cannot_start_message_with_other_recruiters_employee(fake_db):
    service = MessageService()
    current_user = _recruiter("rec-2", "org-1")

    with pytest.raises(HTTPException) as exc:
        _run(
            service.recruiter_start(
                current_user,
                employee_id="EMP-HASSAN",
                body="Hello Hassan",
            )
        )
    assert exc.value.status_code == 403


def test_recruiter_lists_only_own_message_threads(fake_db):
    service = MessageService()
    current_user = _recruiter("rec-2", "org-1")

    result = _run(service.list_threads_for_recruiter(current_user))
    assert [item["employee_id"] for item in result["threads"]] == ["EMP-2"]


def test_recruiter_cannot_open_other_recruiters_thread(fake_db):
    service = MessageService()
    current_user = _recruiter("rec-2", "org-1")
    thread = {"_id": "t1", "recruiter_id": "rec-1", "employee_user_id": "hassan"}

    with pytest.raises(HTTPException) as exc:
        service._assert_access(current_user, thread)
    assert exc.value.status_code == 403
