import json
import logging

from pydantic import BaseModel, Field

from app import prompt
from app.settings import Settings

logger = logging.getLogger(__name__)


class FitScore(BaseModel):
    score: int = Field(ge=1, le=10, description="Fit score from 1 (poor) to 10 (excellent).")
    justification: str = Field(description="2-4 sentences: strengths, gaps, and decision rationale.")


async def score_resume_against_jd(
    settings: Settings,
    resume_text: str,
    jd_text: str,
) -> FitScore:
    from openai import AsyncOpenAI

    logger.info(
        "llm_score START model=%s resume_chars=%d jd_chars=%d",
        settings.openai_model,
        len(resume_text),
        len(jd_text),
    )
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        user = prompt.fit_score_user_message(jd_text, resume_text)
        completion = await client.beta.chat.completions.parse(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": prompt.FIT_SCORE_SYSTEM},
                {"role": "user", "content": user},
            ],
            response_format=FitScore,
        )
        out = completion.choices[0].message.parsed
        if out is None:
            logger.warning("llm_score model returned no parsed output; using fallback 5")
            return FitScore(score=5, justification="Model returned no structured output.")
        logger.info("llm_score OK score=%s", out.score)
        return out
    except Exception:
        logger.exception("llm_score FAILED")
        raise


async def score_jd_against_extracted(
    settings: Settings,
    jd_text: str,
    extracted: dict,
) -> FitScore:
    from openai import AsyncOpenAI

    body = json.dumps(extracted or {}, ensure_ascii=False, indent=2)
    logger.info(
        "llm_score_extracted START model=%s jd_chars=%d extracted_chars=%d",
        settings.openai_model,
        len(jd_text),
        len(body),
    )
    if not (
        extracted
        and isinstance(extracted, dict)
        and any(v not in (None, "", [], {}) for v in extracted.values())
    ):
        logger.warning("llm_score_extracted empty extraction; returning neutral fallback")
        return FitScore(
            score=5,
            justification="No usable extracted fields were available to compare to the job description.",
        )
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        user = prompt.fit_score_extracted_user_message(jd_text, body)
        completion = await client.beta.chat.completions.parse(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": prompt.FIT_SCORE_EXTRACTED_SYSTEM},
                {"role": "user", "content": user},
            ],
            response_format=FitScore,
        )
        out = completion.choices[0].message.parsed
        if out is None:
            logger.warning("llm_score_extracted model returned no parsed output; using fallback 5")
            return FitScore(score=5, justification="Model returned no structured output.")
        logger.info("llm_score_extracted OK score=%s", out.score)
        return out
    except Exception:
        logger.exception("llm_score_extracted FAILED")
        raise
