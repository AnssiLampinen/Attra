import os
import re
from datetime import datetime, timezone
from typing import Any, Dict

from database import (
    DEFAULT_TENANT_ID,
    find_customer,
    initialize_database,
    resolve_tenant_id_by_api_key,
    upsert_customer_payload,
)
from process_raw_messages import _build_strict_summary, _call_ollama, _format_messages
from beeper_client import (
    _chat_id,
    _chat_sort_key,
    _chat_title,
    _fetch_last_messages,
    _is_private_chat,
    _items,
    client,
)


MESSAGE_LIMIT = 30
DEFAULT_STATUS = "unknown"
TENANT_API_KEY = os.getenv("CRM_TENANT_API_KEY")
initialize_database()
TENANT_ID = os.getenv("CRM_TENANT_ID") or (
    resolve_tenant_id_by_api_key(TENANT_API_KEY) if TENANT_API_KEY else DEFAULT_TENANT_ID
)

PROFILE_NOTES_PROMPT = (
    "Create concise CRM profile notes about this person based only on explicit message content. "
    "Include durable facts and potentially useful details, even if minor. Do not invent facts. "
    "Keep it short: maximum 6 bullet points."
)
PROFILE_NOTES_MESSAGE_LIMIT = 10

CUSTOMER_PROFILE_PROMPT = (
    "Write a brief, single-sentence customer profile based on the messages. "
    "Focus on their role, industry, or key characteristic. Be concise and factual. "
    "Do not include any numbering or formatting. Just one clear sentence."
)


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


def _latest_message_id(messages: list[Any]) -> str:
    if not messages:
        return ""
    ordered = sorted(messages, key=_message_sort_key)
    latest = ordered[-1]
    value = _safe_get(latest, "id")
    return str(value) if value is not None else ""


def _build_profile_notes(messages: list[Any]) -> str:
    selected_messages = messages[-PROFILE_NOTES_MESSAGE_LIMIT:]
    prompt = f"{PROFILE_NOTES_PROMPT}\n\nMessages:\n{_format_messages(selected_messages)}"
    text, _ = _call_ollama(prompt)
    return text.strip()


def _build_customer_profile(messages: list[Any]) -> str:
    selected_messages = messages[-PROFILE_NOTES_MESSAGE_LIMIT:]
    prompt = f"{CUSTOMER_PROFILE_PROMPT}\n\nMessages:\n{_format_messages(selected_messages)}"
    text, _ = _call_ollama(prompt)
    return text.strip()


def _chat_network(chat: Any) -> str:
    for attr in ("network", "source", "platform", "service"):
        value = _safe_get(chat, attr)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()

    chat_id = _chat_id(chat)
    if isinstance(chat_id, str) and ":" in chat_id:
        return chat_id.split(":", 1)[1].split(".")[0].lower()

    return ""


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


def _contact_metadata(chat: Any, messages: list[Any]) -> Dict[str, str]:
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


def _private_chats_newest_first() -> list[Any]:
    chats_api = getattr(client, "chats", None)
    if chats_api is None:
        return []

    chats: list[Any] = []
    for method_name in ("search", "list"):
        method = getattr(chats_api, method_name, None)
        if not callable(method):
            continue

        for kwargs in ({"limit": 100}, {}):
            try:
                chats = _items(method(**kwargs))
                if chats:
                    break
            except TypeError:
                continue
            except Exception:
                continue

        if chats:
            break

    private_chats = [chat for chat in chats if _is_private_chat(chat)]
    private_chats.sort(key=_chat_sort_key, reverse=True)
    return private_chats


def _choose_unlogged_chat() -> Any:
    for chat in _private_chats_newest_first():
        preview_messages = _fetch_last_messages(chat, limit=1)
        contact = _contact_metadata(chat, preview_messages)
        network_values = _network_column_values_from_metadata(
            contact["network"],
            contact["handle"],
            contact["phone"],
        )
        existing_id = find_customer(TENANT_ID, contact["name"], network_values)
        if existing_id is None:
            print(
                f"Selected unlogged chat: title='{_chat_title(chat)}', "
                f"contact='{contact['name']}', network='{contact['network']}', handle='{contact['handle']}'"
            )
            return chat

        print(
            f"Skipping already logged contact: title='{_chat_title(chat)}', "
            f"contact='{contact['name']}', existing_id={existing_id}"
        )

    raise RuntimeError("No unlogged private chats found.")


def create_or_update_customer_from_latest_private_chat() -> int:
    target_chat = _choose_unlogged_chat()
    messages = _fetch_last_messages(target_chat, limit=MESSAGE_LIMIT)

    if not messages:
        raise RuntimeError("No messages found in the selected private chat.")

    print("Generating profile notes...")
    profile_notes = _build_profile_notes(messages)
    print("Generating structured summary...")
    summary = _build_strict_summary("", profile_notes, messages)
    print("Generating customer profile...")
    customer_profile = _build_customer_profile(messages)
    latest_message_id = _latest_message_id(messages)

    contact = _contact_metadata(target_chat, messages)
    network_values = _network_column_values_from_metadata(
        contact["network"],
        contact["handle"],
        contact["phone"],
    )

    existing_id = find_customer(TENANT_ID, contact["name"], network_values)

    payload: Dict[str, Any] = {
        "name": contact["name"],
        "phone": contact["phone"],
        "email": contact["email"],
        "summary": summary,
        "status": DEFAULT_STATUS,
        "profile_notes": profile_notes,
        "customer_profile": customer_profile,
        "last_processed_message_id": latest_message_id,
        "last_updated_at": _now_iso(),
        **network_values,
    }

    if existing_id is not None:
        payload["id"] = existing_id

    customer_id = upsert_customer_payload(TENANT_ID, payload)
    return customer_id


def main() -> None:
    customer_id = create_or_update_customer_from_latest_private_chat()
    print(f"Saved customer entry to Supabase with id={customer_id}")


if __name__ == "__main__":
    main()
