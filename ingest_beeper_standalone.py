"""
ingest_beeper_standalone.py

Single-file Beeper → Supabase raw_messages ingest script.
No local imports required — copy this file + .env to any machine with
Beeper Desktop running.

Required pip packages:
    pip install beeper-desktop-api supabase

Required .env variables (or set at top of this file):
    BEEPER_ACCESS_TOKEN      — from Beeper Desktop settings
    BEEPER_BASE_URL          — default: http://localhost:23373
    SUPABASE_URL             — from Supabase project settings
    SUPABASE_SERVICE_ROLE_KEY — from Supabase project settings (service_role key)
    CRM_TENANT_ID            — your tenant id, e.g. tenant_anssi
"""

import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict

# ---------------------------------------------------------------------------
# .env loader (no python-dotenv dependency)
# ---------------------------------------------------------------------------

def _load_env_file(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_env_file()

# ---------------------------------------------------------------------------
# CONFIG — edit these or set via .env
# ---------------------------------------------------------------------------

BEEPER_ACCESS_TOKEN: str = os.getenv("BEEPER_ACCESS_TOKEN", "")
BEEPER_BASE_URL: str = os.getenv("BEEPER_BASE_URL", "http://localhost:23373")

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

TENANT_ID: str = os.getenv("CRM_TENANT_ID", "")

POLL_INTERVAL_SECONDS: int = int(os.getenv("INBOX_POLL_INTERVAL_SECONDS", "20"))
NEW_CUSTOMER_MESSAGE_LIMIT: int = int(os.getenv("INBOX_NEW_CUSTOMER_MESSAGE_LIMIT", "50"))
EXISTING_CUSTOMER_MESSAGE_LIMIT: int = int(os.getenv("INBOX_EXISTING_CUSTOMER_MESSAGE_LIMIT", "10"))
SCAN_CHAT_LIMIT: int = int(os.getenv("INBOX_SCAN_CHAT_LIMIT", "100"))
MONITORED_CONVERSATIONS: int = int(os.getenv("INBOX_MONITORED_CONVERSATIONS", "5"))

DEFAULT_STATUS = "unknown"

# ---------------------------------------------------------------------------
# Startup validation
# ---------------------------------------------------------------------------

if not BEEPER_ACCESS_TOKEN:
    raise RuntimeError("Missing BEEPER_ACCESS_TOKEN — add it to .env")
if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — add them to .env")
if not TENANT_ID:
    raise RuntimeError("Missing CRM_TENANT_ID — add it to .env")

# ---------------------------------------------------------------------------
# Beeper client
# ---------------------------------------------------------------------------

from beeper_desktop_api import BeeperDesktop

client = BeeperDesktop(access_token=BEEPER_ACCESS_TOKEN, base_url=BEEPER_BASE_URL)

# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------

from supabase import create_client, Client

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ---------------------------------------------------------------------------
# Beeper helpers (from test.py)
# ---------------------------------------------------------------------------

def _items(result: Any) -> list:
    if result is None:
        return []
    if hasattr(result, "items"):
        return list(result.items)
    if isinstance(result, (list, tuple)):
        return list(result)
    return [result]


def _chat_id(chat: Any) -> Any:
    for attr in ("id", "chat_id", "conversation_id"):
        value = getattr(chat, attr, None)
        if value is not None:
            return value
    return None


def _chat_title(chat: Any) -> str:
    for attr in ("title", "name", "display_name"):
        value = getattr(chat, attr, None)
        if value:
            return value
    return "Unknown chat"


def _is_private_chat(chat: Any) -> bool:
    chat_type = getattr(chat, "type", None) or getattr(chat, "chat_type", None)
    if isinstance(chat_type, str):
        normalized = chat_type.lower()
        if normalized in {"group", "space"}:
            return False
        if normalized in {"private", "direct", "dm", "single"}:
            return True

    if getattr(chat, "is_group", None) is True:
        return False
    if getattr(chat, "is_private", None) is True or getattr(chat, "is_direct", None) is True:
        return True

    participants = getattr(chat, "participants", None)
    if participants is not None:
        try:
            return len(participants) == 2
        except TypeError:
            pass

    return False


def _chat_sort_key(chat: Any) -> Any:
    for attr in ("last_message_at", "last_activity_at", "updated_at", "timestamp", "created_at"):
        value = getattr(chat, attr, None)
        if value is not None:
            return value
    return 0


def _message_sort_key(message: Any) -> Any:
    for attr in ("sort_key", "timestamp", "created_at", "sent_at", "date", "id"):
        value = getattr(message, attr, None)
        if value is not None:
            return value
    return 0


def _fetch_last_messages(chat: Any, limit: int = 50) -> list:
    chat_id = _chat_id(chat)
    messages_api = getattr(client, "messages", None)
    if messages_api is None:
        raise RuntimeError("Beeper client does not expose a messages API.")

    list_messages = getattr(messages_api, "list", None)
    if callable(list_messages) and chat_id is not None:
        try:
            first_page = list_messages(chat_id=chat_id)
        except Exception:
            first_page = None

        if first_page is not None:
            collected = []
            for page in first_page.iter_pages():
                messages = _items(page.items)
                if not messages:
                    break
                collected.extend(messages)
                if len(collected) >= limit:
                    break
            if collected:
                return collected[:limit]

    search = getattr(messages_api, "search", None)
    if callable(search) and chat_id is not None:
        for kwargs in (
            {"chat_id": chat_id, "limit": max(limit, 200)},
            {"chatId": chat_id, "limit": max(limit, 200)},
            {"chat": chat_id, "limit": max(limit, 200)},
        ):
            try:
                messages = _items(search(**kwargs))
            except TypeError:
                continue
            except Exception:
                continue
            if messages:
                messages.sort(key=_message_sort_key)
                return messages[-limit:]

    return []

# ---------------------------------------------------------------------------
# Contact metadata helpers (from create_crm_entry_from_latest_chat.py)
# ---------------------------------------------------------------------------

def _safe_get(obj: Any, attr: str, default: Any = None) -> Any:
    return getattr(obj, attr, default)


def _chat_network(chat: Any) -> str:
    for attr in ("network", "source", "platform", "service"):
        value = _safe_get(chat, attr)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    chat_id = _chat_id(chat)
    if isinstance(chat_id, str) and ":" in chat_id:
        return chat_id.split(":", 1)[1].split(".")[0].lower()
    return ""


def _participants_list(chat: Any) -> list:
    participants = _safe_get(chat, "participants")
    if participants is None:
        return []
    items = _safe_get(participants, "items")
    if isinstance(items, list):
        return items
    if isinstance(participants, list):
        return participants
    return []


def _extract_network_and_handle(raw_id: str) -> tuple:
    if not isinstance(raw_id, str) or not raw_id:
        return "", ""
    cleaned = raw_id.strip()
    local_part = cleaned
    if cleaned.startswith("@"):
        local_part = cleaned[1:]
    local_part = local_part.split(":", 1)[0]
    if "_" in local_part:
        possible_network, handle = local_part.split("_", 1)
        if possible_network and handle:
            return possible_network.lower(), handle
    return "", cleaned


def _looks_numeric(value: str) -> bool:
    cleaned = (value or "").replace("+", "").replace("-", "").replace(" ", "")
    return bool(cleaned) and cleaned.isdigit()


def _to_username_slug(value: str) -> str:
    text = (value or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _contact_metadata(chat: Any, messages: list) -> Dict[str, str]:
    contact = {
        "name": _chat_title(chat),
        "phone": "",
        "email": "",
        "network": "",
        "handle": "",
    }

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
) -> Dict[str, str]:
    values = {
        "whatsapp_id": "",
        "instagram_id": "",
        "messenger_id": "",
        "telegram_id": "",
        "signal_id": "",
        "twitter_id": "",
        "linkedin_id": "",
        "slack_id": "",
        "discord_id": "",
        "google_messages_id": "",
        "google_chat_id": "",
        "google_voice_id": "",
    }
    network_map = {
        "whatsapp": "whatsapp_id",
        "instagram": "instagram_id",
        "messenger": "messenger_id",
        "facebook": "messenger_id",
        "telegram": "telegram_id",
        "signal": "signal_id",
        "twitter": "twitter_id",
        "x": "twitter_id",
        "linkedin": "linkedin_id",
        "slack": "slack_id",
        "discord": "discord_id",
        "googlemessages": "google_messages_id",
        "google_messages": "google_messages_id",
        "googlechat": "google_chat_id",
        "google_chat": "google_chat_id",
        "googlevoice": "google_voice_id",
        "google_voice": "google_voice_id",
    }

    normalized_network = (contact_network or "").lower()
    column = network_map.get(normalized_network)
    if not column:
        return values

    if normalized_network == "whatsapp":
        if contact_phone:
            values[column] = contact_phone
        elif contact_handle:
            values[column] = contact_handle
        return values

    if contact_handle:
        values[column] = contact_handle

    return values

# ---------------------------------------------------------------------------
# Supabase DB helpers (from database.py — raw_messages only)
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_customer_deleted(customer_id: int) -> bool:
    result = (
        supabase.table("customers")
        .select("status")
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )
    if result.data:
        return (result.data[0].get("status") or "").lower() == "deleted"
    return False


def clear_customer_needs_refresh(customer_id: int) -> None:
    supabase.table("customers").update({"needs_refresh": False}).eq("tenant_id", TENANT_ID).eq("id", customer_id).execute()


def find_customer(name: str, network_values: Dict[str, str]) -> int | None:
    for column, value in network_values.items():
        if not value:
            continue
        row = (
            supabase.table("customers")
            .select("id")
            .eq("tenant_id", TENANT_ID)
            .eq(column, value)
            .limit(1)
            .execute()
        )
        if row.data:
            return int(row.data[0]["id"])

    if name:
        for col in ("name", "display_name"):
            row = (
                supabase.table("customers")
                .select("id")
                .eq("tenant_id", TENANT_ID)
                .eq(col, name)
                .limit(1)
                .execute()
            )
            if row.data:
                return int(row.data[0]["id"])

    return None


def upsert_customer(payload: Dict[str, Any]) -> int:
    data = dict(payload)
    data["tenant_id"] = TENANT_ID
    result = supabase.table("customers").upsert(data, on_conflict="id").execute()
    return int(result.data[0]["id"])


def get_tenant() -> dict | None:
    result = (
        supabase.table("tenants")
        .select("*")
        .eq("id", TENANT_ID)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def get_customer(customer_id: int) -> dict | None:
    result = (
        supabase.table("customers")
        .select("*")
        .eq("tenant_id", TENANT_ID)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def find_pending_batch_for_customer(customer_id: int) -> dict | None:
    """Return the newest unprocessed, unlocked batch for this customer, or None."""
    result = (
        supabase.table("raw_messages")
        .select("id, latest_message_id, messages")
        .eq("tenant_id", TENANT_ID)
        .eq("customer_id", customer_id)
        .eq("processed", False)
        .eq("processing", False)
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def append_messages_to_batch(
    batch_id: int,
    new_messages: list,
    new_latest_message_id: str,
) -> None:
    result = (
        supabase.table("raw_messages")
        .select("messages")
        .eq("id", batch_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        return
    existing_msgs: list = result.data[0]["messages"] or []
    existing_ids = {m.get("id") for m in existing_msgs if m.get("id")}
    to_append = [m for m in new_messages if m.get("id") not in existing_ids]
    supabase.table("raw_messages").update({
        "messages": existing_msgs + to_append,
        "latest_message_id": new_latest_message_id,
        "fetched_at": _now_iso(),
    }).eq("id", batch_id).execute()


def insert_raw_message_batch(customer_id: int, messages: list, latest_message_id: str) -> int:
    result = supabase.table("raw_messages").insert({
        "tenant_id": TENANT_ID,
        "customer_id": customer_id,
        "messages": messages,
        "latest_message_id": latest_message_id,
        "fetched_at": _now_iso(),
        "processed": False,
        "processing": False,
    }).execute()
    return int(result.data[0]["id"])

# ---------------------------------------------------------------------------
# Ingest logic
# ---------------------------------------------------------------------------

def _message_id(message: Any) -> str:
    value = _safe_get(message, "id")
    return str(value) if value is not None else ""


def _serialize_message(message: Any) -> dict:
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


def _fetch_all_private_chats() -> list:
    chats_api = getattr(client, "chats", None)
    if chats_api is None:
        return []

    chats: list = []
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
                collected: list = []
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
    all_messages = _fetch_last_messages(chat, limit=NEW_CUSTOMER_MESSAGE_LIMIT)
    if not all_messages:
        return

    ordered = sorted(all_messages, key=_message_sort_key)
    latest_msg_id = _message_id(ordered[-1])
    if not latest_msg_id:
        return

    contact = _contact_metadata(chat, ordered[-EXISTING_CUSTOMER_MESSAGE_LIMIT:])
    network_values = _network_column_values_from_metadata(
        contact["network"],
        contact["handle"],
        contact["phone"],
    )

    customer_id = find_customer(contact["name"], network_values)
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
        customer_id = upsert_customer(payload)
        print(f"Created customer stub for '{contact['name']}' (id={customer_id})")

    existing = None
    is_refresh = False
    if not is_new:
        existing = get_customer(customer_id)
        is_refresh = bool((existing or {}).get("needs_refresh"))
        current_display = (existing or {}).get("display_name") or (existing or {}).get("name") or ""
        if current_display != contact["name"]:
            supabase.table("customers").update({"display_name": contact["name"]}).eq("tenant_id", TENANT_ID).eq("id", customer_id).execute()

    if hide_personal_contacts and not is_new:
        if existing and existing.get("status") == "personal contact":
            print(f"Skipping '{contact['name']}' (personal contact, hide enabled)")
            return

    limit = NEW_CUSTOMER_MESSAGE_LIMIT if (is_new or is_refresh) else EXISTING_CUSTOMER_MESSAGE_LIMIT
    serialized = [_serialize_message(m) for m in ordered[-limit:]]

    # Check for an existing pending (unprocessed + unlocked) batch for this customer
    pending = find_pending_batch_for_customer(customer_id)
    if pending:
        if not is_refresh and pending["latest_message_id"] == latest_msg_id:
            print(f"No new messages for '{contact['name']}'; pending batch up to date")
            return
        append_messages_to_batch(pending["id"], serialized, latest_msg_id)
        print(f"Appended to pending batch for '{contact['name']}' (batch_id={pending['id']})")
        if is_refresh:
            clear_customer_needs_refresh(customer_id)
            print(f"Refresh queued for '{contact['name']}'")
        return

    # No pending batch — skip if customer is already fully up to date (unless refresh forced)
    if not is_new and not is_refresh:
        if existing and existing.get("last_processed_message_id") == latest_msg_id:
            print(f"No new messages for '{contact['name']}'; already up to date")
            return

    batch_id = insert_raw_message_batch(customer_id, serialized, latest_msg_id)
    if is_refresh:
        clear_customer_needs_refresh(customer_id)
        print(f"Refresh queued for '{contact['name']}'")
    print(
        f"Ingested {len(serialized)} messages for '{contact['name']}' "
        f"(customer_id={customer_id}, batch_id={batch_id}, {'new' if is_new else 'existing'})"
    )


def poll_once() -> None:
    tenant = get_tenant()
    hide_personal_contacts = bool((tenant or {}).get("hide_personal_contacts", False))
    for chat in _fetch_all_private_chats():
        try:
            _ingest_chat(chat, hide_personal_contacts=hide_personal_contacts)
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
