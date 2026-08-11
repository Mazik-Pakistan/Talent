"""Authorization regression tests for the broken-access-control audit.

Root cause found in the audit: several routers declared route dependencies using
`require_capabilities(...)` (or `require_any_capability`) *alone*. Because those
helpers only enforce checks for recruiters and silently pass candidates/employees
(see `role != "recruiter"` early-return in `require_capabilities`), any authenticated
non-recruiter could reach recruiter-only endpoints and read PII (employees,
candidates, person-history, IT officers overview, etc.).

Fix: every capability-based route dependency now composes the existing
`require_roles(...)` primitive with the capability check, so non-recruiters are
rejected with HTTP 403 at the dependency layer while recruiters remain
capability-gated and super_admins bypass capability gating.

These tests call the fixed dependency factories directly with mock `CurrentUser`
objects, run via `asyncio.run(...)` — no database or token validation required.
"""

from __future__ import annotations

import sys
import os
import io
import asyncio
import typing

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException

from app.core.rbac import CurrentUser
from app.core.security import require_roles, require_capabilities, require_any_capability
import app.core.security as security_mod


@pytest.fixture(autouse=True)
def _patch_audit(monkeypatch):
    """The dependency factories write an audit log on every 403 (DB-backed).
    Patch the audit write to a no-op so denial-path assertions run without a
    database connection."""
    async def _noop(*args, **kwargs):
        return None
    monkeypatch.setattr(security_mod, "_audit_denied", _noop)


def _user(role: str, caps: dict | None = None) -> CurrentUser:
    return CurrentUser(
        id=f"{role}-001",
        email=f"{role}@test.test",
        full_name=f"Test {role}",
        role=role,
        access_token="test-token",
        capabilities=caps,
    )


candidate = _user("candidate")
employee = _user("employee")
super_admin = _user("super_admin")
recruiter_full = _user("recruiter", caps={})
_ALL_CAPS = ("employees", "candidates", "it", "messages", "talent", "learning",
             "invite", "org_config", "announcements", "overview", "profile")
recruiter_no_caps = _user("recruiter", caps={k: False for k in _ALL_CAPS})


def _run(coro):
    """Drive an async dependency callable from a synchronous test."""
    return asyncio.run(coro)


def _denied(role):
    return candidate if role == "candidate" else employee


# --------------------------------------------------------------------------- #
# 1) The require_roles(...) role guard rejects non-recruiters with 403.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("role", ["candidate", "employee"])
def test_role_guard_blocks_non_recruiters(role):
    guard = require_roles("recruiter", "super_admin")
    with pytest.raises(HTTPException) as exc:
        _run(guard(user=_denied(role)))  # type: ignore[call-arg]
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["recruiter", "super_admin"])
def test_authorised_roles_pass_role_guard(role):
    guard = require_roles("recruiter", "super_admin")
    user = super_admin if role == "super_admin" else recruiter_full
    assert _run(guard(user=user)) is user  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# 2) Capability-only deps ALONE let non-recruiters through (documents the bug).
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("role", ["candidate", "employee"])
def test_capability_only_dep_passes_non_recruiters(role):
    """require_capabilities returns non-recruiters unchanged — this is exactly
    the bypass that made the role guard mandatory on those routes."""
    fn = require_capabilities("employees")
    assert _run(fn(user=_denied(role))) is _denied(role)  # type: ignore[call-arg]


# --------------------------------------------------------------------------- #
# 3) Capability gating is preserved for recruiters (not weakened by the fix).
# --------------------------------------------------------------------------- #

def test_recruiter_without_capability_still_blocked():
    cap = require_capabilities("employees")
    with pytest.raises(HTTPException) as exc:
        _run(cap(user=recruiter_no_caps))  # type: ignore[call-arg]
    assert exc.value.status_code == 403


def test_super_admin_bypasses_capability_check():
    cap = require_capabilities("employees")
    assert _run(cap(user=super_admin)) is super_admin  # type: ignore[call-arg]


def test_recruiter_any_capability_blocking():
    fn = require_any_capability("org_config", "learning")
    with pytest.raises(HTTPException) as exc:
        _run(fn(user=recruiter_no_caps))  # type: ignore[call-arg]
    assert exc.value.status_code == 403


# --------------------------------------------------------------------------- #
# 4) The hardened route-dependency aliases all stack a require_roles(...) guard
#    first. Verify by importing every modified router and inspecting the alias.
# --------------------------------------------------------------------------- #

HARDENED_ALIASES = {
    "employees.RequireRecruiterWithEmployees": "app.api.employees",
    "employees.RequireRecruiterWithCandidates": "app.api.employees",
    "it_service_requests.RequireRecruiterWithIT": "app.api.it_service_requests",
    "it_provisioning.RequireRecruiterWithIT": "app.api.it_provisioning",
    "learning.RequireRecruiterWithLearning": "app.api.learning",
    "messages.RequireRecruiterWithMessages": "app.api.messages",
    "talent.RequireRecruiterWithTalent": "app.api.talent",
    "offers.RequireRecruiterWithInvite": "app.api.offers",
    "career_framework.RequireRecruiterWithTalentOrLearning": "app.api.career_framework",
    "documents.RequireRecruiterWithDocuments": "app.api.documents",
    "invitations.RequireInvite": "app.api.invitations",
    "email_templates.RequireRecruiterOrgConfig": "app.api.email_templates",
}


def test_all_routers_import():
    """Smoke test: every router module with hardened aliases imports cleanly
    (catches NameError/ImportError introduced by the audit fixes)."""
    for _, module in HARDENED_ALIASES.items():
        __import__(module, fromlist=["x"])


@pytest.mark.parametrize("qualified,module", list(HARDENED_ALIASES.items()))
def test_alias_starts_with_role_guard(qualified, module):
    _, alias = qualified.split(".")
    mod = __import__(module, fromlist=[alias])
    dep = getattr(mod, alias)
    args = typing.get_args(dep)
    depends = [a for a in args if getattr(a, "dependency", None) is not None]
    # The first Depends(...) must be require_roles(...) (role guard before caps).
    assert depends, f"{qualified}: alias has no Depends entries"
    first = getattr(depends[0], "dependency", None)
    assert first is not None, f"{qualified}: first dep has no inner callable"
    guard = first
    with pytest.raises(HTTPException) as exc:
        _run(guard(user=candidate))  # type: ignore[call-arg]
    assert exc.value.status_code == 403, f"{qualified}: role guard did not block candidate"
