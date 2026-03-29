import json
import logging
import re
from io import BytesIO
from pathlib import Path
from uuid import UUID

import asyncpg
from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, Request, UploadFile
from pymongo.errors import PyMongoError
from starlette.responses import Response

from app.db.mongo import gridfs_for_client
from app.db.postgres import pool_from_request
from app.schemas.dto import (
    CandidateSummary,
    RankMultiRequest,
    RescanRequest,
    ResumeLibraryItem,
    ExtractRequest,
    ScoreRequest,
    UploadResponse,
)
from app.services.hashing import sha256_bytes
from app.services.parsing import ParseError, extract_text
from app.services.pipeline import (
    CandidateNotFoundError,
    extract_candidate_fields,
    rescan_role_candidates,
    score_candidate_against_other_roles,
    score_one_candidate,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["candidates"])

_SCORE_BASIS_VALUES = frozenset({"full_resume", "extracted_values"})


def _normalize_score_basis(raw: str) -> str:
    if raw not in _SCORE_BASIS_VALUES:
        raise HTTPException(
            status_code=400,
            detail="score_basis must be 'full_resume' or 'extracted_values'.",
        )
    return raw


async def _get_role_config(pool: asyncpg.Pool, role_id: UUID) -> asyncpg.Record | None:
    return await pool.fetchrow("SELECT id, title, jd_text FROM roles WHERE id = $1", role_id)


def _cfg_fields(cfg) -> list:
    if isinstance(cfg, str):
        cfg = json.loads(cfg)
    return cfg.get("fields") or []


def _upload_config_json(raw: str | None) -> str:
    if not raw or not str(raw).strip():
        return json.dumps({"version": 1, "fields": []})
    try:
        cfg = json.loads(raw)
    except json.JSONDecodeError:
        return json.dumps({"version": 1, "fields": []})
    if not isinstance(cfg, dict):
        return json.dumps({"version": 1, "fields": []})
    if not isinstance(cfg.get("fields"), list):
        cfg = dict(cfg)
        cfg["fields"] = []
    return json.dumps(cfg)


def _extracted_dict(ed) -> dict:
    if isinstance(ed, str):
        return json.loads(ed)
    return ed or {}


def _mongo_storage_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=(
            "MongoDB (file storage) is unreachable — the resume was not saved. "
            "In Atlas: Network Access → allow this host's public IP (or 0.0.0.0/0 for testing). "
            "Check MONGO_URI. For TLS errors on Linux/cloud VMs, keep MONGO_TLS_DISABLE_OCSP_CHECK=true (default) "
            "or set MONGO_TLS_INSECURE=true only for local debugging. "
            f"Underlying error: {exc!s}"
        ),
    )


def _safe_attachment_filename(name: str | None) -> str:
    raw = (name or "resume").strip() or "resume"
    safe = re.sub(r"[^\w.\-()+@% ]+", "_", raw, flags=re.UNICODE).strip("._") or "resume"
    return safe[:200]


@router.get("/candidates/library", response_model=list[ResumeLibraryItem])
async def list_resume_library(
    request: Request,
    role_id: UUID | None = Query(default=None, description="If set, only applicants for this role."),
) -> list[ResumeLibraryItem]:
    """List resume uploads from Postgres with job role title; binary files live in MongoDB GridFS (mongo_file_id)."""
    pool = pool_from_request(request)
    logger.info("GET /candidates/library role_id=%s", role_id)
    if role_id is not None:
        rows = await pool.fetch(
            """
            SELECT c.id, c.role_id,
                   COALESCE(NULLIF(btrim(c.role_title), ''), r.title) AS role_title,
                   c.name, c.original_filename, c.mime_type,
                   c.score, c.parse_status, c.created_at
            FROM candidates c
            JOIN roles r ON r.id = c.role_id
            WHERE c.role_id = $1
            ORDER BY c.created_at DESC
            """,
            role_id,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT c.id, c.role_id,
                   COALESCE(NULLIF(btrim(c.role_title), ''), r.title) AS role_title,
                   c.name, c.original_filename, c.mime_type,
                   c.score, c.parse_status, c.created_at
            FROM candidates c
            JOIN roles r ON r.id = c.role_id
            ORDER BY c.created_at DESC
            LIMIT 500
            """,
        )
    out: list[ResumeLibraryItem] = []
    for r in rows:
        out.append(
            ResumeLibraryItem(
                candidate_id=r["id"],
                role_id=r["role_id"],
                role_title=r["role_title"],
                name=r["name"],
                original_filename=r["original_filename"],
                mime_type=r["mime_type"],
                score=r["score"],
                parse_status=r["parse_status"],
                created_at=r["created_at"],
            )
        )
    logger.info("GET /candidates/library -> %d item(s)", len(out))
    return out


@router.get("/candidates/{candidate_id}/file")
async def download_candidate_file(candidate_id: UUID, request: Request) -> Response:
    """Stream the original upload from GridFS using mongo_file_id stored on the candidate row."""
    pool = pool_from_request(request)
    client = request.app.state.mongo_client
    gridfs = gridfs_for_client(client)
    logger.info("GET /candidates/%s/file", candidate_id)
    row = await pool.fetchrow(
        "SELECT mongo_file_id, original_filename, mime_type FROM candidates WHERE id = $1",
        candidate_id,
    )
    if not row:
        logger.warning("GET /candidates/%s/file: candidate not in Postgres", candidate_id)
        raise HTTPException(status_code=404, detail="Candidate not found")
    try:
        oid = ObjectId(row["mongo_file_id"])
        stream = await gridfs.open_download_stream(oid)
        data = await stream.read()
    except Exception as exc:
        logger.exception("GET /candidates/%s/file: GridFS read failed", candidate_id)
        raise HTTPException(status_code=400, detail=f"Could not read stored file: {exc}") from exc
    logger.info("GET /candidates/%s/file OK bytes=%d", candidate_id, len(data))
    fname = _safe_attachment_filename(row["original_filename"])
    media = row["mime_type"] or "application/octet-stream"
    return Response(
        content=data,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
        },
    )


@router.post("/upload", response_model=UploadResponse)
async def upload_resume(
    request: Request,
    role_id: UUID = Form(...),
    file: UploadFile = File(...),
    extraction_config: str | None = Form(
        default=None,
        description='Optional JSON snapshot of extraction fields (can be empty). Extraction runs only via POST /extract.',
    ),
) -> UploadResponse:
    pool = pool_from_request(request)
    client = request.app.state.mongo_client
    gridfs = gridfs_for_client(client)

    logger.info(
        "POST /upload role_id=%s filename=%r content_type=%s",
        role_id,
        file.filename,
        file.content_type,
    )
    role = await _get_role_config(pool, role_id)
    if not role:
        logger.warning("POST /upload role_id=%s not found", role_id)
        raise HTTPException(status_code=404, detail="Role not found")

    data = await file.read()
    if not data:
        logger.warning("POST /upload empty file role_id=%s", role_id)
        raise HTTPException(status_code=400, detail="Empty file")
    logger.info("POST /upload read %d byte(s) from client", len(data))

    upload_name = file.filename or "resume.bin"
    suffix = Path(upload_name).suffix.lower()
    if suffix in (".pdf", ".docx"):
        try:
            parsed_text = extract_text(upload_name, data)
        except ParseError as e:
            logger.warning("POST /upload parse rejected filename=%r: %s", upload_name, e)
            raise HTTPException(status_code=400, detail=str(e)) from e
        if not parsed_text.strip():
            msg = (
                "This file has no readable text. It may be empty, or contain only image-based (scanned) "
                "text that could not be extracted."
            )
            logger.warning("POST /upload no extractable text filename=%r", upload_name)
            raise HTTPException(status_code=400, detail=msg)

    actual = sha256_bytes(data)
    existing = await pool.fetchrow(
        "SELECT id FROM candidates WHERE role_id = $1 AND actual_hash = $2",
        role_id,
        actual,
    )
    if existing:
        logger.info("POST /upload exact duplicate role_id=%s candidate_id=%s", role_id, existing["id"])
        return UploadResponse(
            candidate_id=existing["id"],
            duplicate_exact=True,
            message=(
                "This resume is already in the database for this role (same file hash). "
                f"Existing candidate id: {existing['id']}. No new row was created."
            ),
        )

    # Content SimHash and near-duplicate checks run after POST /extract (when text is parsed).
    norm_hash = "0" * 16
    warn = None

    cfg_json = _upload_config_json(extraction_config)
    logger.info("POST /upload config_snapshot field count=%d", len(_cfg_fields(cfg_json)))

    try:
        file_id = await gridfs.upload_from_stream(
            upload_name,
            BytesIO(data),
            metadata={"role_id": str(role_id), "content_type": file.content_type or ""},
        )
    except PyMongoError as exc:
        logger.exception("POST /upload GridFS upload failed role_id=%s", role_id)
        raise _mongo_storage_error(exc) from exc
    mongo_id = str(file_id)
    logger.info("POST /upload GridFS OK file_id=%s", mongo_id)

    row = await pool.fetchrow(
        """
        INSERT INTO candidates (
            role_id, role_title, actual_hash, normalized_hash, mongo_file_id,
            original_filename, mime_type, extracted_data, config_snapshot,
            parse_status, duplicate_warning, raw_text_preview
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, $8::jsonb, 'uploaded', $9, $10
        )
        RETURNING id
        """,
        role_id,
        role["title"],
        actual,
        norm_hash,
        mongo_id,
        upload_name,
        file.content_type,
        cfg_json,
        warn,
        None,
    )
    assert row is not None
    cid = row["id"]
    logger.info("POST /upload Postgres INSERT candidate_id=%s status=uploaded (no extract/score)", cid)

    return UploadResponse(
        candidate_id=cid,
        duplicate_exact=False,
        near_duplicate_warning=warn,
        message=(
            "Stored in the database: new candidate id, file hash (fingerprint), and file bytes in object storage. "
            "Use Extract fields for this row, then score only that candidate when ready."
        ),
    )


@router.get("/results", response_model=list[CandidateSummary])
async def list_results(role_id: UUID, request: Request) -> list[CandidateSummary]:
    pool = pool_from_request(request)
    logger.info("GET /results role_id=%s", role_id)
    rows = await pool.fetch(
        """
        SELECT id, role_id, role_title, name, score, justification, parse_status, duplicate_warning,
               extracted_data, created_at, actual_hash, normalized_hash
        FROM candidates
        WHERE role_id = $1
        ORDER BY score DESC NULLS LAST, created_at DESC
        """,
        role_id,
    )
    out: list[CandidateSummary] = []
    for r in rows:
        out.append(
            CandidateSummary(
                id=r["id"],
                role_id=r["role_id"],
                role_title=r["role_title"] or "",
                name=r["name"],
                score=r["score"],
                justification=r["justification"],
                parse_status=r["parse_status"],
                duplicate_warning=r["duplicate_warning"],
                extracted_data=_extracted_dict(r["extracted_data"]),
                created_at=r["created_at"],
                file_hash=r["actual_hash"],
                content_hash=r["normalized_hash"],
            )
        )
    logger.info("GET /results role_id=%s -> %d candidate(s)", role_id, len(out))
    return out


@router.post("/extract", response_model=CandidateSummary)
async def extract_one(body: ExtractRequest, request: Request) -> CandidateSummary:
    pool = pool_from_request(request)
    client = request.app.state.mongo_client
    gridfs = gridfs_for_client(client)

    logger.info("POST /extract candidate_id=%s", body.candidate_id)
    try:
        await extract_candidate_fields(pool, gridfs, body.candidate_id, body.extraction_config)
    except CandidateNotFoundError:
        raise HTTPException(status_code=404, detail="Candidate not found") from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ParseError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    r = await pool.fetchrow(
        """
        SELECT id, role_id, role_title, name, score, justification, parse_status, duplicate_warning,
               extracted_data, created_at, actual_hash, normalized_hash
        FROM candidates WHERE id = $1
        """,
        body.candidate_id,
    )
    assert r is not None
    logger.info("POST /extract OK candidate_id=%s", body.candidate_id)
    return CandidateSummary(
        id=r["id"],
        role_id=r["role_id"],
        role_title=r["role_title"] or "",
        name=r["name"],
        score=r["score"],
        justification=r["justification"],
        parse_status=r["parse_status"],
        duplicate_warning=r["duplicate_warning"],
        extracted_data=_extracted_dict(r["extracted_data"]),
        created_at=r["created_at"],
        file_hash=r["actual_hash"],
        content_hash=r["normalized_hash"],
    )


@router.post("/score", response_model=CandidateSummary)
async def rescore_one(body: ScoreRequest, request: Request) -> CandidateSummary:
    pool = pool_from_request(request)
    client = request.app.state.mongo_client
    gridfs = gridfs_for_client(client)

    logger.info("POST /score candidate_id=%s", body.candidate_id)
    basis = _normalize_score_basis(body.score_basis)
    try:
        await score_one_candidate(pool, gridfs, body.candidate_id, basis)
    except CandidateNotFoundError:
        logger.warning("POST /score candidate_id=%s not found", body.candidate_id)
        raise HTTPException(status_code=404, detail="Candidate not found") from None
    except ParseError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    r = await pool.fetchrow(
        """
        SELECT id, role_id, role_title, name, score, justification, parse_status, duplicate_warning,
               extracted_data, created_at, actual_hash, normalized_hash
        FROM candidates WHERE id = $1
        """,
        body.candidate_id,
    )
    assert r is not None
    logger.info("POST /score OK candidate_id=%s", body.candidate_id)
    return CandidateSummary(
        id=r["id"],
        role_id=r["role_id"],
        role_title=r["role_title"] or "",
        name=r["name"],
        score=r["score"],
        justification=r["justification"],
        parse_status=r["parse_status"],
        duplicate_warning=r["duplicate_warning"],
        extracted_data=_extracted_dict(r["extracted_data"]),
        created_at=r["created_at"],
        file_hash=r["actual_hash"],
        content_hash=r["normalized_hash"],
    )


@router.post("/rescan")
async def rescan_role(
    body: RescanRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    pool = pool_from_request(request)
    client = request.app.state.mongo_client
    gridfs = gridfs_for_client(client)

    logger.info("POST /rescan role_id=%s", body.role_id)
    role = await pool.fetchrow("SELECT id FROM roles WHERE id = $1", body.role_id)
    if not role:
        logger.warning("POST /rescan role_id=%s not found", body.role_id)
        raise HTTPException(status_code=404, detail="Role not found")

    cfg = body.extraction_config
    fields = cfg.get("fields") if isinstance(cfg, dict) else None
    if not isinstance(fields, list) or len(fields) == 0:
        raise HTTPException(
            status_code=400,
            detail="extraction_config.fields must be a non-empty array.",
        )

    background_tasks.add_task(
        rescan_role_candidates,
        pool,
        gridfs,
        body.role_id,
        cfg,
    )
    logger.info("POST /rescan background task scheduled role_id=%s", body.role_id)
    return {"status": "started", "role_id": str(body.role_id)}


@router.post("/rank-multi")
async def rank_multi(body: RankMultiRequest, request: Request) -> dict:
    pool = pool_from_request(request)
    client = request.app.state.mongo_client
    gridfs = gridfs_for_client(client)
    logger.info(
        "POST /rank-multi candidate_id=%s target_roles=%d",
        body.candidate_id,
        len(body.role_ids),
    )
    results = await score_candidate_against_other_roles(
        pool, gridfs, body.candidate_id, body.role_ids
    )
    logger.info("POST /rank-multi done candidate_id=%s result_count=%d", body.candidate_id, len(results))
    return {"results": results}


@router.get("/config/default-extraction")
async def default_extraction() -> dict:
    from app.settings import load_default_extraction_config

    logger.debug("GET /config/default-extraction")
    return load_default_extraction_config()


@router.get("/config/jd-templates")
async def jd_templates() -> dict:
    """Serve config/jd_config.json for UI template import."""
    from app.settings import load_jd_config

    logger.debug("GET /config/jd-templates")
    return load_jd_config()
