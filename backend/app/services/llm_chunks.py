import logging
from typing import Literal

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app import prompt
from app.settings import Settings

logger = logging.getLogger(__name__)


class ResumeChunk(BaseModel):
    chunk_type: Literal["project", "experience"] = Field(
        description="Whether this chunk is a project or a work experience block."
    )
    title: str = Field(description="Project name or company/role title for this chunk.")
    body: str = Field(
        description="Concise text suitable for embedding: responsibilities, stack, outcomes."
    )


class ChunkExtraction(BaseModel):
    chunks: list[ResumeChunk] = Field(
        default_factory=list,
        description="Distinct project and experience segments from the resume.",
    )


async def extract_project_experience_chunks(
    settings: Settings,
    resume_text: str,
) -> list[dict]:
    logger.info("llm_chunks.extract START model=%s chars=%d", settings.openai_model, len(resume_text))
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        user = prompt.chunk_rag_user_message(resume_text)
        completion = await client.beta.chat.completions.parse(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": prompt.CHUNK_RAG_SYSTEM},
                {"role": "user", "content": user},
            ],
            response_format=ChunkExtraction,
        )
        parsed = completion.choices[0].message.parsed
        if not parsed:
            logger.warning("llm_chunks.extract no parsed output")
            return []
        chunks = [c.model_dump() for c in parsed.chunks]
        logger.info("llm_chunks.extract OK count=%d", len(chunks))
        return chunks
    except Exception:
        logger.exception("llm_chunks.extract FAILED")
        raise


async def embed_texts(settings: Settings, texts: list[str]) -> list[list[float]]:
    if not texts:
        logger.debug("llm_chunks.embed skip (empty input)")
        return []
    logger.info("llm_chunks.embed START model=%s batch=%d", settings.openai_embedding_model, len(texts))
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        resp = await client.embeddings.create(
            model=settings.openai_embedding_model,
            input=texts,
        )
        out = [d.embedding for d in resp.data]
        logger.info("llm_chunks.embed OK vectors=%d dim=%d", len(out), len(out[0]) if out else 0)
        return out
    except Exception:
        logger.exception("llm_chunks.embed FAILED")
        raise
