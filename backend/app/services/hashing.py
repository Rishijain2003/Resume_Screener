import hashlib
import logging
import re

from simhash import Simhash

logger = logging.getLogger(__name__)

_WS_PUNCT = re.compile(r"[\s\W]+", re.UNICODE)


def sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256(data).hexdigest()
    logger.debug("hash sha256 bytes=%d prefix=%s…", len(data), h[:12])
    return h


def normalize_text_for_simhash(text: str) -> str:
    lowered = text.lower().strip()
    collapsed = _WS_PUNCT.sub(" ", lowered)
    return collapsed.strip()


def simhash_hex(text: str) -> str:
    normalized = normalize_text_for_simhash(text)
    if not normalized:
        logger.debug("hash simhash empty text -> zero fingerprint")
        return "0" * 16
    hx = format(Simhash(normalized).value, "016x")
    logger.debug("hash simhash text_chars=%d norm_chars=%d hex=%s", len(text), len(normalized), hx)
    return hx


def simhash_int_from_hex(h: str) -> int:
    return int(h, 16)


def hamming_distance_hex(a: str, b: str) -> int:
    ia = simhash_int_from_hex(a)
    ib = simhash_int_from_hex(b)
    x = ia ^ ib
    return x.bit_count()
