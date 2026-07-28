from pydantic import BaseModel, Field


class CreateFromCandidateRequest(BaseModel):
    candidate_id: str = Field(min_length=1, max_length=64)


class GenerateEmployeeIdRequest(BaseModel):
    """Optional year override (ignored — IDs are global EMP-000001)."""

    year: int | None = Field(default=None, ge=2000, le=2100)
