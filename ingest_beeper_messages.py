"""
ingest_beeper_messages.py

Polls Beeper for new private-chat messages and uploads them to the
raw_messages staging table in Supabase — without calling the LLM.

Run this on the device that has Beeper Desktop running.
The LLM processor (process_raw_messages.py) can run on any machine with
Supabase + Ollama access.
"""

import os
import time
from datetime import datetime, timezone
from typing import Any

from config import USER_NAME  # noqa: F401 — kept for symmetry with other scripts
from create_crm_entry_from_latest_chat import (
    DEFAULT_STATUS,
    _contact_metadata,
    _network_column_values_from_metadata,
)
from database import (
    DEFAULT_TENANT_ID,
    find_customer,
    get_latest_ingested_message_id,
    initialize_database,
    insert_raw_message_batch,
    resolve_tenant_id_by_api_key,
    upsert_customer_payload,
)
from test import (
    _chat_sort_key,
    _chat_title,
    _fetch_last_messages,
    _is_private_chat,
    _items,
    client,
)


TENANT_API_KEY = os.getenv("CRM_TENANT_API_KEY")
initialize_database()
TENANT_ID = os.getenv("CRM_TENANT_ID") or (
    resolve_tenant_id_by_api_key(TENANT_API_KEY) if TENANT_API_KEY else DEFAULT_TENANT_ID
)

POLL_INTERVAL_SECONDS = int(os.getenv("INBOX_POLL_INTERVAL_SECONDS", "20"))
NEW_CUSTOMER_MESSAGE_LIMIT = int(os.getenv("INBOX_NEW_CUSTOMER_MESSAGE_LIMIT", "50"))
EXISTING_CUSTOMER_MESSAGE_LIMIT = int(os.getenv("INBOX_EXISTING_CUSTOMER_MESSAGE_LIMIT", "10"))
SCAN_CHAT_LIMIT = int(os.getenv("INBOX_SCAN_CHAT_LIMIT", "100"))
MONITORED_CONVERSATIONS = int(os.getenv("INBOX_MONITORED_CONVERSATIONS", "5"))


def _safe_get(obj: Any, attr: str, default: Any = None) -> Any:
    return getattr(obj, attr, default)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _message_sort_key(message: Any) -> Any:
    for attr in ("sort_key", "timestamp", "created_at", "sent_at", "date", "id"):
        value = _safe_get(message, attr)
        if value is not None:
            return value
    return 0


def _message_id(message: Any) -> str:
    value = _safe_get(message, "id")
    return str(value) if value is not None else ""


def _serialize_message(message: Any) -> dict:
    """Convert a Beeper message object to a plain dict suitable for JSONB storage."""
    return {
        "id": str(_safe_get(message, "id") or ""),
        "sender_name": str(
            _safe_get(message, "sender_name") or
            _safe_get(message, "sender") or
            "Unknown"
        ),
        "sender_id": str(_safe_get(message, "sender_id") or ""),
        "text": str(
            _safe_get(message, "text") or
            _safe_get(message, "body") or
            _safe_get(message, "content") or
            "[Attachment]"
        ),
        "timestamp": str(
            _safe_get(message, "timestamp") or
            _safe_get(message, "created_at") or
            ""
        ),
        "is_sender": bool(_safe_get(message, "is_sender") or False),
    }


def _fetch_all_private_chats() -> list[Any]:
    chats_api = getattr(client, "chats", None)
    if chats_api is None:
        return []

    chats: list[Any] = []
    for method_name in ("list", "search"):
        method = getattr(chats_api, method_name, None)
        if not callable(method):
            continue
        for kwargs in ({"limit": SCAN_CHAT_LIMIT}, {}):
            try:
                first_page = method(**kwargs)
            except TypeError:
                continue
            except Exception:
                continue
            if first_page is None:
                continue
            if hasattr(first_page, "iter_pages"):
                collected: list[Any] = []
                for page in first_page.iter_pages():
                    collected.extend(_items(getattr(page, "items", page)))
                if collected:
                    chats = collected
                    break
            else:
                chats = _items(first_page)
        if chats:
            break

    private_chats = [c for c in chats if _is_private_chat(c)]
    private_chats.sort(key=_chat_sort_key, reverse=True)
    return private_chats[:MONITORED_CONVERSATIONS]


def _ingest_chat(chat: Any) -> None:
    # Always fetch the maximum we might need so we have enough for new profiles
    all_messages = _fetch_last_messages(chat, limit=NEW_CUSTOMER_MESSAGE_LIMIT)
    if not all_messages:
        return

    ordered = sorted(all_messages, key=_message_sort_key)
    latest_msg_id = _message_id(ordered[-1])
    if not latest_msg_id:
        return

    # Use the most recent messages for contact metadata extraction
    contact = _contact_metadata(chat, ordered[-EXISTING_CUSTOMER_MESSAGE_LIMIT:])
    network_values = _network_column_values_from_metadata(
        contact["network"],
        contact["handle"],
        contact["phone"],
    )

    # Find or create a customer stub (no LLM — just identity fields)
    customer_id = find_customer(TENANT_ID, contact["name"], network_values)
    is_new = customer_id is None
    if is_new:
        payload = {
            "name": contact["name"],
            "phone": contact["phone"],
            "email": contact["email"],
            "status": DEFAULT_STATUS,
            "last_updated_at": _now_iso(),
            **network_values,
        }
        customer_id = upsert_customer_payload(TENANT_ID, payload)
        print(f"Created customer stub for '{contact['name']}' (id={customer_id})")

    # Only ingest if there are messages newer than the last batch
    stored_msg_id = get_latest_ingested_message_id(TENANT_ID, customer_id)
    if stored_msg_id == latest_msg_id:
        print(f"No new messages for '{contact['name']}'; skipping")
        return

    # New customers get the full history; existing ones get recent context only
    limit = NEW_CUSTOMER_MESSAGE_LIMIT if is_new else EXISTING_CUSTOMER_MESSAGE_LIMIT
    batch_messages = ordered[-limit:]

    serialized = [_serialize_message(m) for m in batch_messages]
    batch_id = insert_raw_message_batch(TENANT_ID, customer_id, serialized, latest_msg_id)
    print(
        f"Ingested {len(serialized)} messages for '{contact['name']}' "
        f"(customer_id={customer_id}, batch_id={batch_id}, {'new' if is_new else 'existing'})"
    )


def poll_once() -> None:
    for chat in _fetch_all_private_chats():
        try:
            _ingest_chat(chat)
        except Exception as exc:
            print(f"Failed to ingest '{_chat_title(chat)}': {exc}")


def main() -> None:
    print(
        f"Ingesting Beeper messages every {POLL_INTERVAL_SECONDS}s | "
        f"tenant={TENANT_ID} | monitoring {MONITORED_CONVERSATIONS} chats"
    )
    while True:
        try:
            poll_once()
        except KeyboardInterrupt:
            print("Stopped.")
            break
        except Exception as exc:
            print(f"Ingest loop error: {exc}")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
