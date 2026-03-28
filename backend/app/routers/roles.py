import logging
from uuid import UUID

import asyncpg
from asyncpg.exceptions import UniqueViolationError
from fastapi import APIRouter, HTTPException, Request

from app.db.postgres import pool_from_request
from app.schemas.dto import RoleCreate, RoleOut, RoleUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/roles", tags=["roles"])


def _row_to_role(row: asyncpg.Record) -> RoleOut:
    return RoleOut(
        id=row["id"],
        title=row["title"],
        jd_text=row["jd_text"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("", response_model=RoleOut)
async def create_role(body: RoleCreate, request: Request) -> RoleOut:
    pool = pool_from_request(request)
    logger.info("POST /roles create title=%r id=%s", body.title, body.id)
    try:
        if body.id is not None:
            row = await pool.fetchrow(
                """
                INSERT INTO roles (id, title, jd_text)
                VALUES ($1, $2, $3)
                RETURNING id, title, jd_text, created_at, updated_at
                """,
                body.id,
                body.title,
                body.jd_text,
            )
        else:
            row = await pool.fetchrow(
                """
                INSERT INTO roles (title, jd_text)
                VALUES ($1, $2)
                RETURNING id, title, jd_text, created_at, updated_at
                """,
                body.title,
                body.jd_text,
            )
    except UniqueViolationError as e:
        logger.warning("POST /roles conflict: duplicate id %s", body.id)
        raise HTTPException(status_code=409, detail="A role with this id already exists") from e
    assert row is not None
    logger.info("POST /roles OK role_id=%s", row["id"])
    return _row_to_role(row)


@router.delete("/{role_id}", status_code=204)
async def delete_role(role_id: UUID, request: Request) -> None:
    pool = pool_from_request(request)
    logger.info("DELETE /roles/%s", role_id)
    result = await pool.execute("DELETE FROM roles WHERE id = $1", role_id)
    if result == "DELETE 0":
        logger.warning("DELETE /roles/%s not found", role_id)
        raise HTTPException(status_code=404, detail="Role not found")
    logger.info("DELETE /roles/%s OK (candidates cascade in Postgres)", role_id)


@router.get("", response_model=list[RoleOut])
async def list_roles(request: Request) -> list[RoleOut]:
    pool = pool_from_request(request)
    rows = await pool.fetch(
        "SELECT id, title, jd_text, created_at, updated_at FROM roles ORDER BY created_at DESC"
    )
    logger.info("GET /roles -> %d row(s)", len(rows))
    return [_row_to_role(r) for r in rows]


@router.get("/applicant-counts", response_model=dict[str, int])
async def applicant_counts_by_role(request: Request) -> dict[str, int]:
    """How many resume uploads exist per role (from Postgres `candidates`)."""
    pool = pool_from_request(request)
    rows = await pool.fetch("SELECT role_id, COUNT(*)::bigint AS n FROM candidates GROUP BY role_id")
    out = {str(r["role_id"]): int(r["n"]) for r in rows}
    logger.info("GET /roles/applicant-counts -> %d role key(s)", len(out))
    return out


@router.get("/{role_id}", response_model=RoleOut)
async def get_role(role_id: UUID, request: Request) -> RoleOut:
    pool = pool_from_request(request)
    logger.info("GET /roles/%s", role_id)
    row = await pool.fetchrow(
        "SELECT id, title, jd_text, created_at, updated_at FROM roles WHERE id = $1",
        role_id,
    )
    if not row:
        logger.warning("GET /roles/%s not found", role_id)
        raise HTTPException(status_code=404, detail="Role not found")
    return _row_to_role(row)


@router.patch("/{role_id}", response_model=RoleOut)
async def update_role(role_id: UUID, body: RoleUpdate, request: Request) -> RoleOut:
    pool = pool_from_request(request)
    logger.info("PATCH /roles/%s title=%s jd_len=%s", role_id, body.title is not None, body.jd_text is not None)
    existing = await pool.fetchrow("SELECT id, title, jd_text FROM roles WHERE id = $1", role_id)
    if not existing:
        logger.warning("PATCH /roles/%s not found", role_id)
        raise HTTPException(status_code=404, detail="Role not found")
    title = body.title if body.title is not None else existing["title"]
    jd_text = body.jd_text if body.jd_text is not None else existing["jd_text"]
    row = await pool.fetchrow(
        """
        UPDATE roles SET title = $2, jd_text = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, jd_text, created_at, updated_at
        """,
        role_id,
        title,
        jd_text,
    )
    assert row is not None
    await pool.execute(
        "UPDATE candidates SET role_title = $2, updated_at = NOW() WHERE role_id = $1",
        role_id,
        title,
    )
    logger.info("PATCH /roles/%s OK; synced role_title on candidates", role_id)
    return _row_to_role(row)
