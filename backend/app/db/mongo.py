import logging
import os

import certifi
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket

from app.settings import get_settings

logger = logging.getLogger(__name__)


def make_mongo_client() -> AsyncIOMotorClient:
    settings = get_settings()
    ca_path = settings.mongo_tls_ca_file or certifi.where()
    # Ensure OpenSSL-backed stacks see the same CA bundle PyMongo uses.
    os.environ.setdefault("SSL_CERT_FILE", ca_path)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", ca_path)

    kwargs: dict = {
        "tlsCAFile": ca_path,
        "serverSelectionTimeoutMS": 25_000,
    }
    if settings.mongo_tls_insecure:
        kwargs["tlsAllowInvalidCertificates"] = True
    if settings.mongo_tls_disable_ocsp_check:
        kwargs["tlsDisableOCSPEndpointCheck"] = True
    logger.info(
        "MongoDB: creating client (db=%s, bucket=resume_files, tls_insecure=%s, disable_ocsp=%s)…",
        settings.mongo_db_name,
        settings.mongo_tls_insecure,
        settings.mongo_tls_disable_ocsp_check,
    )
    client = AsyncIOMotorClient(settings.mongo_uri, **kwargs)
    logger.info("MongoDB: AsyncIOMotorClient constructed (connections are lazy until first op).")
    return client


def gridfs_for_client(client: AsyncIOMotorClient) -> AsyncIOMotorGridFSBucket:
    settings = get_settings()
    db = client[settings.mongo_db_name]
    logger.debug("MongoDB: GridFS bucket resume_files on database %s", settings.mongo_db_name)
    return AsyncIOMotorGridFSBucket(db, bucket_name="resume_files")
