"""
beeper_client.py

Initialises the shared BeeperDesktop client and exposes low-level chat and
message utilities used by the ingestion scripts. Not a runnable script.

Exported names used by other scripts:
  client               — authenticated BeeperDesktop instance
  _items(result)       — extracts a list of items from any paged API result
  _chat_id(chat)       — returns the stable string ID of a chat
  _chat_title(chat)    — returns the human-readable name of a chat
  _is_private_chat(c)  — True if the chat is a one-to-one private conversation
  _chat_sort_key(chat) — sortable key (most recent activity first)
  _message_sort_key(m) — sortable key for messages (chronological)
  _find_latest_private_chat() — returns the most recently active private chat
  _fetch_last_messages(chat, limit) — fetches up to `limit` recent messages,
                                       handling pagination transparently
"""

import os

from beeper_desktop_api import BeeperDesktop


def _load_env_file(path: str = ".env") -> None:
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_env_file()

ACCESS_TOKEN = os.getenv("BEEPER_ACCESS_TOKEN")
BEEPER_BASE_URL = os.getenv("BEEPER_BASE_URL", "http://localhost:23373")
MESSAGE_LIMIT = 50

if not ACCESS_TOKEN:
    raise RuntimeError("Missing BEEPER_ACCESS_TOKEN in .env")


client = BeeperDesktop(access_token=ACCESS_TOKEN, base_url=BEEPER_BASE_URL)


def _items(result):
    if result is None:
        return []
    if hasattr(result, "items"):
        return list(result.items)
    if isinstance(result, (list, tuple)):
        return list(result)
    return [result]


def _chat_id(chat):
    for attr in ("id", "chat_id", "conversation_id"):
        value = getattr(chat, attr, None)
        if value is not None:
            return value
    return None


def _chat_title(chat):
    for attr in ("title", "name", "display_name"):
        value = getattr(chat, attr, None)
        if value:
            return value
    return "Unknown chat"


def _is_private_chat(chat):
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


def _chat_sort_key(chat):
    for attr in ("last_message_at", "last_activity_at", "updated_at", "timestamp", "created_at"):
        value = getattr(chat, attr, None)
        if value is not None:
            return value
    return 0


def _message_sort_key(message):
    for attr in ("timestamp", "created_at", "sent_at", "date"):
        value = getattr(message, attr, None)
        if value is not None:
            return value
    return 0


def _page_cursor(page):
    for attr in (
        "next_cursor",
        "nextCursor",
        "cursor",
        "next_page_cursor",
        "nextPageCursor",
        "next",
        "next_page",
        "page_cursor",
    ):
        value = getattr(page, attr, None)
        if value:
            return value
    if isinstance(page, dict):
        for key in ("next_cursor", "nextCursor", "cursor", "next_page_cursor", "nextPageCursor", "next", "next_page", "page_cursor"):
            value = page.get(key)
            if value:
                return value
    return None


def _page_items(page):
    if hasattr(page, "items"):
        return list(page.items)
    if isinstance(page, dict):
        items = page.get("items")
        if isinstance(items, (list, tuple)):
            return list(items)
    return _items(page)


def _find_latest_private_chat():
    chats = []

    chats_api = getattr(client, "chats", None)
    if chats_api is not None:
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
    if not private_chats:
        raise RuntimeError("No private chats found.")

    private_chats.sort(key=_chat_sort_key, reverse=True)
    return private_chats[0]


def _fetch_last_messages(chat, limit=MESSAGE_LIMIT):
    chat_id = _chat_id(chat)
    messages_api = getattr(client, "messages", None)
    if messages_api is None:
        raise RuntimeError("The Beeper client does not expose a messages API.")

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

if __name__ == "__main__":
    latest_private_chat = _find_latest_private_chat()
    messages = _fetch_last_messages(latest_private_chat, limit=MESSAGE_LIMIT)

    print(f"Latest private chat: {_chat_title(latest_private_chat)}")
    print(f"Showing the last {len(messages)} messages:\n")

    for message in messages:
        sender = getattr(message, "sender_name", None) or getattr(message, "sender", None) or "Unknown"
        text = getattr(message, "text", None) or getattr(message, "body", None) or getattr(message, "content", None) or "[Attachment]"
        print(f"{sender}: {text}")

