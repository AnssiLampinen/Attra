"""
ingest_beeper_messages.py

Polls Beeper for new private-chat messages and uploads them to the
raw_messages staging table in Supabase — without calling the LLM.

Run this on the device that has Beeper Desktop running.
The LLM processor (process_raw_messages.py) can run on any machine with
Supabase + Ollama access.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RUNNING ON ANOTHER MACHINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Copy these files from the repo:
  ingest_beeper_messages.py   ← this file
  beeper_client.py            ← Beeper Desktop API client
  create_crm_entry_from_latest_chat.py  ← contact metadata helpers
  database.py                 ← Supabase query functions
  supabase_client.py          ← Supabase client initialisation
  config.py                   ← USER_NAME env var helper
  .env                        ← secrets (see below)

Install pip packages:
  pip install supabase beeper-desktop-api

Required .env variables:
  BEEPER_ACCESS_TOKEN         Beeper Desktop access token
  SUPABASE_URL                Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY   Supabase service-role key
  CRM_TENANT_ID               Your tenant ID in Supabase
                              (or set CRM_TENANT_API_KEY instead)

Optional .env variables (shown with defaults):
  BEEPER_BASE_URL=http://localhost:23373
  CRM_TENANT_API_KEY          Alternative to CRM_TENANT_ID
  INBOX_POLL_INTERVAL_SECONDS=20
  INBOX_NEW_CUSTOMER_MESSAGE_LIMIT=50
  INBOX_EXISTING_CUSTOMER_MESSAGE_LIMIT=10
  INBOX_SCAN_CHAT_LIMIT=100
  INBOX_MONITORED_CONVERSATIONS=5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import os
import re
import time
from datetime import datetime, timezone
from typing import Any

from database import (
    append_messages_to_batch,
    clear_customer_needs_refresh,
    find_customer,
    find_pending_batch_for_customer,
    get_customer,
    get_tenant,
    initialize_database,
    insert_raw_message_batch,
    is_customer_deleted,
    resolve_tenant_id_from_env,
    update_customer,
    upsert_customer_payload,
)
from beeper_client import (
    _chat_sort_key,
    _chat_title,
    _fetch_last_messages,
    _is_private_chat,
    _items,
    _message_sort_key,
    client,
)

initialize_database()
TENANT_ID = resolve_tenant_id_from_env()

POLL_INTERVAL_SECONDS = int(os.getenv("INBOX_POLL_INTERVAL_SECONDS", "20"))
NEW_CUSTOMER_MESSAGE_LIMIT = int(os.getenv("INBOX_NEW_CUSTOMER_MESSAGE_LIMIT", "50"))
EXISTING_CUSTOMER_MESSAGE_LIMIT = int(os.getenv("INBOX_EXISTING_CUSTOMER_MESSAGE_LIMIT", "10"))
SCAN_CHAT_LIMIT = int(os.getenv("INBOX_SCAN_CHAT_LIMIT", "100"))
MONITORED_CONVERSATIONS = int(os.getenv("INBOX_MONITORED_CONVERSATIONS", "5"))


def _safe_get(obj: Any, attr: str, default: Any = None) -> Any:
    return getattr(obj, attr, default)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


DEFAULT_STATUS = "unknown"


def _participants_list(chat: Any) -> list[Any]:
    participants = _safe_get(chat, "participants")
    if participants is None:
        return []
    items = _safe_get(participants, "items")
    if isinstance(items, list):
        return items
    if isinstance(participants, list):
        return participants
    return []


def _extract_network_and_handle(raw_id: str) -> tuple[str, str]:
    if not isinstance(raw_id, str) or not raw_id:
        return "", ""
    cleaned = raw_id.strip()
    local_part = cleaned[1:] if cleaned.startswith("@") else cleaned
    local_part = local_part.split(":", 1)[0]
    if "_" in local_part:
        possible_network, handle = local_part.split("_", 1)
        if possible_network and handle:
            return possible_network.lower(), handle
    return "", cleaned


def _to_username_slug(value: str) -> str:
    text = (value or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _chat_network(chat: Any) -> str:
    for attr in ("network", "source", "platform", "service"):
        value = _safe_get(chat, attr)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    from beeper_client import _chat_id
    chat_id = _chat_id(chat)
    if isinstance(chat_id, str) and ":" in chat_id:
        return chat_id.split(":", 1)[1].split(".")[0].lower()
    return ""


def _contact_metadata(chat: Any, messages: list[Any]) -> dict[str, str]:
    contact = {"name": _chat_title(chat), "phone": "", "email": "", "network": "", "handle": ""}
    for participant in _participants_list(chat):
        if bool(_safe_get(participant, "is_self")):
            continue
        username = _safe_get(participant, "username") or ""
        participant_id = _safe_get(participant, "id") or ""
        network, handle = _extract_network_and_handle(participant_id)
        if network and handle:
            contact["network"] = network
            contact["handle"] = handle
        full_name = _safe_get(participant, "full_name") or _safe_get(participant, "fullName")
        if full_name:
            contact["name"] = full_name
        username_candidate = _to_username_slug(username)
        if username_candidate:
            contact["handle"] = username_candidate
        phone = _safe_get(participant, "phone_number") or _safe_get(participant, "phoneNumber")
        if phone:
            contact["phone"] = phone
        email = _safe_get(participant, "email")
        if email:
            contact["email"] = email
        break
    if not contact["network"] or not contact["handle"]:
        for message in messages:
            if bool(_safe_get(message, "is_sender")):
                continue
            sender_id = _safe_get(message, "sender_id") or ""
            network, handle = _extract_network_and_handle(sender_id)
            if network and handle:
                contact["network"] = network
                contact["handle"] = handle
            sender_name = _safe_get(message, "sender_name") or ""
            sender_slug = _to_username_slug(sender_name)
            if sender_slug:
                contact["handle"] = sender_slug
                break
    if not contact["network"]:
        contact["network"] = _chat_network(chat)
    return contact


def _network_column_values_from_metadata(
    contact_network: str,
    contact_handle: str,
    contact_phone: str,
) -> dict[str, str]:
    values = {
        "whatsapp_id": "", "instagram_id": "", "messenger_id": "", "telegram_id": "",
        "signal_id": "", "twitter_id": "", "linkedin_id": "", "slack_id": "",
        "discord_id": "", "google_messages_id": "", "google_chat_id": "", "google_voice_id": "",
    }
    network_map = {
        "whatsapp": "whatsapp_id", "instagram": "instagram_id",
        "messenger": "messenger_id", "facebook": "messenger_id",
        "telegram": "telegram_id", "signal": "signal_id",
        "twitter": "twitter_id", "x": "twitter_id",
        "linkedin": "linkedin_id", "slack": "slack_id", "discord": "discord_id",
        "googlemessages": "google_messages_id", "google_messages": "google_messages_id",
        "googlechat": "google_chat_id", "google_chat": "google_chat_id",
        "googlevoice": "google_voice_id", "google_voice": "google_voice_id",
    }
    normalized_network = (contact_network or "").lower()
    column = network_map.get(normalized_network)
    if not column:
        return values
    if normalized_network == "whatsapp":
        values[column] = contact_phone if contact_phone else contact_handle
    elif contact_handle:
        values[column] = contact_handle
    return values


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


def _ingest_chat(chat: Any, hide_personal_contacts: bool = False) -> None:
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
    if not is_new and is_customer_deleted(customer_id):
        print(f"Skipping '{contact['name']}' (deleted)")
        return
    if is_new:
        payload = {
            "name": contact["name"],
            "display_name": contact["name"],
            "phone": contact["phone"],
            "email": contact["email"],
            "status": DEFAULT_STATUS,
            "last_updated_at": _now_iso(),
            **network_values,
        }
        customer_id = upsert_customer_payload(TENANT_ID, payload)
        print(f"Created customer stub for '{contact['name']}' (id={customer_id})")

    existing = None
    is_refresh = False
    if not is_new:
        existing = get_customer(TENANT_ID, customer_id)
        is_refresh = bool((existing or {}).get("needs_refresh"))
        current_display = (existing or {}).get("display_name") or (existing or {}).get("name") or ""
        if current_display != contact["name"]:
            update_customer(TENANT_ID, customer_id, {"display_name": contact["name"]})

    if hide_personal_contacts and not is_new:
        if existing and existing.get("status") == "personal contact":
            print(f"Skipping '{contact['name']}' (personal contact, hide enabled)")
            return

    limit = NEW_CUSTOMER_MESSAGE_LIMIT if (is_new or is_refresh) else EXISTING_CUSTOMER_MESSAGE_LIMIT
    serialized = [_serialize_message(m) for m in ordered[-limit:]]

    # Check for an existing pending (unprocessed + unlocked) batch for this customer
    pending = find_pending_batch_for_customer(TENANT_ID, customer_id)
    if pending:
        if not is_refresh and pending["latest_message_id"] == latest_msg_id:
            return
        append_messages_to_batch(pending["id"], serialized, latest_msg_id)
        print(f"Appended to pending batch for '{contact['name']}' (batch_id={pending['id']})")
        if is_refresh:
            clear_customer_needs_refresh(TENANT_ID, customer_id)
            print(f"Refresh queued for '{contact['name']}'")
        return

    # No pending batch — skip if customer is already fully up to date (unless refresh forced)
    if not is_new and not is_refresh:
        if existing and existing.get("last_processed_message_id") == latest_msg_id:
            return

    batch_id = insert_raw_message_batch(TENANT_ID, customer_id, serialized, latest_msg_id)
    if is_refresh:
        clear_customer_needs_refresh(TENANT_ID, customer_id)
        print(f"Refresh queued for '{contact['name']}'")
    print(f"Ingested {len(serialized)} messages for '{contact['name']}' (customer_id={customer_id}, batch_id={batch_id}, {'new' if is_new else 'existing'})")


def poll_once() -> None:
    tenant = get_tenant(TENANT_ID)
    hide_personal_contacts = bool((tenant or {}).get("hide_personal_contacts", False))
    for chat in _fetch_all_private_chats():
        try:
            _ingest_chat(chat, hide_personal_contacts=hide_personal_contacts)
        except Exception as exc:
            print(f"Failed to ingest '{_chat_title(chat)}': {exc}")


def main() -> None:
    print(f"Ingesting Beeper messages every {POLL_INTERVAL_SECONDS}s | tenant={TENANT_ID} | monitoring {MONITORED_CONVERSATIONS} chats")
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
