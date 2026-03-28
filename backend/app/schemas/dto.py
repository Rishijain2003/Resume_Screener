from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

ScoreBasis = Literal["full_resume", "extracted_values"]


class RoleCreate(BaseModel):
    id: UUID | None = None
    title: str = Field(min_length=1, max_length=500)
    jd_text: str = ""


class RoleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    jd_text: str | None = None


class RoleOut(BaseModel):
    id: UUID
    title: str
    jd_text: str
    created_at: Any
    updated_at: Any


class UploadResponse(BaseModel):
    candidate_id: UUID | None = None
    duplicate_exact: bool = False
    near_duplicate_warning: str | None = None
    message: str = ""


class ScoreRequest(BaseModel):
    candidate_id: UUID
    score_basis: ScoreBasis = "full_resume"


class RescanRequest(BaseModel):
    role_id: UUID
    extraction_config: dict[str, Any] = Field(
        ...,
        description='Same shape as UI "extraction config": version + fields array.',
    )


class ExtractRequest(BaseModel):
    candidate_id: UUID
    extraction_config: dict[str, Any] = Field(
        ...,
        description='Same shape as UI "extraction config": version + fields array (non-empty fields).',
    )


class RankMultiRequest(BaseModel):
    candidate_id: UUID
    role_ids: list[UUID] = Field(min_length=1)


class CandidateSummary(BaseModel):
    id: UUID
    role_id: UUID
    role_title: str
    name: str | None
    score: int | None
    justification: str | None
    parse_status: str
    duplicate_warning: str | None
    extracted_data: dict[str, Any]
    created_at: Any
    # Same as DB actual_hash / normalized_hash (document fingerprint for dedupe)
    file_hash: str
    content_hash: str


class ResumeLibraryItem(BaseModel):
    """One uploaded resume row joined with its job role (Postgres metadata; file bytes in GridFS)."""

    candidate_id: UUID
    role_id: UUID
    role_title: str
    name: str | None
    original_filename: str | None
    mime_type: str | None
    score: int | None
    parse_status: str
    created_at: Any
