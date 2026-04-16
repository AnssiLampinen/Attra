"""
supabase_client.py

Creates and exports the single shared Supabase client instance used by
database.py (and indirectly by every script in the project).

Loads .env before reading credentials so the file can be imported from
any working directory without a separate dotenv call. Raises RuntimeError
at import time if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are missing,
so misconfiguration is caught immediately on startup rather than at the
first database call.

Exports:
  supabase     — authenticated supabase.Client (service-role key)
  SUPABASE_URL — project URL string (used by app_server.py for JWKS fetch)
"""

import os

from supabase import create_client, Client

from env_loader import _load_env_file


_load_env_file()

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. "
        "Add them to your .env file."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
