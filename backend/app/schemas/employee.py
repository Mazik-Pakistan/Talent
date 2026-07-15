from pydantic import BaseModel, Field


class CreateFromCandidateRequest(BaseModel):
    candidate_id: str = Field(min_length=1, max_length=64)


class GenerateEmployeeIdRequest(BaseModel):
    """Optional year override; defaults to current UTC year."""

    year: int | None = Field(default=None, ge=2000, le=2100)
