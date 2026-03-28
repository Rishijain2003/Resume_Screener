import logging
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_settings_log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mongo_uri: str
    supabase_uri: str
    openai_api_key: str
    openai_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"

    mongo_db_name: str = "resume_screener"
    default_extraction_config_path: str = str(REPO_ROOT / "config" / "default_extraction.json")
    jd_config_path: str = str(REPO_ROOT / "config" / "jd_config.json")

    # MongoDB Atlas TLS: certifi fixes many handshake issues. Set MONGO_TLS_INSECURE=true only for debugging.
    mongo_tls_insecure: bool = False
    mongo_tls_ca_file: str | None = None
    # Many cloud VMs / corporate networks block OCSP checks to Atlas; disabling avoids bogus TLS handshake failures.
    mongo_tls_disable_ocsp_check: bool = True

    llm_max_parallel: int = 5
    simhash_near_duplicate_bits: int = 3

    # Comma-separated origins for browser clients (e.g. https://app.example.com). Empty = dev defaults in main.py.
    cors_allow_origins: str = ""

    # Logging for `app.*` loggers (DEBUG, INFO, WARNING, …). Overridable with env LOG_LEVEL.
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_default_extraction_config() -> dict:
    import json

    path = Path(get_settings().default_extraction_config_path)
    if not path.exists():
        _settings_log.warning("default extraction config missing: %s (using empty fields)", path)
        return {"version": 1, "fields": []}
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    _settings_log.debug("loaded default extraction config from %s", path)
    return data


def load_jd_config() -> dict:
    import json

    path = Path(get_settings().jd_config_path)
    if not path.exists():
        _settings_log.warning("jd_config missing: %s (using empty templates)", path)
        return {"version": 1, "templates": []}
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    _settings_log.debug("loaded jd_config from %s", path)
    return data
