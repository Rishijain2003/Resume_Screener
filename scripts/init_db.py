#!/usr/bin/env python3
"""Apply sql/schema.sql to PostgreSQL (uses SUPABASE_URI from .env)."""

import asyncio
import socket
import sys
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.settings import get_settings  # noqa: E402


def _print_dns_diagnostics(host: str, port: int) -> None:
    print("\n--- DNS / routing check for", host, "---", file=sys.stderr)
    v4_ok = False
    v6_addrs: list[str] = []
    for family, label in (
        (socket.AF_INET, "IPv4"),
        (socket.AF_INET6, "IPv6"),
    ):
        try:
            infos = socket.getaddrinfo(host, port, family, socket.SOCK_STREAM)
            addrs = sorted({x[4][0] for x in infos})
            print(f"  {label}: {addrs or '(no results)'}", file=sys.stderr)
            if family == socket.AF_INET and addrs:
                v4_ok = True
            if family == socket.AF_INET6 and addrs:
                v6_addrs = list(addrs)
        except OSError as e:
            print(f"  {label}: lookup failed ({e})", file=sys.stderr)
    print(file=sys.stderr)
    if not v4_ok and v6_addrs:
        print(
            "Your resolver returned NO IPv4 (A record) for this host, only IPv6.\n"
            "asyncpg then connects over IPv6, but this machine reports IPv6 as unreachable (errno 101).\n\n"
            "Fix (pick one):\n"
            "  1) Use Supabase POOLER URI (often resolves to IPv4): Dashboard → Project Settings →\n"
            "     Database → Connection string → choose 'Session pooler' or 'Transaction pooler'.\n"
            "     Host looks like aws-0-<region>.pooler.supabase.com port 6543 (or 5432 for session).\n"
            "     Put that full URI in SUPABASE_URI with ?sslmode=require\n"
            "  2) Enable IPv6 on this host (VPC/subnet IPv6 + route) so the IPv6 address is reachable.\n"
            "  3) Try DNS that returns A records: dig A " + host + " @8.8.8.8\n",
            file=sys.stderr,
        )
    else:
        print(
            "If you see IPv6 but get errno 101, the OS may be trying IPv6 first with no route.\n"
            "Try: nc -vz -4 " + host + " " + str(port) + "  and  nc -vz -6 ...\n"
            "On AWS EC2: NAT for outbound internet; security group egress for TCP "
            + str(port)
            + " / 6543.\n",
            file=sys.stderr,
        )


async def main() -> None:
    import asyncpg

    settings = get_settings()
    schema_path = REPO_ROOT / "sql" / "schema.sql"
    sql = schema_path.read_text(encoding="utf-8")

    parsed = urlparse(settings.supabase_uri)
    host = parsed.hostname
    port = parsed.port or 5432

    try:
        conn = await asyncpg.connect(settings.supabase_uri, statement_cache_size=0)
    except OSError as e:
        if e.errno == 101 and host:
            print("Connection failed: network unreachable (errno 101).", file=sys.stderr)
            _print_dns_diagnostics(host, port)
        raise

    try:
        await conn.execute(sql)
    finally:
        await conn.close()
    print("Schema applied:", schema_path)


if __name__ == "__main__":
    asyncio.run(main())
