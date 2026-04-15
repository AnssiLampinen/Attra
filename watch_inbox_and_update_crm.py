import os
import time
from datetime import datetime, timezone
from typing import Any

from config import USER_NAME
from create_crm_entry_from_latest_chat import (
    DEFAULT_STATUS,
    _build_customer_profile,
    _contact_metadata,
    _network_column_values_from_metadata,
)
from database import (
    DEFAULT_TENANT_ID,
    find_customer,
    get_customer,
    initialize_database,
    is_customer_deleted,
    resolve_tenant_id_by_api_key,
    upsert_customer_payload,
)
from fetch_latest_private_chat_messages import (
    _call_ollama,
    _format_messages,
)
from beeper_client import (
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
RECENT_MESSAGE_LIMIT = int(os.getenv("INBOX_RECENT_MESSAGE_LIMIT", "10"))
SCAN_CHAT_LIMIT = int(os.getenv("INBOX_SCAN_CHAT_LIMIT", "100"))
MONITORED_CONVERSATIONS = 5

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


def _safe_get(obj: Any, attr: str, default: Any = None) -> Any:
    return getattr(obj, attr, default)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
                collected = []
                for page in first_page.iter_pages():
                    collected.extend(_items(getattr(page, "items", page)))
                if collected:
                    chats = collected
                    break
            else:
                chats = _items(first_page)

        if chats:
            break

    private_chats = [chat for chat in chats if _is_private_chat(chat)]
    private_chats.sort(key=_chat_sort_key, reverse=True)
    return private_chats[:MONITORED_CONVERSATIONS]


def _message_sort_key(message: Any) -> Any:
    for attr in ("sort_key", "timestamp", "created_at", "sent_at", "date", "id"):
        value = _safe_get(message, attr)
        if value is not None:
            return value
    return 0


def _sorted_messages(messages: list[Any]) -> list[Any]:
    return sorted(messages, key=_message_sort_key)


def _message_id(message: Any) -> str:
    value = _safe_get(message, "id")
    return str(value) if value is not None else ""


def _merge_contact_fields(
    existing: dict[str, Any],
    contact: dict[str, str],
    network_values: dict[str, str],
) -> dict[str, Any]:
    merged = dict(existing)
    for key, value in (
        ("name", contact.get("name", "")),
        ("phone", contact.get("phone", "")),
        ("email", contact.get("email", "")),
    ):
        if value and not merged.get(key):
            merged[key] = value

    for key, value in network_values.items():
        if value and not merged.get(key):
            merged[key] = value

    if not merged.get("status"):
        merged["status"] = DEFAULT_STATUS

    return merged


def _update_profile_notes(existing_profile_notes: str, recent_messages: list[Any]) -> str:
    recent_text = _format_messages(recent_messages)
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
    if not cleaned or cleaned == "__UNCHANGED__":
        return existing_profile_notes

    return cleaned


def _build_strict_summary(
    existing_summary: str,
    profile_notes: str,
    recent_messages: list[Any],
) -> str:
    recent_text = _format_messages(recent_messages)
    prompt = (
        f"{STRICT_SUMMARY_FORMAT}\n\n"
        "Use the existing summary and profile notes as durable context so no important prior information is lost. "
        "Incorporate any relevant updates from recent messages.\n\n"
        f"Existing summary:\n{existing_summary}\n\n"
        f"Profile notes:\n{profile_notes}\n\n"
        f"Recent messages:\n{recent_text}"
    )
    summary_text, _ = _call_ollama(prompt)
    return summary_text.strip()


def _process_chat(chat: Any) -> None:
    recent_messages = _fetch_last_messages(chat, limit=max(RECENT_MESSAGE_LIMIT, 50))
    ordered = _sorted_messages(recent_messages)
    if not ordered:
        return

    latest_msg_id = _message_id(ordered[-1])
    if not latest_msg_id:
        return

    last_messages = ordered[-RECENT_MESSAGE_LIMIT:]

    contact = _contact_metadata(chat, last_messages)
    network_values = _network_column_values_from_metadata(
        contact["network"],
        contact["handle"],
        contact["phone"],
    )

    existing_id = find_customer(TENANT_ID, contact["name"], network_values)

    if existing_id is not None and is_customer_deleted(existing_id):
        print(f"Skipping '{contact['name']}' (deleted)")
        return

    if existing_id is None:
        profile_notes = _update_profile_notes("", last_messages)
        if not profile_notes:
            profile_notes = _format_messages(last_messages)

        customer_profile = _build_customer_profile(last_messages)
        summary_text = _build_strict_summary("", profile_notes, last_messages)

        payload: dict[str, Any] = {
            "name": contact["name"],
            "phone": contact["phone"],
            "email": contact["email"],
            "summary": summary_text,
            "status": DEFAULT_STATUS,
            "last_processed_message_id": latest_msg_id,
            "profile_notes": profile_notes,
            "customer_profile": customer_profile,
            "last_updated_at": _now_iso(),
            **network_values,
        }
        upsert_customer_payload(TENANT_ID, payload)
        print(f"Created new CRM entry for '{contact['name']}' from chat '{_chat_title(chat)}'")
        return

    existing = get_customer(TENANT_ID, existing_id) or {}
    stored_message_id = str(existing.get("last_processed_message_id") or "")
    if stored_message_id == latest_msg_id:
        print(f"No new messages in '{_chat_title(chat)}'; skipping")
        return

    existing_summary = str(existing.get("summary") or "")
    existing_profile_notes = str(existing.get("profile_notes") or "")
    updated_profile_notes = _update_profile_notes(existing_profile_notes, last_messages)
    updated_customer_profile = _build_customer_profile(last_messages)
    updated_summary = _build_strict_summary(existing_summary, updated_profile_notes, last_messages)

    merged = _merge_contact_fields(existing, contact, network_values)
    merged["id"] = existing_id
    merged["summary"] = updated_summary
    merged["profile_notes"] = updated_profile_notes
    merged["customer_profile"] = updated_customer_profile
    merged["last_processed_message_id"] = latest_msg_id
    merged["last_updated_at"] = _now_iso()

    upsert_customer_payload(TENANT_ID, merged)

    if updated_summary == existing_summary:
        print(f"No summary change for '{merged.get('name', contact['name'])}'")
    else:
        print(f"Updated summary for '{merged.get('name', contact['name'])}'")


def poll_once() -> None:
    for chat in _fetch_all_private_chats():
        try:
            _process_chat(chat)
        except Exception as exc:
            print(f"Failed to process chat '{_chat_title(chat)}': {exc}")


def main() -> None:
    print(
        f"Watching inbox every {POLL_INTERVAL_SECONDS}s. "
        f"Recent message limit: {RECENT_MESSAGE_LIMIT}. "
        f"Monitoring {MONITORED_CONVERSATIONS} latest private chats."
    )
    while True:
        try:
            poll_once()
        except KeyboardInterrupt:
            print("Stopped.")
            break
        except Exception as exc:
            print(f"Listener loop error: {exc}")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
