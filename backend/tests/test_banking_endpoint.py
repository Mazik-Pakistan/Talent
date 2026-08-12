"""Regression tests for PUT /api/employees/detail/{employee_id}/banking.

Root cause: the endpoint declared `payload: dict` and manually called
`OnboardingEmploymentInfo.model_validate(payload)` inside the handler. A
Pydantic ValidationError raised inside a handler body is NOT converted by
FastAPI into a 422 (only RequestValidationError from parameter binding is), so
every malformed payload produced an unhandled 500.

Fix: the route now declares the Pydantic body model directly, so FastAPI
rejects invalid payloads with a normal 422 before the handler runs.

These tests exercise the real employees router through FastAPI with the auth
dependency overridden and the banking service stubbed — no database required.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import employees as employees_module
from app.core import security as security_module
from app.core.rbac import CurrentUser
from app.schemas.invitation import OnboardingEmploymentInfo

BANKING_URL = "/api/employees/detail/EMP-000123/banking"

VALID_PAYLOAD = {
    "bank_name": "HBL",
    "account_holder_name": "Jane Doe",
    "account_number": "1234567890",
    "iban": "pk36scbl0000001123456702",
    "branch": "Main Branch",
    "branch_code": "0011",
    "swift_code": "SCBLPKKA",
}


@pytest.fixture()
def make_client(monkeypatch):
    """Build a TestClient over the real employees router with auth stubbed."""

    async def noop_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(security_module, "_audit_denied", noop_audit)

    def _make(role: str = "recruiter", capabilities: dict | None = None):
        captured: dict = {}

        async def fake_get_current_user() -> CurrentUser:
            return CurrentUser(
                id="rec-1",
                email="recruiter@test.test",
                full_name="Recruiter",
                role=role,
                access_token="token",
                capabilities=capabilities,
            )

        async def fake_update_employee_banking(current_user, employee_id, request):
            captured["current_user"] = current_user
            captured["employee_id"] = employee_id
            captured["request"] = request
            return {
                "message": "Banking details saved. The employee has been notified.",
                "employee": {"employee_id": "EMP-000123"},
            }

        app = FastAPI()
        app.include_router(employees_module.router)
        app.dependency_overrides[security_module.get_current_user] = fake_get_current_user
        monkeypatch.setattr(
            employees_module.service, "update_employee_banking", fake_update_employee_banking
        )
        return TestClient(app), captured

    return _make


def _detail_field_names(payload: dict) -> set:
    return {tuple(str(part) for part in item.get("loc", [])) for item in payload.get("detail", [])}


def test_empty_body_returns_422(make_client):
    client, _ = make_client()
    response = client.put(BANKING_URL, json={})
    assert response.status_code == 422
    fields = _detail_field_names(response.json())
    for required in ("bank_name", "account_holder_name", "account_number", "iban", "branch", "branch_code"):
        assert ("body", required) in fields


def test_no_body_returns_422(make_client):
    client, _ = make_client()
    response = client.put(BANKING_URL)
    assert response.status_code == 422


def test_missing_required_fields_returns_422(make_client):
    client, _ = make_client()
    response = client.put(BANKING_URL, json={"bank_name": "HBL"})
    assert response.status_code == 422
    fields = _detail_field_names(response.json())
    assert ("body", "account_holder_name") in fields
    assert ("body", "iban") in fields


def test_invalid_iban_returns_422(make_client):
    client, _ = make_client()
    payload = dict(VALID_PAYLOAD, iban="NOTANIBAN")
    response = client.put(BANKING_URL, json=payload)
    assert response.status_code == 422


def test_null_required_field_returns_422(make_client):
    client, _ = make_client()
    payload = dict(VALID_PAYLOAD, account_number=None)
    response = client.put(BANKING_URL, json=payload)
    assert response.status_code == 422
    assert ("account_number",) in _detail_field_names(response.json())


def test_wrong_type_returns_422(make_client):
    client, _ = make_client()
    payload = dict(VALID_PAYLOAD, bank_name=12345)
    response = client.put(BANKING_URL, json=payload)
    assert response.status_code == 422


def test_valid_frontend_payload_returns_200(make_client):
    client, captured = make_client()
    response = client.put(BANKING_URL, json=dict(VALID_PAYLOAD))
    assert response.status_code == 200
    request = captured["request"]
    assert isinstance(request, OnboardingEmploymentInfo)
    assert captured["employee_id"] == "EMP-000123"
    assert captured["current_user"].role == "recruiter"
    assert request.bank_name == "HBL"
    assert request.account_number == "1234567890"
    assert request.iban == "PK36SCBL0000001123456702"
    assert request.branch_code == "0011"
    assert request.swift_code == "SCBLPKKA"


def test_null_optional_swift_code_returns_200(make_client):
    client, captured = make_client()
    payload = dict(VALID_PAYLOAD, swift_code=None)
    response = client.put(BANKING_URL, json=payload)
    assert response.status_code == 200
    assert captured["request"].swift_code is None


def test_extra_unknown_fields_are_ignored(make_client):
    client, captured = make_client()
    payload = dict(VALID_PAYLOAD, account_title="Jane Doe", unrelated=42)
    response = client.put(BANKING_URL, json=payload)
    assert response.status_code == 200
    assert captured["request"].account_holder_name == "Jane Doe"


def test_employee_role_rejected_with_403(make_client):
    client, _ = make_client(role="employee")
    response = client.put(BANKING_URL, json=dict(VALID_PAYLOAD))
    assert response.status_code == 403


def test_candidate_role_rejected_with_403(make_client):
    client, _ = make_client(role="candidate")
    response = client.put(BANKING_URL, json=dict(VALID_PAYLOAD))
    assert response.status_code == 403
