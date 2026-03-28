import asyncio
import json
import logging
from uuid import UUID

import asyncpg
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.services import llm_extract, llm_score
from app.services.hashing import hamming_distance_hex, simhash_hex
from app.services.parsing import ParseError, extract_text
from app.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class CandidateNotFoundError(Exception):
    pass


def _pg_extracted_dict(ed) -> dict:
    if isinstance(ed, str):
        return json.loads(ed)
    return dict(ed or {})


async def extract_candidate_fields(
    pool: asyncpg.Pool,
    gridfs: AsyncIOMotorGridFSBucket,
    candidate_id: UUID,
    extraction_config: dict,
) -> None:
    """Load file from GridFS, parse text, run LLM extraction; set parse_status parsed (clears score)."""
    from bson import ObjectId
    from bson.errors import InvalidId

    settings = get_settings()
    fields = extraction_config.get("fields") or []
    if not isinstance(fields, list) or len(fields) == 0:
        raise ValueError("extraction_config.fields must be a non-empty array")

    row = await pool.fetchrow(
        "SELECT id, role_id, mongo_file_id, original_filename FROM candidates WHERE id = $1",
        candidate_id,
    )
    if not row:
        raise CandidateNotFoundError()

    cid = row["id"]
    fname = row["original_filename"] or "resume.bin"
    logger.info("pipeline.extract START candidate_id=%s file=%r", cid, fname)

    try:
        oid = ObjectId(row["mongo_file_id"])
    except InvalidId:
        logger.warning("pipeline.extract INVALID_MONGO_ID candidate_id=%s", cid)
        await pool.execute(
            "UPDATE candidates SET error_message = $2, parse_status = 'failed', updated_at = NOW() WHERE id = $1",
            cid,
            "Invalid GridFS file id.",
        )
        raise RuntimeError("Invalid stored file id for this candidate.") from None

    try:
        stream = await gridfs.open_download_stream(oid)
        data = await stream.read()
    except Exception as exc:
        logger.exception("pipeline.extract GRIDFS_FAIL candidate_id=%s", cid)
        await pool.execute(
            "UPDATE candidates SET error_message = $2, parse_status = 'failed', updated_at = NOW() WHERE id = $1",
            cid,
            "Could not load file from storage.",
        )
        raise RuntimeError(f"Could not read stored file: {exc}") from exc

    try:
        text = extract_text(fname, data)
    except ParseError as e:
        logger.warning("pipeline.extract PARSE_FAIL candidate_id=%s: %s", cid, e)
        await pool.execute(
            "UPDATE candidates SET parse_status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1",
            cid,
            str(e),
        )
        raise

    preview = text[:4000]
    extracted = await llm_extract.extract_resume_fields(settings, text, fields)
    name = None
    if isinstance(extracted, dict):
        name = extracted.get("full_name") or extracted.get("name")

    norm = simhash_hex(text)
    warn = await _fetch_near_duplicate_warning(
        pool, row["role_id"], norm, cid, settings
    )

    await pool.execute(
        """
        UPDATE candidates SET
            name = COALESCE($2, name),
            extracted_data = $3::jsonb,
            config_snapshot = $4::jsonb,
            normalized_hash = $6,
            duplicate_warning = $7,
            score = NULL,
            justification = NULL,
            parse_status = 'parsed',
            raw_text_preview = $5,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $1
        """,
        cid,
        name,
        json.dumps(extracted),
        json.dumps(extraction_config),
        preview,
        norm,
        warn,
    )
    logger.info("pipeline.extract DONE candidate_id=%s status=parsed", cid)


async def score_one_candidate(
    pool: asyncpg.Pool,
    gridfs: AsyncIOMotorGridFSBucket,
    candidate_id: UUID,
    score_basis: str,
) -> None:
    """Compute fit score and UPDATE the candidate row (parse_status → completed)."""
    from bson import ObjectId
    from bson.errors import InvalidId

    settings = get_settings()
    row = await pool.fetchrow(
        """
        SELECT c.id, c.mongo_file_id, c.original_filename, c.extracted_data, c.parse_status, r.jd_text
        FROM candidates c JOIN roles r ON r.id = c.role_id
        WHERE c.id = $1
        """,
        candidate_id,
    )
    if not row:
        raise CandidateNotFoundError()

    status = row["parse_status"] or ""
    if status == "failed":
        raise RuntimeError("This candidate is in a failed state; fix the file or re-upload before scoring.")
    if status not in ("uploaded", "parsed", "completed", "pending"):
        raise RuntimeError(f"Cannot score while status is {status!r}; wait for upload to finish or run Extract first.")

    jd_text = row["jd_text"]
    if score_basis == "extracted_values":
        if status != "parsed":
            raise RuntimeError(
                "Scoring from extracted values requires status 'parsed'. Use Extract fields for this candidate first."
            )
        extracted = _pg_extracted_dict(row["extracted_data"])
        fit = await llm_score.score_jd_against_extracted(settings, jd_text, extracted)
    else:
        fname = row["original_filename"] or "resume.bin"
        try:
            oid = ObjectId(row["mongo_file_id"])
        except InvalidId as e:
            raise RuntimeError("Invalid GridFS file id for this candidate.") from e
        try:
            stream = await gridfs.open_download_stream(oid)
            file_bytes = await stream.read()
        except Exception as exc:
            raise RuntimeError(f"Could not read stored file: {exc}") from exc
        text = extract_text(fname, file_bytes)
        fit = await llm_score.score_resume_against_jd(settings, text, jd_text)

    await pool.execute(
        """
        UPDATE candidates SET score = $2, justification = $3, parse_status = 'completed', updated_at = NOW()
        WHERE id = $1
        """,
        candidate_id,
        fit.score,
        fit.justification,
    )
    logger.info("pipeline.score_one_candidate OK candidate_id=%s score=%s", candidate_id, fit.score)


async def _fetch_near_duplicate_warning(
    pool: asyncpg.Pool,
    role_id: UUID,
    normalized_hash: str,
    exclude_candidate_id: UUID | None,
    settings: Settings,
) -> str | None:
    rows = await pool.fetch(
        "SELECT id, normalized_hash FROM candidates WHERE role_id = $1",
        role_id,
    )
    logger.debug(
        "near_duplicate_check role_id=%s compare_against=%d row(s)",
        role_id,
        len(rows),
    )
    pending_placeholder = "0" * 16
    if normalized_hash == pending_placeholder:
        return None
    for r in rows:
        if exclude_candidate_id and r["id"] == exclude_candidate_id:
            continue
        other = r["normalized_hash"]
        if not other or other == pending_placeholder:
            continue
        if hamming_distance_hex(normalized_hash, other) <= settings.simhash_near_duplicate_bits:
            logger.info("near_duplicate_match role_id=%s vs candidate_id=%s", role_id, r["id"])
            return (
                f"Near-duplicate content detected (similar to candidate {r['id']}). "
                "File hash differs but text fingerprint is close."
            )
    return None


async def rescan_role_candidates(
    pool: asyncpg.Pool,
    gridfs: AsyncIOMotorGridFSBucket,
    role_id: UUID,
    extraction_config: dict,
) -> None:
    settings = get_settings()
    fields = extraction_config.get("fields") or []
    rows = await pool.fetch(
        """SELECT id, mongo_file_id, original_filename FROM candidates
           WHERE role_id = $1 AND parse_status != 'skipped_duplicate'""",
        role_id,
    )
    logger.info("pipeline.rescan START role_id=%s candidates=%d parallel=%d", role_id, len(rows), settings.llm_max_parallel)

    sem = asyncio.Semaphore(settings.llm_max_parallel)

    async def one(row: asyncpg.Record) -> None:
        async with sem:
            cid = row["id"]
            fname = row["original_filename"] or "resume.bin"
            logger.info("pipeline.rescan candidate_id=%s file=%r", cid, fname)
            from bson import ObjectId
            from bson.errors import InvalidId

            try:
                oid = ObjectId(row["mongo_file_id"])
            except InvalidId:
                logger.warning("pipeline.rescan INVALID_MONGO_ID candidate_id=%s", cid)
                await pool.execute(
                    "UPDATE candidates SET error_message = $2, parse_status = 'failed', updated_at = NOW() WHERE id = $1",
                    cid,
                    "Invalid GridFS file id for rescan.",
                )
                return
            try:
                stream = await gridfs.open_download_stream(oid)
                data = await stream.read()
            except Exception:
                logger.exception("pipeline.rescan GRIDFS_FAIL candidate_id=%s", cid)
                await pool.execute(
                    "UPDATE candidates SET error_message = $2, parse_status = 'failed', updated_at = NOW() WHERE id = $1",
                    cid,
                    "Could not load file from storage for rescan.",
                )
                return
            try:
                text = extract_text(fname, data)
            except ParseError as e:
                logger.warning("pipeline.rescan PARSE_FAIL candidate_id=%s: %s", cid, e)
                await pool.execute(
                    "UPDATE candidates SET parse_status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1",
                    cid,
                    str(e),
                )
                return
            extracted = await llm_extract.extract_resume_fields(settings, text, fields)
            name = None
            if isinstance(extracted, dict):
                name = extracted.get("full_name") or extracted.get("name")
            preview = text[:4000]
            await pool.execute(
                """
                UPDATE candidates SET
                    name = COALESCE($2, name),
                    extracted_data = $3::jsonb,
                    config_snapshot = $4::jsonb,
                    score = NULL,
                    justification = NULL,
                    parse_status = 'parsed',
                    raw_text_preview = $5,
                    error_message = NULL,
                    updated_at = NOW()
                WHERE id = $1
                """,
                cid,
                name,
                json.dumps(extracted),
                json.dumps(extraction_config),
                preview,
            )
            logger.info("pipeline.rescan DONE candidate_id=%s status=parsed", cid)

    await asyncio.gather(*[one(r) for r in rows])
    logger.info("pipeline.rescan FINISHED role_id=%s processed=%d", role_id, len(rows))


async def score_candidate_against_other_roles(
    pool: asyncpg.Pool,
    gridfs: AsyncIOMotorGridFSBucket,
    candidate_id: UUID,
    target_role_ids: list[UUID],
) -> list[dict]:
    settings = get_settings()
    logger.info(
        "pipeline.rank_multi START candidate_id=%s targets=%d",
        candidate_id,
        len(target_role_ids),
    )
    row = await pool.fetchrow(
        "SELECT mongo_file_id, original_filename FROM candidates WHERE id = $1",
        candidate_id,
    )
    if not row:
        logger.warning("pipeline.rank_multi candidate not found candidate_id=%s", candidate_id)
        return []
    fname = row["original_filename"] or "resume.bin"
    from bson import ObjectId

    data = None
    try:
        oid = ObjectId(row["mongo_file_id"])
        stream = await gridfs.open_download_stream(oid)
        data = await stream.read()
    except Exception:
        logger.exception("pipeline.rank_multi GRIDFS_FAIL candidate_id=%s", candidate_id)
        pass
    if data is None:
        logger.warning("pipeline.rank_multi no file bytes candidate_id=%s", candidate_id)
        return [{"role_id": str(rid), "error": "file_not_found"} for rid in target_role_ids]
    try:
        text = extract_text(fname, data)
    except ParseError as e:
        logger.warning("pipeline.rank_multi PARSE_FAIL candidate_id=%s: %s", candidate_id, e)
        return [{"role_id": str(rid), "error": str(e)} for rid in target_role_ids]

    logger.info("pipeline.rank_multi text_len=%d scoring…", len(text))
    sem = asyncio.Semaphore(settings.llm_max_parallel)
    results: list[dict] = []

    async def score_one(rid: UUID) -> dict:
        async with sem:
            role = await pool.fetchrow("SELECT jd_text, title FROM roles WHERE id = $1", rid)
            if not role:
                logger.warning("pipeline.rank_multi role_not_found role_id=%s", rid)
                return {"role_id": str(rid), "error": "role_not_found"}
            fit = await llm_score.score_resume_against_jd(settings, text, role["jd_text"])
            logger.info(
                "pipeline.rank_multi scored role_id=%s title=%r score=%s",
                rid,
                role["title"],
                fit.score,
            )
            return {
                "role_id": str(rid),
                "role_title": role["title"],
                "score": fit.score,
                "justification": fit.justification,
            }

    results = await asyncio.gather(*[score_one(rid) for rid in target_role_ids])
    logger.info("pipeline.rank_multi DONE candidate_id=%s results=%d", candidate_id, len(results))
    return list(results)
