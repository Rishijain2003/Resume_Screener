import io
import logging
from pathlib import Path

import fitz  # PyMuPDF
from docx import Document

logger = logging.getLogger(__name__)


class ParseError(Exception):
    pass


def extract_text_from_pdf(data: bytes) -> str:
    logger.debug("parsing PDF bytes=%d", len(data))
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        logger.warning("parsing PDF open failed: %s", e)
        raise ParseError(f"Invalid or corrupted PDF: {e}") from e
    parts: list[str] = []
    try:
        n_pages = len(doc)
        for page in doc:
            parts.append(page.get_text() or "")
    finally:
        doc.close()
    text = "\n".join(parts).strip()
    logger.debug("parsing PDF OK chars=%d pages=%d", len(text), n_pages)
    return text


def extract_text_from_docx(data: bytes) -> str:
    logger.debug("parsing DOCX bytes=%d", len(data))
    try:
        document = Document(io.BytesIO(data))
    except Exception as e:
        logger.warning("parsing DOCX open failed: %s", e)
        raise ParseError(f"Invalid or corrupted DOCX: {e}") from e
    paras = [p.text for p in document.paragraphs if p.text and p.text.strip()]
    text = "\n".join(paras).strip()
    logger.debug("parsing DOCX OK chars=%d", len(text))
    return text


def extract_text(filename: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    logger.info("parsing extract_text filename=%r suffix=%s bytes=%d", filename, suffix, len(data))
    if suffix == ".pdf":
        return extract_text_from_pdf(data)
    if suffix in (".docx",):
        return extract_text_from_docx(data)
    logger.warning("parsing unsupported suffix=%s", suffix)
    raise ParseError(f"Unsupported file type: {suffix}")
