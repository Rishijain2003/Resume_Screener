#!/usr/bin/env python3
"""Insert five standard job roles into Postgres if their titles are not already present.

Requires schema applied (`python scripts/init_db.py`) and SUPABASE_URI in .env.
Extraction variables are not stored on roles; seed only creates title + JD text.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.settings import get_settings  # noqa: E402

# Titles must match config/jd_config.json template names for consistency.
ROLES: list[tuple[str, str]] = [
    (
        "Backend Engineer",
        "Build and maintain reliable APIs and services. Strong Python (FastAPI or similar), SQL/Postgres, "
        "REST design, automated testing, and production deployments. Bonus: experience with LLM APIs, async I/O, "
        "or high-throughput data pipelines.",
    ),
    (
        "Frontend Engineer",
        "Craft fast, accessible web experiences in React and TypeScript. Solid HTML/CSS, component design, state "
        "management, and performance tuning. You collaborate closely with design and backend teams to ship polished UIs.",
    ),
    (
        "Senior Backend Engineer",
        "Lead design and delivery of scalable backend systems. Deep experience with distributed services, databases, "
        "caching, observability, and production incidents. Mentor engineers, drive technical direction, and improve "
        "reliability and security.",
    ),
    (
        "AI Implementation Engineer",
        "Ship LLM-powered product features end-to-end: retrieval/RAG, evaluations, prompt design, guardrails, and "
        "safe rollout. Strong Python, OpenAI or similar APIs, embeddings, and pragmatic MLOps for production workloads.",
    ),
    (
        "HR Head",
        "Lead people strategy and operations: talent acquisition, onboarding, policies, employee relations, and "
        "compliance. Partner with leadership on org design, culture, and scaling HR programs in a growing technology company.",
    ),
]


async def main() -> None:
    import asyncpg

    settings = get_settings()

    conn = await asyncpg.connect(settings.supabase_uri, statement_cache_size=0)
    try:
        n = 0
        for title, jd in ROLES:
            exists = await conn.fetchval("SELECT 1 FROM roles WHERE title = $1", title)
            if exists:
                print("Skip (exists):", title)
                continue
            await conn.execute("INSERT INTO roles (title, jd_text) VALUES ($1, $2)", title, jd)
            print("Inserted:", title)
            n += 1
        print(f"Done. Inserted {n} new role(s); skipped titles already in the database.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
