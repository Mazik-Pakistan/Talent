"""Post-hire 'complete your profile' steps — filled in by a brand-new Employee
after HR approves their signed offer. Reuses the same field-level schemas as
the pre-offer candidate intake wizard for consistency.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.invitation import (
    OnboardingDocumentsAck,
    OnboardingEmergencyContact,
    OnboardingEmploymentInfo,
    OnboardingReferences,
    OnboardingSignature,
)

EMPLOYEE_PROFILE_STEPS = Literal["emergency", "employment", "references", "documents", "nda", "submit"]


class EmployeeProfileSaveRequest(BaseModel):
    step: EMPLOYEE_PROFILE_STEPS
    emergency: OnboardingEmergencyContact | None = None
    employment: OnboardingEmploymentInfo | None = None
    references: OnboardingReferences | None = None
    documents: OnboardingDocumentsAck | None = None
    nda: OnboardingSignature | None = None
