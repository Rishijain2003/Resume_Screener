import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.mongo import make_mongo_client
from app.db.postgres import close_pool, init_pool
from app.logging_config import configure_app_logging
from app.middleware.request_logging import RequestLoggingMiddleware
from app.routers import candidates, roles
from app.settings import get_settings

_settings = get_settings()
configure_app_logging(_settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Lifespan: initializing PostgreSQL pool…")
    app.state.pg_pool = await init_pool()
    logger.info("Lifespan: PostgreSQL pool ready.")
    logger.info("Lifespan: creating MongoDB client…")
    app.state.mongo_client = make_mongo_client()
    try:
        await app.state.mongo_client.admin.command("ping")
        logger.info("MongoDB ping OK (GridFS uploads enabled).")
    except Exception as exc:
        logger.error(
            "MongoDB ping failed — resume uploads will error until this is fixed: %s. "
            "Check Atlas Network Access (IP allowlist), MONGO_URI, and .env TLS flags "
            "(MONGO_TLS_DISABLE_OCSP_CHECK, MONGO_TLS_INSECURE).",
            exc,
        )
    yield
    logger.info("Lifespan: shutting down — closing Postgres pool and Mongo client.")
    await close_pool(app.state.pg_pool)
    await app.state.mongo_client.close()
    logger.info("Lifespan: cleanup done.")


app = FastAPI(title="Sprinto Resume Screener API", lifespan=lifespan)

_cors_env = [o.strip() for o in get_settings().cors_allow_origins.split(",") if o.strip()]
_cors_origins = _cors_env or [
    "http://localhost:1830",
    "http://127.0.0.1:1830",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(roles.router, prefix="/api")
app.include_router(candidates.router, prefix="/api")


@app.get("/health")
async def health() -> dict:
    logger.debug("GET /health")
    return {"status": "ok"}
