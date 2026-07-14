"""US-012: Role-based access control — permissions and role maps.

Story roles: Super Admin, Recruiter, Candidate (later transitions to Employee).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

# Permission codes used by API middleware and UI guards
PERMISSIONS: dict[str, str] = {
    "recruitment.view": "View recruitment modules",
    "recruitment.invite": "Create candidate invitations",
    "onboarding.self": "Complete personal onboarding",
    "onboarding.manage": "Manage candidate onboarding",
    "learning.access": "Access learning modules",
    "ai.access": "Access AI modules",
    "ai.coach": "Access AI Coach",
    "reporting.view": "View reporting",
    "profile.view": "View personal profile",
    "admin.access": "Access platform administration",
}

ALL_PERMISSIONS = frozenset(PERMISSIONS.keys())

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "super_admin": ALL_PERMISSIONS,
    "recruiter": frozenset(
        {
            "recruitment.view",
            "recruitment.invite",
            "onboarding.manage",
            "learning.access",
            "ai.access",
            "reporting.view",
            "profile.view",
        }
    ),
    # Candidate later transitions to Employee — same personal workspace permissions
    "candidate": frozenset(
        {
            "onboarding.self",
            "learning.access",
            "ai.coach",
            "profile.view",
        }
    ),
    "employee": frozenset(
        {
            "onboarding.self",
            "learning.access",
            "ai.coach",
            "profile.view",
        }
    ),
}

ROLE_HOME: dict[str, str] = {
    "super_admin": "/dashboard/super-admin",
    "recruiter": "/dashboard/recruiter",
    "candidate": "/dashboard/candidate",
    "employee": "/dashboard/employee",
}


@dataclass
class CurrentUser:
    id: str
    email: str
    full_name: str
    role: str
    access_token: str
    phone: str | None = None
    job_title: str | None = None
    department: str | None = None

    @property
    def permissions(self) -> frozenset[str]:
        return ROLE_PERMISSIONS.get(self.role, frozenset())

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions

    def has_any(self, permissions: Iterable[str]) -> bool:
        needed = set(permissions)
        return bool(self.permissions.intersection(needed))

    def has_all(self, permissions: Iterable[str]) -> bool:
        needed = set(permissions)
        return needed.issubset(self.permissions)
