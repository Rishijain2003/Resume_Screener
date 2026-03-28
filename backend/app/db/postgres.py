import logging

import asyncpg
from fastapi import Request

from app.settings import get_settings

logger = logging.getLogger(__name__)


async def init_pool() -> asyncpg.Pool:
    settings = get_settings()
    logger.info("Postgres: creating pool (min=1 max=10, statement_cache_size=0)…")
    pool = await asyncpg.create_pool(
        settings.supabase_uri,
        min_size=1,
        max_size=10,
        statement_cache_size=0,
    )
    logger.info("Postgres: pool created OK.")
    return pool


async def close_pool(pool: asyncpg.Pool | None) -> None:
    if pool:
        logger.info("Postgres: closing pool…")
        await pool.close()
        logger.info("Postgres: pool closed.")


def pool_from_request(request: Request) -> asyncpg.Pool:
    pool = request.app.state.pg_pool
    if pool is None:
        logger.error("pool_from_request: PostgreSQL pool is None (lifespan not run?)")
        raise RuntimeError("PostgreSQL pool not initialized")
    return pool
