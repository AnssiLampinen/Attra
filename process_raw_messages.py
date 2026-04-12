"""
process_raw_messages.py

Reads unprocessed batches from the raw_messages staging table and updates
the corresponding customer record using the local Ollama LLM — one batch
at a time, oldest first.

Does NOT require Beeper. Run this on any machine with Supabase + Ollama access.
"""

import json
import os
import socket
import time
import types
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


# Load .env before anything that reads os.environ
def _load_env_file(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_env_file()

from database import (  # noqa: E402 — must come after env load
    DEFAULT_TENANT_ID,
    fetch_oldest_unprocessed_batch,
    get_customer,
    initialize_database,
    mark_batch_processed,
    resolve_tenant_id_by_api_key,
    upsert_customer_payload,
)
from config import USER_NAME  # noqa: E402


TENANT_API_KEY = os.getenv("CRM_TENANT_API_KEY")
initialize_database()
TENANT_ID = os.getenv("CRM_TENANT_ID") or (
    resolve_tenant_id_by_api_key(TENANT_API_KEY) if TENANT_API_KEY else DEFAULT_TENANT_ID
)

POLL_INTERVAL_SECONDS = int(os.getenv("PROCESS_POLL_INTERVAL_SECONDS", "30"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:32b")
OLLAMA_TIMEOUT_SECONDS = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "300"))
SUMMARY_MAX_TOKENS = 1200

STRICT_SUMMARY_FORMAT = (
    "Create a short, structured note from these chat messages for a service provider. "
    "Only include details that are explicitly stated in the messages. Ignore call events and missed-call notifications. "
    f"Address {USER_NAME} as 'you'.\n\n"
    "Output format (exactly these four lines):\n"
    "1. Situation: <one sentence on overall context>\n"
    "2. Customer Needs: <one sentence on what the customer needs/wants>\n"
    "3. Latest Requests: <one sentence on latest actionable requests/questions>\n"
    "4. Recommended Next Step: <one sentence on what you should do next>\n\n"
    "Constraints: maximum 4 sentences total, plain text only, no extra headings, no bullets, no invented facts."
)

CUSTOMER_PROFILE_PROMPT = (
    "Write a brief, single-sentence customer profile based on the messages. "
    "Focus on their role, industry, or key characteristic. Be concise and factual. "
    "Do not include any numbering or formatting. Just one clear sentence."
)

PROFILE_NOTES_MESSAGE_LIMIT = 10


# ---------------------------------------------------------------------------
# Ollama helpers (self-contained — no Beeper dependency)
# ---------------------------------------------------------------------------

def _call_ollama(prompt: str) -> tuple[str, str]:
    url = f"{OLLAMA_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": SUMMARY_MAX_TOKENS},
    }
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=OLLAMA_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama request failed: {exc.code} {exc.reason}\n{body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Ollama request failed: {exc.reason}") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise RuntimeError(
            f"Ollama timed out after {OLLAMA_TIMEOUT_SECONDS}s (model='{OLLAMA_MODEL}')"
        ) from exc

    text = data.get("response", "").strip()
    if not text:
        raise RuntimeError(f"Ollama returned an empty response: {data}")
    return text, data.get("done_reason", "")


def _format_messages(messages: list[Any]) -> str:
    lines = []
    for m in messages:
        sender = getattr(m, "sender_name", None) or getattr(m, "sender", None) or "Unknown"
        text = (
            getattr(m, "text", None) or
            getattr(m, "body", None) or
            getattr(m, "content", None) or
            "[Attachment]"
        )
        lines.append(f"{sender}: {text}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM tasks
# ---------------------------------------------------------------------------

def _update_profile_notes(existing_profile_notes: str, messages: list[Any]) -> str:
    recent_text = _format_messages(messages)
    prompt = (
        "You maintain a running customer profile for CRM usage. "
        "Be lenient about adding potentially useful information from recent messages, even if it seems minor. "
        "Never remove existing valid facts unless clearly contradicted.\n\n"
        "Output rules:\n"
        "- If there is no relevant new information, output exactly: __UNCHANGED__\n"
        "- Otherwise output the FULL updated profile notes in plain text\n"
        "- Keep existing facts and append new facts\n"
        "- Do not invent facts\n\n"
        f"Existing profile notes:\n{existing_profile_notes}\n\n"
        f"Recent messages:\n{recent_text}"
    )
    profile_text, _ = _call_ollama(prompt)
    cleaned = profile_text.strip()
    return existing_profile_notes if (not cleaned or cleaned == "__UNCHANGED__") else cleaned


def _build_customer_profile(messages: list[Any]) -> str:
    selected = messages[-PROFILE_NOTES_MESSAGE_LIMIT:]
    prompt = f"{CUSTOMER_PROFILE_PROMPT}\n\nMessages:\n{_format_messages(selected)}"
    text, _ = _call_ollama(prompt)
    return text.strip()


def _build_strict_summary(
    existing_summary: str,
    profile_notes: str,
    messages: list[Any],
) -> str:
    recent_text = _format_messages(messages)
    prompt = (
        f"{STRICT_SUMMARY_FORMAT}\n\n"
        "Use the existing summary and profile notes as durable context so no important prior information is lost. "
        "Incorporate any relevant updates from recent messages.\n\n"
        f"Existing summary:\n{existing_summary}\n\n"
        f"Profile notes:\n{profile_notes}\n\n"
        f"Recent messages:\n{recent_text}"
    )
    text, _ = _call_ollama(prompt)
    return text.strip()


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------

def _deserialize_messages(raw: list[dict]) -> list[Any]:
    """Restore stored JSONB dicts to attribute-accessible objects."""
    return [types.SimpleNamespace(**msg) for msg in raw]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _process_batch(row: dict) -> None:
    batch_id = int(row["id"])
    customer_id = int(row["customer_id"])
    messages = _deserialize_messages(row["messages"])
    latest_msg_id = row["latest_message_id"]

    existing = get_customer(TENANT_ID, customer_id)
    if existing is None:
        print(f"Customer id={customer_id} not found — marking processed and skipping")
        mark_batch_processed(batch_id)
        return

    name = existing.get("name", f"id={customer_id}")

    # Skip if a later batch already moved the customer past this message
    stored_msg_id = str(existing.get("last_processed_message_id") or "")
    if stored_msg_id == latest_msg_id:
        print(f"Customer '{name}' already up to date — marking processed")
        mark_batch_processed(batch_id)
        return

    print(f"Processing batch_id={batch_id} for customer '{name}' (id={customer_id}) …")

    existing_summary = str(existing.get("summary") or "")
    existing_profile_notes = str(existing.get("profile_notes") or "")

    updated_profile_notes = _update_profile_notes(existing_profile_notes, messages)
    # For brand-new customers the LLM may return __UNCHANGED__ on empty input;
    # fall back to the raw transcript so the summary has something to work with.
    if not updated_profile_notes:
        updated_profile_notes = _format_messages(messages)
    updated_customer_profile = _build_customer_profile(messages)
    updated_summary = _build_strict_summary(existing_summary, updated_profile_notes, messages)

    updated = dict(existing)
    updated["id"] = customer_id
    updated["summary"] = updated_summary
    updated["profile_notes"] = updated_profile_notes
    updated["customer_profile"] = updated_customer_profile
    updated["last_processed_message_id"] = latest_msg_id
    updated["last_updated_at"] = _now_iso()

    upsert_customer_payload(TENANT_ID, updated)
    mark_batch_processed(batch_id)

    changed = updated_summary != existing_summary
    print(f"Done — customer '{name}' {'summary updated' if changed else 'no summary change'}")


def poll_once() -> bool:
    """Process one pending batch. Returns True if a batch was found."""
    row = fetch_oldest_unprocessed_batch(TENANT_ID)
    if row is None:
        return False
    try:
        _process_batch(row)
    except Exception as exc:
        print(f"Failed to process batch id={row['id']}: {exc}")
    return True


def main() -> None:
    print(
        f"Processing raw messages every {POLL_INTERVAL_SECONDS}s | "
        f"tenant={TENANT_ID} | model={OLLAMA_MODEL}"
    )
    while True:
        try:
            found = poll_once()
            if not found:
                print("Queue empty.")
        except KeyboardInterrupt:
            print("Stopped.")
            break
        except Exception as exc:
            print(f"Processor loop error: {exc}")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
