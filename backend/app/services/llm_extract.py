import logging
from typing import Any, Optional

from openai import AsyncOpenAI
from pydantic import BaseModel, Field, create_model

from app import prompt
from app.settings import Settings

logger = logging.getLogger(__name__)


def build_extraction_model(fields: list[dict[str, Any]]) -> type[BaseModel]:
    field_defs: dict[str, tuple[Any, Any]] = {}
    for item in fields:
        key = str(item.get("key", "")).strip()
        if not key or not key.replace("_", "").isalnum():
            continue
        typ = item.get("type", "string")
        desc = str(item.get("description") or item.get("label") or key)
        if typ == "number":
            field_defs[key] = (Optional[float], Field(default=None, description=desc))
        elif typ == "list":
            field_defs[key] = (Optional[list[str]], Field(default=None, description=desc))
        elif typ == "boolean":
            field_defs[key] = (Optional[bool], Field(default=None, description=desc))
        else:
            field_defs[key] = (Optional[str], Field(default=None, description=desc))
    if not field_defs:
        raise ValueError("extraction_config must define at least one field with a valid key")
    return create_model("ResumeExtraction", __base__=BaseModel, **field_defs)


async def extract_resume_fields(
    settings: Settings,
    resume_text: str,
    fields: list[dict[str, Any]],
) -> dict[str, Any]:
    logger.info(
        "llm_extract START model=%s resume_chars=%d field_defs=%d",
        settings.openai_model,
        len(resume_text),
        len(fields),
    )
    try:
        model_cls = build_extraction_model(fields)
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        field_lines = prompt.format_extraction_field_lines(fields)
        user = prompt.extraction_user_message(field_lines, resume_text)
        completion = await client.beta.chat.completions.parse(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": prompt.EXTRACTION_SYSTEM},
                {"role": "user", "content": user},
            ],
            response_format=model_cls,
        )
        parsed = completion.choices[0].message.parsed
        if parsed is None:
            logger.warning("llm_extract model returned no parsed object")
            return {}
        out = parsed.model_dump(exclude_none=False)
        logger.info("llm_extract OK keys=%s", list(out.keys()))
        return out
    except Exception:
        logger.exception("llm_extract FAILED")
        raise
